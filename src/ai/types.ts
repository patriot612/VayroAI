export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  system?: string;
  history: ChatTurn[];
  input: string;
  maxOutputTokens?: number;
  search?: boolean;
}

export interface Citation {
  title: string;
  url: string;
}

export interface CompletionResult {
  text: string;
  citations?: Citation[];
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public kind: 'unavailable' | 'blocked' | 'rate_limited' | 'timeout' | 'unknown' = 'unknown',
  ) {
    super(message);
  }
}

export interface Provider {
  complete(modelId: string, req: CompletionRequest, config: Record<string, unknown>): Promise<CompletionResult>;
}
