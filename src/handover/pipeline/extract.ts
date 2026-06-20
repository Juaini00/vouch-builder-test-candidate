import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CanonicalEvent } from '../../common/types';
import { shiftDateFor } from '../../common/time';
import { LlmClient } from '../../llm/llm.client';
import {
  EXTRACT_NIGHTLOG_SYSTEM,
  buildExtractUserPrompt,
} from '../../llm/prompts/extract-nightlog';
import { looksLikeInjection } from './injection';

const extractedSchema = z.object({
  events: z.array(
    z.object({
      approximate_timestamp: z.string().nullable(),
      type: z.string(),
      room: z.string().nullable(),
      guest: z.string().nullable(),
      description_english: z.string(),
      original_quote: z.string(),
      language_detected: z.string(),
      status: z.enum(['resolved', 'unresolved', 'pending', 'unknown']),
      extraction_confidence: z.number().min(0).max(1),
    }),
  ),
});

export interface ExtractResult {
  events: CanonicalEvent[];
  warnings: string[];
  llmCalls: number;
}

@Injectable()
export class ExtractStage {
  private readonly logger = new Logger(ExtractStage.name);

  constructor(private readonly llm: LlmClient) {}

  async run(
    nightLog: string | undefined,
    timezone: string,
    targetMorning: string,
  ): Promise<ExtractResult> {
    if (!nightLog || nightLog.trim().length === 0) {
      return { events: [], warnings: [], llmCalls: 0 };
    }

    const warnings: string[] = [];
    let llmCalls = 0;

    let raw: string;
    try {
      const res = await this.llm.chat(
        [
          { role: 'system', content: EXTRACT_NIGHTLOG_SYSTEM },
          {
            role: 'user',
            content: buildExtractUserPrompt(
              timezone,
              targetMorning,
              nightLog,
            ),
          },
        ],
        { jsonMode: true, maxOutputTokens: 2000 },
      );
      raw = res.content;
      llmCalls++;
    } catch (error: unknown) {
      this.logger.error(`night-log extraction failed: ${this.errMsg(error)}`);
      warnings.push(`night-log extraction failed; nightLog ignored`);
      return { events: [], warnings, llmCalls };
    }

    let parsed: z.infer<typeof extractedSchema>;
    try {
      parsed = extractedSchema.parse(JSON.parse(raw));
    } catch (error: unknown) {
      this.logger.error(`extracted JSON invalid: ${this.errMsg(error)}`);
      warnings.push('extracted JSON invalid; nightLog ignored');
      return { events: [], warnings, llmCalls };
    }

    const events: CanonicalEvent[] = [];
    for (const candidate of parsed.events) {
      if (!nightLog.includes(candidate.original_quote)) {
        warnings.push(
          `extraction-quote-not-in-source: dropped event "${candidate.description_english.slice(0, 60)}"`,
        );
        continue;
      }
      if (!candidate.approximate_timestamp) {
        warnings.push(
          `extraction-no-timestamp: dropped event "${candidate.description_english.slice(0, 60)}"`,
        );
        continue;
      }
      const ts = candidate.approximate_timestamp;
      const id = this.makeExtractedId(candidate.original_quote);
      events.push({
        id,
        source: 'extracted',
        timestamp: ts,
        shiftDate: shiftDateFor(ts, timezone),
        type: candidate.type,
        room: candidate.room,
        guest: candidate.guest,
        description: candidate.description_english,
        status: candidate.status,
        evidence: [
          {
            sourceRef: `night-logs.md`,
            quote: candidate.original_quote,
            language: candidate.language_detected,
          },
        ],
        extractionConfidence: candidate.extraction_confidence,
        suspectedInjection:
          looksLikeInjection(candidate.original_quote) ||
          looksLikeInjection(candidate.description_english),
      });
    }
    return { events, warnings, llmCalls };
  }

  private makeExtractedId(quote: string): string {
    const h = createHash('sha1').update(quote).digest('hex').slice(0, 8);
    return `ext_${h}`;
  }

  private errMsg(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown';
  }
}
