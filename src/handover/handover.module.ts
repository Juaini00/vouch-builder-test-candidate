import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { HandoverController } from './handover.controller';
import { HandoverService } from './handover.service';
import { ExtractStage } from './pipeline/extract';
import { RenderStage } from './pipeline/render';

@Module({
  imports: [LlmModule],
  controllers: [HandoverController],
  providers: [HandoverService, ExtractStage, RenderStage],
})
export class HandoverModule {}
