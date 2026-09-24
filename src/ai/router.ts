import type { Env } from '../env';
import type { Model } from '../db/types';
import type { ChatTurn, AiResult, ProviderAdapter } from './types';
import type { AiRequestOptions } from './types';
import { workersAiAdapter } from './workers_ai';
import { geminiAdapter } from './gemini';
import { openaiAdapter } from './openai';
import { openaiCompatAdapter } from './openai_compat';
import { anthropicAdapter } from './anthropic';

const adapters:Record<string,ProviderAdapter>={workers_ai:workersAiAdapter,gemini:geminiAdapter,openai:openaiAdapter,openai_compat:openaiCompatAdapter,deepseek:openaiCompatAdapter,xkiro:openaiCompatAdapter,kimi:openaiCompatAdapter,groq:openaiCompatAdapter,anthropic:anthropicAdapter};

export async function generate(model:Model,messages:ChatTurn[],env:Env,signal?:AbortSignal,options?:AiRequestOptions):Promise<AiResult>{
  const adapter=adapters[model.provider];
  if(!adapter) throw new Error('PROVIDER_NOT_IMPLEMENTED');
  return adapter.generate(model,messages,env,signal,options);
}

export async function generateStream(model:Model,messages:ChatTurn[],env:Env,onDelta:(delta:string)=>Promise<void>,signal?:AbortSignal,options?:AiRequestOptions):Promise<AiResult>{
  const adapter=adapters[model.provider];
  if(!adapter) throw new Error('PROVIDER_NOT_IMPLEMENTED');
  if(!adapter.generateStream) return adapter.generate(model,messages,env,signal,options);
  return adapter.generateStream(model,messages,env,onDelta,signal,options);
}
