import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  ChatCompletionOptions,
  ChatCompletionResult,
  ChatMessage,
  LlmClient,
} from './llm.client';

const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 500;

interface GeminiPart {
  text: string;
}
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: { message?: string };
}

@Injectable()
export class GeminiClient extends LlmClient {
  readonly providerName = 'gemini';
  private readonly logger = new Logger(GeminiClient.name);
  private readonly http: AxiosInstance;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly defaultMaxOutput: number;
  private readonly defaultTemperature: number;

  constructor(private readonly config: ConfigService) {
    super();
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }
    this.apiKey = apiKey;

    const baseUrl = this.config.get<string>(
      'GEMINI_BASE_URL',
      'https://generativelanguage.googleapis.com/v1beta',
    );
    const timeoutMs = Number(
      this.config.get<string>('GEMINI_TIMEOUT_MS', '30000'),
    );

    this.model = this.config.get<string>('GEMINI_MODEL', 'gemini-2.5-flash');
    this.defaultMaxOutput = Number(
      this.config.get<string>('GEMINI_MAX_OUTPUT_TOKENS', '2000'),
    );
    this.defaultTemperature = Number(
      this.config.get<string>('GEMINI_TEMPERATURE', '0.1'),
    );

    this.http = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async chat(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {},
  ): Promise<ChatCompletionResult> {
    const { systemInstruction, contents } = this.toGeminiShape(messages);
    const payload = {
      ...(systemInstruction
        ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
        : {}),
      contents,
      generationConfig: {
        temperature: options.temperature ?? this.defaultTemperature,
        maxOutputTokens: options.maxOutputTokens ?? this.defaultMaxOutput,
        ...(options.jsonMode
          ? { responseMimeType: 'application/json' }
          : {}),
      },
    };

    const url = `/models/${this.model}:generateContent?key=${this.apiKey}`;

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await this.http.post<GeminiResponse>(url, payload);
        const text = res.data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text !== 'string') {
          throw new Error('Gemini returned no content');
        }
        return {
          content: text,
          tokensIn: res.data.usageMetadata?.promptTokenCount ?? 0,
          tokensOut: res.data.usageMetadata?.candidatesTokenCount ?? 0,
        };
      } catch (error: unknown) {
        lastError = error;
        const retriable = this.isRetriable(error);
        this.logger.warn(
          `gemini call attempt ${attempt + 1} failed (retriable=${retriable}): ${this.errMsg(error)}`,
        );
        if (!retriable || attempt === MAX_RETRIES) break;
        await this.sleep(RETRY_BACKOFF_MS * Math.pow(2, attempt));
      }
    }
    throw new Error(`Gemini upstream failed: ${this.errMsg(lastError)}`);
  }

  /** Map OpenAI-style messages to Gemini's shape:
   *   - 'system' → top-level systemInstruction
   *   - 'user' → role:'user'
   *   - 'assistant' → role:'model'
   *  Multiple system messages are concatenated.
   */
  private toGeminiShape(messages: ChatMessage[]): {
    systemInstruction: string;
    contents: GeminiContent[];
  } {
    const systemParts: string[] = [];
    const contents: GeminiContent[] = [];
    for (const m of messages) {
      if (m.role === 'system') {
        systemParts.push(m.content);
      } else {
        contents.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        });
      }
    }
    return {
      systemInstruction: systemParts.join('\n\n'),
      contents,
    };
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
      const e = error as AxiosError<GeminiResponse>;
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
