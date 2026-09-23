import type { Env } from '../env';
import type { Model } from '../db/types';
import type { ChatTurn,AiResult,ProviderAdapter } from './types';

export const workersAiAdapter:ProviderAdapter={
  async generate(model:Model,messages:ChatTurn[],env:Env):Promise<AiResult>{
    const cfg=JSON.parse(model.config||'{}') as {max_tokens?:number;temperature?:number};
    const result=await env.AI.run(model.model_id,{messages,max_tokens:cfg.max_tokens??model.max_output??2048,temperature:cfg.temperature??0.4});
    const r=result as {response?:string;result?:{response?:string};};
    const text=r.response??r.result?.response;
    if(!text) throw new Error('AI_EMPTY_RESPONSE');
    return {text};
  }
};
