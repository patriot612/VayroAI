import type { CompletionRequest, CompletionResult, Provider } from '../types';
import { ProviderError } from '../types';
import { withTimeout } from '../../util/misc';

// Google Gemini API (generateContent). Free tier: Flash / Flash-Lite models (verify current
// quotas at https://ai.google.dev/gemini-api/docs/pricing before enabling a model as free).
export class GeminiProvider implements Provider {
  constructor(private readonly apiKey: string) {}

  async complete(modelId: string, req: CompletionRequest, config: Record<string, unknown>): Promise<CompletionResult> {
    const contents = [
      ...req.history.map((h) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] })),
      { role: 'user', parts: [{ text: req.input }] },
    ];
    const body: Record<string, unknown> = {
      contents,
      ...(req.system ? { systemInstruction: { role: 'system', parts: [{ text: req.system }] } } : {}),
      generationConfig: { maxOutputTokens: req.maxOutputTokens ?? 2048 },
      safetySettings: config['safety_settings'] ?? undefined,
    };
    if (req.search) body.tools = [{ google_search: {} }];

    const timeoutMs = Number(config['timeout_ms'] ?? 25000);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
    let res: Response;
    try {
      res = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify(body),
        }),
        timeoutMs,
        () => new ProviderError('gemini timeout', 'timeout'),
      );
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(`gemini fetch failed: ${(e as Error).message}`, 'unavailable');
    }

    if (res.status === 429) throw new ProviderError('gemini rate limited', 'rate_limited');
    if (res.status >= 500) throw new ProviderError(`gemini server error ${res.status}`, 'unavailable');
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new ProviderError(`gemini error ${res.status}: ${t.slice(0, 300)}`, res.status === 400 ? 'blocked' : 'unknown');
    }
    const data = (await res.json()) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        finishReason?: string;
        groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
      }[];
      promptFeedback?: { blockReason?: string };
    };
    if (data.promptFeedback?.blockReason) throw new ProviderError(`blocked: ${data.promptFeedback.blockReason}`, 'blocked');
    const cand = data.candidates?.[0];
    if (!cand) throw new ProviderError('gemini: no candidates', 'blocked');
    const text = (cand.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
    if (!text) throw new ProviderError(`gemini: empty response (${cand.finishReason ?? 'unknown'})`, 'blocked');
    const citations = (cand.groundingMetadata?.groundingChunks ?? [])
      .map((c) => (c.web?.uri ? { title: c.web.title ?? c.web.uri, url: c.web.uri } : null))
      .filter((x): x is { title: string; url: string } => x !== null);
    return { text, citations: citations.length ? citations : undefined };
  }
}
