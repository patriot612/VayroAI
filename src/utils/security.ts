import type { Env } from '../env';

export function adminIds(env:Env):Set<number>{return new Set((env.ADMIN_TELEGRAM_ID||'').split(',').map(x=>Number(x.trim())).filter(Number.isFinite));}
export function isAdmin(env:Env,id:number):boolean{return adminIds(env).has(id);}

export function validPage(s:string|undefined, fallback=1):number{const n=Number(s);return Number.isInteger(n)&&n>0?n:fallback;}
export function safeInt(s:string|undefined){const n=Number(s);return Number.isInteger(n)?n:null;}
