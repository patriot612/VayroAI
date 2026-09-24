import type { Env } from '../env';
import type { Model } from '../db/types';
import type { ChatTurn,AiResult,ProviderAdapter,Source } from './types';

function systemAndContents(messages:ChatTurn[]){const system=messages.find(m=>m.role==='system')?.content;const contents=messages.filter(m=>m.role!=='system').map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}));return {system,contents};}

export const geminiAdapter:ProviderAdapter={
  async generate(model:Model,messages:ChatTurn[],env:Env,signal?:AbortSignal,_options?:unknown):Promise<AiResult>{
    if(!env.GEMINI_API_KEY)throw new Error('PROVIDER_NOT_CONFIGURED');
    let cfg:{max_tokens?:number;temperature?:number;search?:boolean;base_url?:string};
    try{cfg=JSON.parse(model.config||'{}') as any;}catch{throw new Error('MODEL_CONFIG_INVALID');}
    const {system,contents}=systemAndContents(messages);
    const body:any={contents,generationConfig:{maxOutputTokens:cfg.max_tokens??model.max_output??2048,temperature:cfg.temperature??0.4}};
    if(system)body.systemInstruction={parts:[{text:system}]};
    if(model.type==='search'||cfg.search)body.tools=[{google_search:{}}];
    const base=cfg.base_url??'https://generativelanguage.googleapis.com/v1beta';
    const url=`${base.replace(/\/$/,'')}/models/${encodeURIComponent(model.model_id)}:generateContent`;
    const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},body:JSON.stringify(body),signal});
    const raw=await res.text(); let data:any=null; try{data=raw?JSON.parse(raw):null;}catch{}
    if(!res.ok){console.error('AI_PROVIDER_ERROR',{provider:'gemini',model:model.model_id,status:res.status,response:raw.slice(0,2000)});throw new Error(`GEMINI_${res.status}`);}
    const text=(data?.candidates?.[0]?.content?.parts??[]).map((p:any)=>p.text??'').join('').trim(); if(!text)throw new Error('AI_EMPTY_RESPONSE');
    const supports=data?.candidates?.[0]?.groundingMetadata?.groundingChunks??[]; const sources:Source[]=[]; for(const c of supports){const web=c?.web;if(web?.uri)sources.push({url:String(web.uri),title:String(web.title??web.uri)});}
    return {text,sources:sources.slice(0,5),providerRequestId:data?.responseId};
  }
};
