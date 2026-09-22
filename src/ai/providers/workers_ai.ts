import type { CompletionRequest, CompletionResult, Provider } from '../types';
import { ProviderError } from '../types';

// Cloudflare Workers AI — no API key, uses the `AI` binding.
// Free allocation: 10,000 "neurons"/day on the Workers Free plan (shared by all models).
export class WorkersAiProvider implements Provider {
  constructor(private readonly ai: Ai) {}

  async complete(modelId: string, req: CompletionRequest, config: Record<string, unknown>): Promise<CompletionResult> {
    const messages = [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      ...req.history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: req.input },
    ];
    let out: unknown;
    try {
      out = await this.ai.run(modelId as Parameters<Ai['run']>[0], {
        messages,
        max_tokens: (config['max_tokens'] as number | undefined) ?? req.maxOutputTokens ?? 1024,
      } as never);
    } catch (e) {
      throw new ProviderError(`workers_ai failed: ${(e as Error).message}`, 'unavailable');
    }
    const text =
      typeof out === 'object' && out !== null && 'response' in out
        ? String((out as { response?: unknown }).response ?? '').trim()
        : '';
    if (!text) throw new ProviderError('workers_ai: empty response', 'blocked');
    return { text };
  }
}
