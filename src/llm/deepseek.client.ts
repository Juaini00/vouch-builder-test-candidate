import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';

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

const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 500;

@Injectable()
export class DeepseekClient {
  private readonly logger = new Logger(DeepseekClient.name);
  private readonly http: AxiosInstance;
  private readonly model: string;
  private readonly defaultMaxOutput: number;
  private readonly defaultTemperature: number;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('DEEPSEEK_API_KEY');
    const baseUrl = this.config.get<string>(
      'DEEPSEEK_BASE_URL',
      'https://api.deepseek.com',
    );
    const timeoutMs = Number(
      this.config.get<string>('DEEPSEEK_TIMEOUT_MS', '30000'),
    );

    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY not configured');
    }

    this.model = this.config.get<string>('DEEPSEEK_MODEL', 'deepseek-chat');
    this.defaultMaxOutput = Number(
      this.config.get<string>('DEEPSEEK_MAX_OUTPUT_TOKENS', '2000'),
    );
    this.defaultTemperature = Number(
      this.config.get<string>('DEEPSEEK_TEMPERATURE', '0.1'),
    );

    this.http = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async chat(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {},
  ): Promise<ChatCompletionResult> {
    const payload = {
      model: this.model,
      messages,
      temperature: options.temperature ?? this.defaultTemperature,
      max_tokens: options.maxOutputTokens ?? this.defaultMaxOutput,
      ...(options.jsonMode
        ? { response_format: { type: 'json_object' } }
        : {}),
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await this.http.post('/chat/completions', payload);
        const choice = res.data?.choices?.[0]?.message?.content;
        if (typeof choice !== 'string') {
          throw new Error('DeepSeek returned no content');
        }
        return {
          content: choice,
          tokensIn: res.data?.usage?.prompt_tokens ?? 0,
          tokensOut: res.data?.usage?.completion_tokens ?? 0,
        };
      } catch (error: unknown) {
        lastError = error;
        const retriable = this.isRetriable(error);
        this.logger.warn(
          `deepseek call attempt ${attempt + 1} failed (retriable=${retriable}): ${this.errMsg(error)}`,
        );
        if (!retriable || attempt === MAX_RETRIES) break;
        await this.sleep(RETRY_BACKOFF_MS * Math.pow(2, attempt));
      }
    }
    throw new Error(`DeepSeek upstream failed: ${this.errMsg(lastError)}`);
  }

  private isRetriable(error: unknown): boolean {
    if (axios.isAxiosError(error)) {
      const status = (error as AxiosError).response?.status;
      if (status === undefined) return true;
      return status >= 500 || status === 429 || status === 408;
    }
    return false;
  }

  private errMsg(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const e = error as AxiosError<{ error?: { message?: string } }>;
      return `${e.response?.status ?? 'no-status'} ${
        e.response?.data?.error?.message ?? e.message
      }`;
    }
    return error instanceof Error ? error.message : 'unknown error';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
