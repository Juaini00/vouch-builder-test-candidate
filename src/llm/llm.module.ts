import { Module } from '@nestjs/common';
import { DeepseekClient } from './deepseek.client';

@Module({
  providers: [DeepseekClient],
  exports: [DeepseekClient],
})
export class LlmModule {}
