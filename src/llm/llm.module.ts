import { Logger, Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeepseekClient } from './deepseek.client';
import { GeminiClient } from './gemini.client';
import { LlmClient } from './llm.client';

const SUPPORTED_PROVIDERS = ['deepseek', 'gemini'] as const;
type LlmProvider = (typeof SUPPORTED_PROVIDERS)[number];

const llmClientProvider: Provider = {
  provide: LlmClient,
  inject: [ConfigService],
  useFactory: (config: ConfigService): LlmClient => {
    const raw = (config.get<string>('LLM_PROVIDER') ?? 'deepseek').toLowerCase();
    if (!SUPPORTED_PROVIDERS.includes(raw as LlmProvider)) {
      throw new Error(
        `Unsupported LLM_PROVIDER "${raw}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}`,
      );
    }
    const client: LlmClient =
      (raw as LlmProvider) === 'gemini'
        ? new GeminiClient(config)
        : new DeepseekClient(config);
    new Logger('LlmModule').log(`LLM provider: ${client.providerName}`);
    return client;
  },
};

@Module({
  providers: [llmClientProvider],
  exports: [LlmClient],
})
export class LlmModule {}
