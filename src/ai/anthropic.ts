import type { Env } from '../env';
import type { Model } from '../db/types';
import type { ChatTurn,AiResult,ProviderAdapter } from './types';

export const anthropicAdapter:ProviderAdapter={
  async generate(model:Model,messages:ChatTurn[],env:Env,signal?:AbortSignal):Promise<AiResult>{
    if(!env.ANTHROPIC_API_KEY) throw new Error('PROVIDER_NOT_CONFIGURED');
    let cfg:{max_tokens?:number;temperature?:number};
    try{cfg=JSON.parse(model.config||'{}') as any;}catch{throw new Error('MODEL_CONFIG_INVALID');}
    const system=messages.find(m=>m.role==='system')?.content;
    const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:model.model_id,max_tokens:cfg.max_tokens??model.max_output??2048,temperature:cfg.temperature??0.4,system,messages:messages.filter(m=>m.role!=='system')}),signal});
    const raw=await res.text(); let data:any=null; try{data=raw?JSON.parse(raw):null;}catch{}
    if(!res.ok){console.error('AI_PROVIDER_ERROR',{provider:'anthropic',model:model.model_id,status:res.status,response:raw.slice(0,2000)});throw new Error(`ANTHROPIC_${res.status}`);}
    const text=(data?.content??[]).map((x:any)=>x.text??'').join('').trim(); if(!text)throw new Error('AI_EMPTY_RESPONSE');
    return {text,providerRequestId:data?.id};
  }
};
