import type { Env } from '../env';
import type { Model } from '../db/types';
import type { ChatTurn, AiResult, ProviderAdapter } from './types';
import { workersAiAdapter } from './workers_ai';
import { geminiAdapter } from './gemini';
import { openaiAdapter } from './openai';
import { openaiCompatAdapter } from './openai_compat';
import { anthropicAdapter } from './anthropic';

const adapters:Record<string,ProviderAdapter>={workers_ai:workersAiAdapter,gemini:geminiAdapter,openai:openaiAdapter,openai_compat:openaiCompatAdapter,deepseek:openaiCompatAdapter,kimi:openaiCompatAdapter,groq:openaiCompatAdapter,anthropic:anthropicAdapter};

export async function generate(model:Model,messages:ChatTurn[],env:Env):Promise<AiResult>{
  const adapter=adapters[model.provider]; if(!adapter) throw new Error('PROVIDER_NOT_IMPLEMENTED');
  return adapter.generate(model,messages,env);
}
