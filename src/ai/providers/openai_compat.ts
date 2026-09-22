import type { CompletionRequest, CompletionResult, Provider } from '../types';
import { ProviderError } from '../types';
import { withTimeout } from '../../util/misc';

// Generic OpenAI-"chat/completions"-compatible provider.
// Covers OpenAI, DeepSeek, Kimi (Moonshot), and any other compatible endpoint —
// only base_url + api key differ, set per model in `models.config`.
export class OpenAICompatProvider implements Provider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async complete(modelId: string, req: CompletionRequest, config: Record<string, unknown>): Promise<CompletionResult> {
    const messages = [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      ...req.history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: req.input },
    ];
    const timeoutMs = Number(config['timeout_ms'] ?? 25000);
    let res: Response;
    try {
      res = await withTimeout(
        fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({
            model: modelId,
            messages,
            max_tokens: req.maxOutputTokens ?? 2048,
            ...(config['extra_body'] as Record<string, unknown> | undefined),
          }),
        }),
        timeoutMs,
        () => new ProviderError('provider timeout', 'timeout'),
      );
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(`fetch failed: ${(e as Error).message}`, 'unavailable');
    }
    if (res.status === 429) throw new ProviderError('rate limited', 'rate_limited');
    if (res.status >= 500) throw new ProviderError(`server error ${res.status}`, 'unavailable');
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new ProviderError(`error ${res.status}: ${t.slice(0, 300)}`, res.status === 400 ? 'blocked' : 'unknown');
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new ProviderError('empty response', 'blocked');
    return { text };
  }
}
