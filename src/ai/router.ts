import type { Env } from '../env';
import { envString } from '../env';
import type { ModelRow } from '../db/models';
import type { CompletionRequest, CompletionResult, Provider } from './types';
import { ProviderError } from './types';
import { GeminiProvider } from './providers/gemini';
import { OpenAICompatProvider } from './providers/openai_compat';
import { WorkersAiProvider } from './providers/workers_ai';
import { safeJson } from '../util/misc';

/** True when the model's provider actually has what it needs to run right now. */
export function modelIsConfigured(env: Env, m: ModelRow): boolean {
  const cfg = safeJson<Record<string, unknown>>(m.config, {});
  switch (m.provider) {
    case 'gemini':
      return Boolean(envString(env, 'GEMINI_API_KEY'));
    case 'openai':
      return Boolean(envString(env, 'OPENAI_API_KEY'));
    case 'anthropic':
      return Boolean(envString(env, 'ANTHROPIC_API_KEY'));
    case 'deepseek':
      return Boolean(envString(env, 'DEEPSEEK_API_KEY'));
    case 'kimi':
      return Boolean(envString(env, 'KIMI_API_KEY'));
    case 'openai_compat': {
      const keyEnv = cfg['api_key_env'] as string | undefined;
      return Boolean(envString(env, keyEnv) && (cfg['base_url'] as string | undefined));
    }
    case 'workers_ai':
      return Boolean(env.AI);
    default:
      return false;
  }
}

function buildProvider(env: Env, m: ModelRow): Provider {
  switch (m.provider) {
    case 'gemini':
      return new GeminiProvider(envString(env, 'GEMINI_API_KEY')!);
    case 'openai':
      return new OpenAICompatProvider(envString(env, 'OPENAI_API_KEY')!, 'https://api.openai.com/v1');
    case 'deepseek':
      return new OpenAICompatProvider(envString(env, 'DEEPSEEK_API_KEY')!, 'https://api.deepseek.com/v1');
    case 'kimi':
      return new OpenAICompatProvider(envString(env, 'KIMI_API_KEY')!, 'https://api.moonshot.cn/v1');
    case 'openai_compat': {
      const cfg = safeJson<Record<string, unknown>>(m.config, {});
      return new OpenAICompatProvider(envString(env, cfg['api_key_env'] as string)!, cfg['base_url'] as string);
    }
    case 'workers_ai':
      return new WorkersAiProvider(env.AI!);
    case 'anthropic':
      // Not implemented as a text-chat adapter for V1 (kept for future providers.anthropic.ts).
      throw new ProviderError('anthropic adapter not implemented', 'unavailable');
    default:
      throw new ProviderError(`unknown provider ${m.provider}`, 'unavailable');
  }
}

/**
 * Route one completion request to the model's provider.
 * Never throws unhandled provider quirks to the caller — always a ProviderError.
 */
export async function routeCompletion(env: Env, m: ModelRow, req: CompletionRequest): Promise<CompletionResult> {
  if (!modelIsConfigured(env, m)) throw new ProviderError(`model ${m.key} not configured`, 'unavailable');
  const provider = buildProvider(env, m);
  const cfg = safeJson<Record<string, unknown>>(m.config, {});
  try {
    return await provider.complete(m.model_id, req, cfg);
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(`${m.provider} failed: ${(e as Error).message}`, 'unknown');
  }
}
