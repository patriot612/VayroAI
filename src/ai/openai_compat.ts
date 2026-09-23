import type { Env } from '../env';
import type { Model } from '../db/types';
import type { ChatTurn,AiResult,ProviderAdapter } from './types';

function endpointFor(model:Model,env:Env){
  let apiKey:string|undefined; let baseUrl:string|undefined;
  if(model.provider==='openai'){apiKey=env.OPENAI_API_KEY;baseUrl='https://api.openai.com/v1';}
  else if(model.provider==='deepseek'){apiKey=env.DEEPSEEK_API_KEY;baseUrl='https://api.deepseek.com';}
  else if(model.provider==='kimi'){apiKey=env.KIMI_API_KEY;baseUrl='https://api.moonshot.ai/v1';}
  else if(model.provider==='groq')apiKey=env.GROQ_API_KEY;baseUrl='https://api.groq.com/openai/v1';}
  else {const cfg=JSON.parse(model.config||'{}') as {api_key_env?:string;base_url?:string}; apiKey=cfg.api_key_env ? (env as Record<string,unknown>)[cfg.api_key_env] as string|undefined : undefined;baseUrl=cfg.base_url;}
  if(!apiKey || !baseUrl) throw new Error('PROVIDER_NOT_CONFIGURED');
  return {apiKey,baseUrl:baseUrl.replace(/\/$/,'')};
}

export const openaiCompatAdapter:ProviderAdapter={
  async generate(model:Model,messages:ChatTurn[],env:Env):Promise<AiResult>{
    const {apiKey,baseUrl}=endpointFor(model,env);
    const cfg=JSON.parse(model.config||'{}') as {max_tokens?:number;temperature?:number};
    const res=await fetch(`${baseUrl}/chat/completions`,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${apiKey}`},body:JSON.stringify({model:model.model_id,messages,max_tokens:cfg.max_tokens??model.max_output??2048,temperature:cfg.temperature??0.4})});
    const data:any=await res.json(); if(!res.ok) throw new Error(`${model.provider.toUpperCase()}_${res.status}`);
    const text=data.choices?.[0]?.message?.content?.trim(); if(!text) throw new Error('AI_EMPTY_RESPONSE');
    return {text,providerRequestId:data.id};
  }
};
