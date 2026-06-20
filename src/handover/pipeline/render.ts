import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  Bucket,
  Evidence,
  HandoverItem,
  IncidentThread,
} from '../../common/types';
import { LlmClient } from '../../llm/llm.client';
import {
  SUMMARIZE_THREAD_SYSTEM,
  buildSummarizeUserPrompt,
} from '../../llm/prompts/summarize-thread';
import {
  checkGrounding,
  templatedBody,
  templatedTitle,
} from './validate';

const summarySchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(800),
});

export interface RenderResult {
  items: HandoverItem[];
  warnings: string[];
  llmCalls: number;
}

@Injectable()
export class RenderStage {
  private readonly logger = new Logger(RenderStage.name);

  constructor(private readonly llm: LlmClient) {}

  async run(
    classified: { thread: IncidentThread; bucket: Bucket }[],
  ): Promise<RenderResult> {
    const items: HandoverItem[] = [];
    const warnings: string[] = [];
    let llmCalls = 0;

    for (const { thread, bucket } of classified) {
      const dedupedEvidence = this.dedupeEvidence(
        thread.events.flatMap((e) => e.evidence),
      );

      // Flag-bucket threads (contradictions / injection) bypass the LLM
      if (bucket === 'flag') {
        items.push({
          threadId: thread.threadId,
          title: this.flagTitle(thread),
          body: this.flagBody(thread),
          room: thread.room,
          status: thread.status,
          evidence: dedupedEvidence,
          contradictions:
            thread.contradictions.length > 0
              ? thread.contradictions
              : undefined,
        });
        continue;
      }

      let title: string;
      let body: string;
      try {
        const res = await this.llm.chat(
          [
            { role: 'system', content: SUMMARIZE_THREAD_SYSTEM },
            { role: 'user', content: buildSummarizeUserPrompt(thread) },
          ],
          { jsonMode: true, maxOutputTokens: 300 },
        );
        llmCalls++;
        const parsed = summarySchema.parse(JSON.parse(res.content));
        const titleGround = checkGrounding(parsed.title, thread);
        const bodyGround = checkGrounding(parsed.body, thread);
        if (!titleGround.grounded || !bodyGround.grounded) {
          warnings.push(
            `grounding-fallback-used: ${thread.threadId} ungrounded=${[
              ...titleGround.ungrounded,
              ...bodyGround.ungrounded,
            ]
              .slice(0, 5)
              .join(',')}`,
          );
          title = templatedTitle(thread);
          body = templatedBody(thread);
        } else {
          title = parsed.title;
          body = parsed.body;
        }
      } catch (error: unknown) {
        warnings.push(
          `render-fallback-used: ${thread.threadId} (${this.errMsg(error)})`,
        );
        title = templatedTitle(thread);
        body = templatedBody(thread);
      }

      items.push({
        threadId: thread.threadId,
        title,
        body,
        room: thread.room,
        status: thread.status,
        evidence: dedupedEvidence,
      });
    }

    return { items, warnings, llmCalls };
  }

  private dedupeEvidence(list: Evidence[]): Evidence[] {
    const seen = new Set<string>();
    const out: Evidence[] = [];
    for (const e of list) {
      const k = `${e.sourceRef}::${e.quote}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
    }
    return out;
  }

  private flagTitle(thread: IncidentThread): string {
    if (thread.events.some((e) => e.suspectedInjection)) {
      return `Suspicious input (${
        thread.room ? `room ${thread.room}` : thread.topic
      }) — quarantined`;
    }
    if (thread.contradictions.length > 0) {
      return `Contradiction: ${thread.topic.replace(/_/g, ' ')}${
        thread.room ? ` (room ${thread.room})` : ''
      }`;
    }
    return templatedTitle(thread);
  }

  private flagBody(thread: IncidentThread): string {
    if (thread.events.some((e) => e.suspectedInjection)) {
      return `An input event matched injection heuristics and was excluded from automated summarisation. Preserved verbatim in evidence for human review.`;
    }
    if (thread.contradictions.length > 0) {
      return thread.contradictions.map((c) => c.description).join(' ');
    }
    return templatedBody(thread);
  }

  private errMsg(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown';
  }
}
