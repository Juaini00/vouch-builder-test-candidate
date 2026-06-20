export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
}

export interface ChatCompletionOptions {
  jsonMode?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
}

/** Provider-agnostic chat client. Inject this abstract class; the concrete
 *  implementation is bound in LlmModule based on LLM_PROVIDER. */
export abstract class LlmClient {
  abstract readonly providerName: string;
  abstract chat(
    messages: ChatMessage[],
    options?: ChatCompletionOptions,
  ): Promise<ChatCompletionResult>;
}
