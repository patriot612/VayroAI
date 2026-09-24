import type { Env } from '../env';
import type { Model } from '../db/types';
import type { ChatTurn, AiResult, ProviderAdapter, Source, AiRequestOptions } from './types';

type CompatConfig={
  api_key_env?:string;
  base_url?:string;
  max_tokens?:number;
  temperature?:number;
  reasoning_effort?:'low'|'medium'|'high'|'max'|string;
  web_search_count?:number;
  response_format?:Record<string,unknown>;
  premium?:boolean;
  streaming?:boolean;
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

function collectSources(data:any):Source[]{
  const results=data?.web_search?.results??data?.web_search?.sources??[];
  if(!Array.isArray(results))return [];
  return results.map((x:any)=>({title:String(x?.title??x?.url??'Source'),url:String(x?.url??''),snippet:x?.snippet?String(x.snippet):undefined})).filter((x:Source)=>x.url).slice(0,10);
}

function extractText(value:any):string{
  if(typeof value==='string')return value;
  if(Array.isArray(value))return value.map((p:any)=>typeof p?.text==='string'?p.text:'').join('');
  return '';
}

async function generateInternal(
  model:Model,
  messages:ChatTurn[],
  env:Env,
  signal:AbortSignal|undefined,
  options:AiRequestOptions|undefined,
  streamHandler?: (response:Response)=>Promise<AiResult>
):Promise<AiResult>{
  const cfg=readConfig(model);
  const {apiKey,baseUrl}=endpointFor(model,env,cfg);
  const requestUrl=`${baseUrl}/chat/completions`;
  const body:any={
    model:model.model_id,
    messages,
    max_tokens:cfg.max_tokens??model.max_output??4096
  };

  if(model.provider!=='xkiro'){
    body.temperature=cfg.temperature??0.4;
  }else{
    const reasoning=options?.reasoning_effort??cfg.reasoning_effort;
    if(reasoning)body.reasoning_effort=reasoning;
    const useWebSearch=options?.web_search===true;
    if(useWebSearch){
      body.web_search={enable:true,count:Math.max(1,Math.min(20,Number(options?.web_search_count??cfg.web_search_count??5)))};
    }
    body.stream=options?.streaming===true;
    const responseFormat=options?.response_format??cfg.response_format;
    if(responseFormat)body.response_format=responseFormat;
  }

  console.log('AI_REQUEST',{provider:model.provider,modelKey:model.model_key,model:model.model_id,url:requestUrl,hasApiKey:Boolean(apiKey),stream:Boolean(body.stream),webSearch:Boolean(body.web_search),reasoning:body.reasoning_effort??null});

  const res=await fetch(requestUrl,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${apiKey}`},body:JSON.stringify(body),signal});
  if(streamHandler&&body.stream)return streamHandler(res);

  const raw=await res.text();
  let data:any=null;
  try{data=raw?JSON.parse(raw):null;}catch{}
  if(!res.ok){
    console.error('AI_PROVIDER_ERROR',{provider:model.provider,modelKey:model.model_key,model:model.model_id,status:res.status,statusText:res.statusText,response:raw.slice(0,2000)});
    if(model.provider==='xkiro'&&res.status===400){
      let detail='';
      try{const parsed=raw?JSON.parse(raw):null;detail=String(parsed?.error?.message??parsed?.message??'').trim();}catch{}
      throw new Error(detail?`XKIRO_400:${detail}`:'XKIRO_400');
    }
    if(model.provider==='xkiro'&&res.status===402)throw new Error('XKIRO_402');
    if(model.provider==='xkiro'&&res.status===429)throw new Error('XKIRO_429');
    throw new Error(`${model.provider.toUpperCase()}_${res.status}`);
  }
  const text=extractText(data?.choices?.[0]?.message?.content??data?.choices?.[0]?.text).trim();
  if(!text){
    console.error('AI_EMPTY_RESPONSE',{provider:model.provider,modelKey:model.model_key,model:model.model_id,status:res.status,response:raw.slice(0,2000)});
    throw new Error('AI_EMPTY_RESPONSE');
  }
  console.log('AI_RESPONSE_OK',{provider:model.provider,modelKey:model.model_key,model:model.model_id,status:res.status,requestId:data?.id??null});
  return {text,sources:collectSources(data),providerRequestId:data?.id};
}

async function parseStreamResponse(res:Response):Promise<AiResult>{
  if(!res.ok){
    const raw=await res.text();
    let data:any=null;try{data=raw?JSON.parse(raw):null}catch{}
    console.error('AI_PROVIDER_ERROR',{provider:'xkiro',status:res.status,response:raw.slice(0,2000)});
    if(res.status===400){
      let detail='';
      try{const parsed=raw?JSON.parse(raw):null;detail=String(parsed?.error?.message??parsed?.message??'').trim();}catch{}
      throw new Error(detail?`XKIRO_400:${detail}`:'XKIRO_400');
    }
    if(res.status===402)throw new Error('XKIRO_402');
    if(res.status===429)throw new Error('XKIRO_429');
    throw new Error(`XKIRO_${res.status}`);
  }
  if(!res.body)throw new Error('AI_STREAM_UNAVAILABLE');

  const reader=res.body.getReader();
  const decoder=new TextDecoder();
  let buffer='';
  let text='';
  let requestId:string|undefined;
  const sources:Source[]=[];

  const processEvent=(payload:string)=>{
    const trimmed=payload.trim();
    if(!trimmed||trimmed==='[DONE]')return;
    let data:any;try{data=JSON.parse(trimmed);}catch{return;}
    requestId=requestId??data?.id;
    const delta=extractText(data?.choices?.[0]?.delta?.content??'');
    if(delta)text+=delta;
    const found=collectSources(data);
    for(const s of found)if(!sources.some(x=>x.url===s.url))sources.push(s);
  };

  while(true){
    const {value,done}=await reader.read();
    if(done)break;
    buffer+=decoder.decode(value,{stream:true});
    let idx:number;
    while((idx=buffer.indexOf('\n\n'))>=0){
      const event=buffer.slice(0,idx);buffer=buffer.slice(idx+2);
      for(const line of event.split('\n')){
        const trimmed=line.trim();
        if(trimmed.startsWith('data:'))processEvent(trimmed.slice(5).trim());
      }
    }
  }
  if(buffer.trim()){
    for(const line of buffer.split('\n')){const trimmed=line.trim();if(trimmed.startsWith('data:'))processEvent(trimmed.slice(5).trim());}
  }
  const final=text.trim();
  if(!final)throw new Error('AI_EMPTY_RESPONSE');
  return {text:final,sources:sources.slice(0,10),providerRequestId:requestId};
}

export const openaiCompatAdapter:ProviderAdapter={
  async generate(model:Model,messages:ChatTurn[],env:Env,signal?:AbortSignal,options?:AiRequestOptions):Promise<AiResult>{
    return generateInternal(model,messages,env,signal,options);
  },
  async generateStream(model:Model,messages:ChatTurn[],env:Env,onDelta:(delta:string)=>Promise<void>,signal?:AbortSignal,options?:AiRequestOptions):Promise<AiResult>{
    const cfg=readConfig(model);
    const {apiKey,baseUrl}=endpointFor(model,env,cfg);
    const requestUrl=`${baseUrl}/chat/completions`;
    const body:any={model:model.model_id,messages,max_tokens:cfg.max_tokens??model.max_output??4096,stream:true};
    if(model.provider!=='xkiro'){body.temperature=cfg.temperature??0.4;}
    else { const reasoning=options?.reasoning_effort??cfg.reasoning_effort; if(reasoning)body.reasoning_effort=reasoning; if(options?.web_search===true)body.web_search={enable:true,count:Math.max(1,Math.min(20,Number(options?.web_search_count??cfg.web_search_count??5)))}; }

    const res=await fetch(requestUrl,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${apiKey}`},body:JSON.stringify(body),signal});
    if(!res.ok){
      const raw=await res.text();
      console.error('AI_PROVIDER_ERROR',{provider:model.provider,modelKey:model.model_key,model:model.model_id,status:res.status,response:raw.slice(0,2000)});
      if(res.status===400){let detail='';try{const parsed=raw?JSON.parse(raw):null;detail=String(parsed?.error?.message??parsed?.message??'').trim();}catch{};throw new Error(detail?`XKIRO_400:${detail}`:'XKIRO_400');}
      if(res.status===402)throw new Error('XKIRO_402');
      if(res.status===429)throw new Error('XKIRO_429');
      throw new Error(`XKIRO_${res.status}`);
    }
    if(!res.body)throw new Error('AI_STREAM_UNAVAILABLE');
    const reader=res.body.getReader();const decoder=new TextDecoder();let buffer='';let text='';let requestId:string|undefined;const sources:Source[]=[];
    const processEvent=async(payload:string)=>{const trimmed=payload.trim();if(!trimmed||trimmed==='[DONE]')return;let data:any;try{data=JSON.parse(trimmed)}catch{return};requestId=requestId??data?.id;const delta=extractText(data?.choices?.[0]?.delta?.content??'');if(delta){text+=delta;await onDelta(delta);}for(const s of collectSources(data))if(!sources.some(x=>x.url===s.url))sources.push(s)};
    while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let idx:number;while((idx=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,idx);buffer=buffer.slice(idx+2);for(const line of event.split('\n')){const tr=line.trim();if(tr.startsWith('data:'))await processEvent(tr.slice(5).trim())}}}
    if(buffer.trim())for(const line of buffer.split('\n')){const tr=line.trim();if(tr.startsWith('data:'))await processEvent(tr.slice(5).trim())}
    if(!text.trim())throw new Error('AI_EMPTY_RESPONSE');
    return {text:text.trim(),sources:sources.slice(0,10),providerRequestId:requestId};
  }
};
