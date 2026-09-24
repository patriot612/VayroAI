import type { Env } from '../env';
import type { Model } from '../db/types';

export type VisionPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatContent = string | VisionPart[] | null;

export type AiRequestOptions={
  reasoning_effort?:'low'|'medium'|'high'|'max'|string;
  web_search?:boolean;
  web_search_count?:number;
  streaming?:boolean;
  response_format?:Record<string,unknown>;
};

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ChatTurn = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ChatContent;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type Source = { title: string; url: string; snippet?: string };
export type AiResult = { text: string; sources?: Source[]; providerRequestId?: string };

export interface ProviderAdapter {
  generate(model: Model, messages: ChatTurn[], env: Env, signal?: AbortSignal, options?: AiRequestOptions): Promise<AiResult>;
  generateStream?(
    model: Model,
    messages: ChatTurn[],
    env: Env,
    onDelta: (delta: string) => Promise<void>,
    signal?: AbortSignal,
    options?: AiRequestOptions
  ): Promise<AiResult>;
}
