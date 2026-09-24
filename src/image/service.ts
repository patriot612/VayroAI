import type { Env } from '../env';
import type { Model } from '../db/types';
import { modelConfig } from '../db/repo';

export type ImageTemplate={id:string;name:{ru:string;en:string;uz:string};description:{ru:string;en:string;uz:string};prompt:string;defaultCost:number;allModels?:boolean};
export type ImageRequest={model:Model;prompt:string;aspect:string;quality:string;template?:ImageTemplate;sourceImage?:ArrayBuffer};

export const IMAGE_TEMPLATES:ImageTemplate[]=[
 {id:'cinematic',name:{ru:'Кинематографичный',en:'Cinematic',uz:'Kinematik'},description:{ru:'Кинематографичный свет, композиция и глубина.',en:'Cinematic lighting, composition and depth.',uz:'Kinematik yorug‘lik, kompozitsiya va chuqurlik.'},prompt:'Transform the user request into a cinematic image brief with strong composition, realistic lighting, depth and film-like atmosphere.',defaultCost:5},
 {id:'portrait',name:{ru:'Портрет',en:'Portrait',uz:'Portret'},description:{ru:'Профессиональный портрет с аккуратным светом.',en:'Professional portrait with controlled lighting.',uz:'Nazorat qilingan yorug‘lik bilan professional portret.'},prompt:'Create a polished professional portrait brief. Preserve the subject identity and use flattering, natural lighting.',defaultCost:5},
 {id:'product',name:{ru:'Фото товара',en:'Product photo',uz:'Mahsulot rasmi'},description:{ru:'Чистая рекламная съёмка товара.',en:'Clean commercial product photography.',uz:'Toza reklama mahsulot fotosurati.'},prompt:'Create a clean commercial product photography brief with accurate product appearance, controlled studio lighting and a suitable background.',defaultCost:5},
 {id:'poster',name:{ru:'Афиша',en:'Poster',uz:'Poster'},description:{ru:'Динамичная композиция для афиши.',en:'Dynamic composition for a poster.',uz:'Poster uchun dinamik kompozitsiya.'},prompt:'Create a visually strong poster-style composition with clear hierarchy, dramatic lighting and deliberate framing.',defaultCost:5},
 {id:'wallpaper',name:{ru:'Обои',en:'Wallpaper',uz:'Fon rasmi'},description:{ru:'Сбалансированная композиция для обоев.',en:'Balanced composition for wallpaper.',uz:'Fon rasmi uchun muvozanatli kompozitsiya.'},prompt:'Create a polished wallpaper composition with balanced negative space and strong focal subject.',defaultCost:5}
];

function imageCfg(model:Model){return modelConfig(model) as any}
function parseDataUrl(s:string){const m=s.match(/^data:[^;]+;base64,(.+)$/);return m?m[1]:null}
function b64(bytes:ArrayBuffer){let s='';const a=new Uint8Array(bytes);for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));return btoa(s)}
function mimeFromBytes(bytes:ArrayBuffer){const a=new Uint8Array(bytes).slice(0,12);if(a[0]===0x89&&a[1]===0x50&&a[2]===0x4e&&a[3]===0x47)return 'image/png';if(a[0]===0xff&&a[1]===0xd8)return 'image/jpeg';if(a[0]===0x52&&a[1]===0x49&&a[2]===0x46&&a[3]===0x46&&a[8]===0x57&&a[9]===0x45&&a[10]===0x42&&a[11]===0x50)return 'image/webp';if(a[0]===0x3c&&a[1]===0x3f&&a[2]===0x78&&a[3]===0x6d&&a[4]===0x6c)return 'image/svg+xml';if(a[0]===0x3c&&a[1]===0x73&&a[2]===0x76&&a[3]===0x67)return 'image/svg+xml';return 'image/png'}

export async function generateImage(req:ImageRequest,env:Env):Promise<{bytes:ArrayBuffer;mime:string}> {
  const cfg=imageCfg(req.model);
  switch(req.model.provider){
    case 'openai':
    case 'openai_compat':
    case 'deepseek':
    case 'kimi': return openAiImage(req,env,cfg);
    case 'gemini': return geminiImage(req,env,cfg);
    case 'workers_ai': return workersImage(req,env,cfg);
    default: throw new Error('IMAGE_PROVIDER_NOT_IMPLEMENTED');
  }
}

