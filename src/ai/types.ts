import type { Env } from '../env';
import type { Model } from '../db/types';

export type ChatTurn={role:'system'|'user'|'assistant';content:string};
export type Source={title:string;url:string};
export type AiResult={text:string;sources?:Source[];providerRequestId?:string;};

export interface ProviderAdapter{generate(model:Model,messages:ChatTurn[],env:Env):Promise<AiResult>;}
