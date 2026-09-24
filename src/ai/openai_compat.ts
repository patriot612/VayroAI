import type { Env } from '../env';
import type { Model } from '../db/types';
import type { ChatTurn, AiResult, ProviderAdapter } from './types';

type CompatConfig={
  api_key_env?:string;
  base_url?:string;
  max_tokens?:number;
  temperature?:number;
  reasoning_effort?:'low'|'medium'|'high'|'max'|string;
};

function readConfig(model:Model):CompatConfig{
  try{return JSON.parse(model.config||'{}') as CompatConfig;}catch{throw new Error('MODEL_CONFIG_INVALID');}
}

function endpointFor(model:Model,env:Env,cfg:CompatConfig){
  let apiKey:string|undefined;
  let baseUrl:string|undefined;
  if(model.provider==='openai'){apiKey=env.OPENAI_API_KEY;baseUrl='https://api.openai.com/v1';}
  else if(model.provider==='deepseek'){apiKey=env.DEEPSEEK_API_KEY;baseUrl='https://api.deepseek.com';}
  else if(model.provider==='kimi'){apiKey=env.KIMI_API_KEY;baseUrl='https://api.moonshot.ai/v1';}
  else if(model.provider==='groq'){apiKey=env.GROQ_API_KEY;baseUrl='https://api.groq.com/openai/v1';}
  else if(model.provider==='xkiro'){
    apiKey=env.XKIRO_API_KEY;
    baseUrl='https://api.xkiro.com/v1';
    if(!model.model_id.includes('/')) throw new Error('XKIRO_INVALID_MODEL_ID');
  } else {
    apiKey=cfg.api_key_env ? (env as Record<string,unknown>)[cfg.api_key_env] as string|undefined : undefined;
    baseUrl=cfg.base_url;
  }
  if(!apiKey||!baseUrl) throw new Error('PROVIDER_NOT_CONFIGURED');
  return {apiKey,baseUrl:baseUrl.replace(/\/$/,'')};
}

export const openaiCompatAdapter:ProviderAdapter={
  async generate(model:Model,messages:ChatTurn[],env:Env,signal?:AbortSignal):Promise<AiResult>{
    const cfg=readConfig(model);
    const {apiKey,baseUrl}=endpointFor(model,env,cfg);
    const requestUrl=`${baseUrl}/chat/completions`;
    const body:any={
      model:model.model_id,
      messages,
      max_tokens:cfg.max_tokens??model.max_output??2048
    };
    if(model.provider!=='xkiro'){body.temperature=cfg.temperature??0.4;}
    else if(cfg.reasoning_effort){body.reasoning_effort=cfg.reasoning_effort;}

    console.log('AI_REQUEST',{provider:model.provider,modelKey:model.model_key,model:model.model_id,url:requestUrl,hasApiKey:Boolean(apiKey)});

    const res=await fetch(requestUrl,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${apiKey}`},body:JSON.stringify(body),signal});
    const raw=await res.text();
    let data:any=null;
    try{data=raw?JSON.parse(raw):null;}catch{}
    if(!res.ok){
      console.error('AI_PROVIDER_ERROR',{provider:model.provider,modelKey:model.model_key,model:model.model_id,status:res.status,statusText:res.statusText,response:raw.slice(0,2000)});
      throw new Error(`${model.provider.toUpperCase()}_${res.status}`);
    }
    const text=String(data?.choices?.[0]?.message?.content??'').trim();
    if(!text){console.error('AI_EMPTY_RESPONSE',{provider:model.provider,modelKey:model.model_key,model:model.model_id,status:res.status,response:raw.slice(0,2000)});throw new Error('AI_EMPTY_RESPONSE');}
    console.log('AI_RESPONSE_OK',{provider:model.provider,modelKey:model.model_key,model:model.model_id,status:res.status,requestId:data?.id??null});
    return {text,providerRequestId:data?.id};
  }
};