async function openAiImage(req:ImageRequest,env:Env,cfg:any){
  const key=cfg.api_key_env?String((env as any)[cfg.api_key_env]??''):req.model.provider==='openai'?env.OPENAI_API_KEY:req.model.provider==='deepseek'?env.DEEPSEEK_API_KEY:req.model.provider==='kimi'?env.KIMI_API_KEY:'';
  if(!key) throw new Error('IMAGE_PROVIDER_NOT_CONFIGURED');
  const base=String(cfg.base_url??(req.model.provider==='openai'?'https://api.openai.com/v1':'')).replace(/\/$/,'');

  // Pollinations' Nano Banana models are more reliable through the native image endpoint.
  // This keeps the existing OpenAI-compatible path for all other models, while allowing
  // a model restricted to the same Pollinations key to be selected normally in D1.
  if(!req.sourceImage && isPollinationsNanoBanana(req.model.model_id,base)){
    return pollinationsNativeImage(req,env,cfg,key);
  }

  const endpoint= req.sourceImage ? `${base}/images/edits` : `${base}/images/generations`;
  if(req.sourceImage){
    const fd=new FormData();fd.append('model',req.model.model_id);fd.append('prompt',req.prompt);fd.append('image',new Blob([req.sourceImage],{type:mimeFromBytes(req.sourceImage)}),'source.png');
    if(req.aspect)fd.append('size',mapSize(req.aspect,cfg));
    const res=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${key}`},body:fd});
    return parseOpenAIImageResponse(res);
  }
  const body:any={model:req.model.model_id,prompt:req.prompt,n:1,size:mapSize(req.aspect,cfg),response_format:cfg.response_format??'b64_json'};if(req.quality)body.quality=req.quality;
  const res=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(body)});return parseOpenAIImageResponse(res);
}

function isPollinationsNanoBanana(modelId:string,base:string){
  return /(^|\/)nanobanana(?:-2(?:-lite)?|-pro)?$/i.test(modelId) && /(^https?:\/\/)?gen\.pollinations\.ai(?::\d+)?(?:\/v1)?$/i.test(base);
}

function nativeQuality(value:string|undefined){
  const v=String(value||'').toLowerCase();
  if(v==='low'||v==='medium'||v==='high'||v==='hd')return v;
  if(v==='standard')return 'medium';
  return '';
}

async function pollinationsNativeImage(req:ImageRequest,_env:Env,cfg:any,key:string){
  if(req.sourceImage)throw new Error('IMAGE_INPUT_NOT_SUPPORTED');
  const base=String(cfg.base_url||'https://gen.pollinations.ai/v1').replace(/\/v1\/?$/i,'').replace(/\/$/,'');
  const size=mapSize(req.aspect,cfg);
  const [width,height]=size.split('x');
  const params=new URLSearchParams();
  params.set('model',req.model.model_id);
  if(width)params.set('width',width);
  if(height)params.set('height',height);
  const quality=nativeQuality(req.quality);
  if(quality)params.set('quality',quality);
  if(cfg.seed!==undefined && cfg.seed!==null && String(cfg.seed)!=='')params.set('seed',String(cfg.seed));
  if(cfg.safe!==undefined)params.set('safe',String(cfg.safe));
  if(cfg.enhance===true)params.set('enhance','true');
  if(cfg.nologo===true)params.set('nologo','true');
  if(cfg.reasoning)params.set('reasoning',String(cfg.reasoning));

  const url=`${base}/image/${encodeURIComponent(req.prompt)}?${params.toString()}`;
  const res=await fetch(url,{method:'GET',headers:{authorization:`Bearer ${key}`,accept:'image/*'}});
  if(!res.ok){
    const detail=(await res.text()).slice(0,1000);
    console.error('pollinations_image_error',JSON.stringify({status:res.status,model:req.model.model_id,detail}));
    throw new Error(`IMAGE_API_ERROR_${res.status}`);
  }
  const bytes=await res.arrayBuffer();
  if(!bytes.byteLength)throw new Error('IMAGE_EMPTY');
  const mime=String(res.headers.get('content-type')||mimeFromBytes(bytes)||'image/png').split(';')[0];
  if(!mime.startsWith('image/')){
    const detail=new TextDecoder().decode(bytes.slice(0,1000));
    console.error('pollinations_image_error',JSON.stringify({status:200,model:req.model.model_id,detail}));
    throw new Error('IMAGE_API_ERROR');
  }
  return {bytes,mime};
}

async function parseOpenAIImageResponse(res:Response){
  const raw=await res.text();
  let data:any=null;
  try{data=JSON.parse(raw)}catch{}
  if(!res.ok){
    console.error('image_api_error',JSON.stringify({status:res.status,detail:raw.slice(0,1000)}));
    throw new Error(`IMAGE_API_ERROR_${res.status}`);
  }
  const item=data?.data?.[0];
  if(!item)throw new Error('IMAGE_EMPTY');
  if(item.b64_json){const bin=atob(item.b64_json);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return {bytes:out.buffer,mime:String(item.media_type||mimeFromBytes(out.buffer)||'image/png')}}
  if(item.url){const r=await fetch(item.url);if(!r.ok)throw new Error('IMAGE_RESULT_FETCH_FAILED');const bytes=await r.arrayBuffer();return {bytes,mime:String(item.media_type||r.headers.get('content-type')||mimeFromBytes(bytes)||'image/png')}}
  throw new Error('IMAGE_EMPTY')
}

async function geminiImage(req:ImageRequest,env:Env,cfg:any){if(!env.GEMINI_API_KEY)throw new Error('IMAGE_PROVIDER_NOT_CONFIGURED');const base=String(cfg.base_url??'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/,'');const url=`${base}/models/${encodeURIComponent(req.model.model_id)}:generateContent`;const parts:any[]=[];if(req.sourceImage)parts.push({inline_data:{mime_type:mimeFromBytes(req.sourceImage),data:b64(req.sourceImage)}});parts.push({text:req.prompt});const body:any={contents:[{role:'user',parts}],generationConfig:{responseModalities:['TEXT','IMAGE']}};if(req.aspect||req.quality)body.generationConfig.imageConfig={aspectRatio:req.aspect,imageSize:req.quality};const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},body:JSON.stringify(body)});const raw=await res.text();let data:any=null;try{data=raw?JSON.parse(raw):null}catch{}if(!res.ok){console.error('gemini_image_error',JSON.stringify({status:res.status,model:req.model.model_id,detail:raw.slice(0,1000)}));throw new Error(`IMAGE_API_ERROR_${res.status}`);}for(const p of data?.candidates?.[0]?.content?.parts??[]){const d=p?.inlineData??p?.inline_data;if(d?.data){const bin=atob(d.data);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return {bytes:out.buffer,mime:d.mimeType||d.mime_type||'image/png'}}}throw new Error('IMAGE_EMPTY')}

async function workersImage(req:ImageRequest,env:Env,cfg:any){const input:any={prompt:req.prompt,num_outputs:1};if(req.aspect)input.aspect_ratio=req.aspect;if(req.quality)input.quality=req.quality;if(req.sourceImage)input.image_b64=b64(req.sourceImage);const out:any=await env.AI.run(req.model.model_id,input);if(out instanceof ArrayBuffer)return {bytes:out,mime:'image/png'};if(out?.image) {const raw=parseDataUrl(out.image);if(raw){const bin=atob(raw);const a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return {bytes:a.buffer,mime:'image/png'}}}if(typeof out?.response==='string'&&out.response.startsWith('data:')){const raw=parseDataUrl(out.response);if(raw){const bin=atob(raw);const a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return {bytes:a.buffer,mime:'image/png'}}}throw new Error('IMAGE_EMPTY')}

function mapSize(aspect:string,cfg:any){const map=cfg.size_map||{'1:1':'1024x1024','16:9':'1536x864','9:16':'864x1536','4:3':'1152x896','3:4':'896x1152'};return map[aspect]||cfg.default_size||'1024x1024'}

export function composePrompt(prompt:string,template?:ImageTemplate){return template?`${template.prompt}\n\nUser request:\n${prompt}`:prompt}
