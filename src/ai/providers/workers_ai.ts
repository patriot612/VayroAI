import type { CompletionRequest, CompletionResult, Provider } from '../types';
import { ProviderError } from '../types';

// Cloudflare Workers AI — uses the `AI` binding.
// Free allocation: 10,000 neurons/day on the Workers Free plan.
export class WorkersAiProvider implements Provider {
  constructor(private readonly ai: Ai) {}

  async complete(
    modelId: string,
    req: CompletionRequest,
    config: Record<string, unknown>,
  ): Promise<CompletionResult> {
    const messages = [
      ...(req.system
        ? [{ role: 'system', content: req.system }]
        : []),
      ...req.history.map((h) => ({
        role: h.role,
        content: h.content,
      })),
      {
        role: 'user',
        content: req.input,
      },
    ];

    const maxTokens =
      (config['max_tokens'] as number | undefined) ??
      req.maxOutputTokens ??
      1024;

    let out: unknown;

    try {
      out = await this.ai.run(
        modelId as Parameters<Ai['run']>[0],
        {
          messages,
          max_tokens: maxTokens,
        } as never,
      );
    } catch (error) {
      /*
       * Do NOT hide the real Workers AI error.
       *
       * Previously every error became:
       *   "workers_ai failed: ..."
       * with kind "unavailable".
       *
       * This version preserves the actual error message and
       * classifies common HTTP/rate-limit/timeout errors.
       */

      const details = getErrorDetails(error);

      const kind = classifyWorkersAiError(
        details.status,
        details.message,
      );

      throw new ProviderError(
        `Workers AI request failed. model=${modelId}; status=${details.status ?? 'unknown'}; ${details.message}`,
        kind,
      );
    }

    const text =
      typeof out === 'object' &&
      out !== null &&
      'response' in out
        ? String(
            (out as { response?: unknown }).response ?? '',
          ).trim()
        : '';

    if (!text) {
      throw new ProviderError(
        `Workers AI returned an empty response. model=${modelId}`,
        'unavailable',
      );
    }

    return { text };
  }
}

/**
 * Extract useful information from Cloudflare/Workers AI errors.
 *
 * Errors are not guaranteed to be normal Error instances,
 * so we handle objects such as:
 * { message, status, code }
 */
function getErrorDetails(error: unknown): {
  message: string;
  status?: number;
  code?: string | number;
} {
  if (error instanceof Error) {
    const err = error as Error & {
      status?: number;
      code?: string | number;
    };

    return {
      message: err.message || err.name || 'Unknown Workers AI error',
      status:
        typeof err.status === 'number'
          ? err.status
          : undefined,
      code: err.code,
    };
  }

  if (
    typeof error === 'object' &&
    error !== null
  ) {
    const err = error as {
      message?: unknown;
      status?: unknown;
      code?: unknown;
      error?: unknown;
    };

    let message = '';

    if (typeof err.message === 'string') {
      message = err.message;
    } else if (typeof err.error === 'string') {
      message = err.error;
    } else {
      try {
        message = JSON.stringify(error);
      } catch {
        message = String(error);
      }
    }

    return {
      message: message || 'Unknown Workers AI error',
      status:
        typeof err.status === 'number'
          ? err.status
          : undefined,
      code:
        typeof err.code === 'string' ||
        typeof err.code === 'number'
          ? err.code
          : undefined,
    };
  }

  return {
    message: String(error),
  };
}

/**
 * Convert common Workers AI failures into the ProviderError kinds
 * already understood by the rest of VayroAI.
 */
function classifyWorkersAiError(
  status: number | undefined,
  message: string,
): ProviderError['kind'] {
  const text = message.toLowerCase();

  // Rate limits / quota exhaustion.
  if (
    status === 429 ||
    text.includes('rate limit') ||
    text.includes('too many requests') ||
    text.includes('quota') ||
    text.includes('limit exceeded')
  ) {
    return 'rate_limited';
  }

  // Timeouts / gateway timeouts.
  if (
    status === 408 ||
    status === 504 ||
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('deadline exceeded')
  ) {
    return 'timeout';
  }

  // Authentication, permission, missing/invalid model,
  // unavailable service, etc.
  if (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 500 ||
    status === 502 ||
    status === 503
  ) {
    return 'unavailable';
  }

  if (
    text.includes('model not found') ||
    text.includes('unknown model') ||
    text.includes('invalid model') ||
    text.includes('not found') ||
    text.includes('unauthorized') ||
    text.includes('forbidden') ||
    text.includes('service unavailable')
  ) {
    return 'unavailable';
  }

  return 'unknown';
}
