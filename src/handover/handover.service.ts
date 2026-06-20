import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  Bucket,
  Handover,
  HandoverItem,
  IncidentThread,
} from '../common/types';
import { isInShift, shiftWindow } from '../common/time';
import { HandoverRequest } from './dto/input.dto';
import { ingestStructured } from './pipeline/ingest';
import { ExtractStage } from './pipeline/extract';
import { normalize } from './pipeline/normalize';
import { buildThreads } from './pipeline/thread';
import { classify } from './pipeline/classify';
import { RenderStage } from './pipeline/render';

@Injectable()
export class HandoverService {
  private readonly logger = new Logger(HandoverService.name);

  constructor(
    private readonly extract: ExtractStage,
    private readonly render: RenderStage,
  ) {}

  async generate(req: HandoverRequest): Promise<Handover> {
    const tz = req.hotel.timezone;
    const handoverId = this.makeId(req.hotel.id, req.targetMorning);
    const window = shiftWindow(req.targetMorning, tz);

    const warnings: string[] = [];
    let llmCalls = 0;

    this.logger.log({
      msg: 'handover.start',
      handoverId,
      hotelId: req.hotel.id,
      targetMorning: req.targetMorning,
      stage: 'ingest',
    });

    const structured = ingestStructured(req.events, tz);

    const extractRes = await this.extract.run(
      req.nightLog,
      tz,
      req.targetMorning,
    );
    warnings.push(...extractRes.warnings);
    llmCalls += extractRes.llmCalls;

    const allEvents = normalize(structured, extractRes.events);

    // Threading is over ALL provided history; classification considers the target shift.
    const threads = buildThreads(allEvents, req.targetMorning);

    // Keep threads that touch the target shift, carry-forward open issues, have
    // contradictions, or look adversarial. Drop anything cleanly resolved before
    // the target shift.
    const relevantThreads = threads.filter((t) => {
      const hasTargetEvent = t.events.some((e) =>
        isInShift(e.timestamp, req.targetMorning, tz),
      );
      const stillCarrying = t.status === 'still_open';
      const hasContradiction = t.contradictions.length > 0;
      const hasInjection = t.events.some((e) => e.suspectedInjection);
      return (
        hasTargetEvent || stillCarrying || hasContradiction || hasInjection
      );
    });

    const classified = relevantThreads.map((thread) => ({
      thread,
      bucket: classify(thread),
    }));

    const renderRes = await this.render.run(classified);
    warnings.push(...renderRes.warnings);
    llmCalls += renderRes.llmCalls;

    const byBucket: Record<Bucket, HandoverItem[]> = {
      on_fire: [],
      pending: [],
      fyi: [],
      flag: [],
    };
    for (let i = 0; i < classified.length; i++) {
      byBucket[classified[i].bucket].push(renderRes.items[i]);
    }
    // Order on-fire by topic urgency (compliance deadlines, leaks, safe, medical first)
    const urgencyOrder = [
      'compliance_scanner',
      'leak',
      'safe',
      'medical',
      'damage',
      'deposit',
    ];
    const orderBy = (a: HandoverItem, b: HandoverItem): number => {
      const tA = a.threadId;
      const tB = b.threadId;
      const iA = urgencyOrder.findIndex((u) => tA.includes(u));
      const iB = urgencyOrder.findIndex((u) => tB.includes(u));
      const nA = iA === -1 ? Number.MAX_SAFE_INTEGER : iA;
      const nB = iB === -1 ? Number.MAX_SAFE_INTEGER : iB;
      return nA - nB;
    };

    const handover: Handover = {
      handoverId,
      hotel: { id: req.hotel.id, name: req.hotel.name },
      targetMorning: req.targetMorning,
      shiftWindow: window,
      generatedAt: new Date().toISOString(),
      sections: {
        onFire: byBucket.on_fire.sort(orderBy),
        pending: byBucket.pending,
        fyi: byBucket.fyi,
        flags: byBucket.flag,
      },
      meta: {
        eventsIngested: req.events.length,
        extractedFromProse: extractRes.events.length,
        threadsBuilt: relevantThreads.length,
        llmCalls,
        warnings,
      },
    };

    this.logger.log({
      msg: 'handover.end',
      handoverId,
      onFire: handover.sections.onFire.length,
      pending: handover.sections.pending.length,
      fyi: handover.sections.fyi.length,
      flags: handover.sections.flags.length,
      llmCalls,
      warnings: warnings.length,
    });

    return handover;
  }

  private makeId(hotelId: string, targetMorning: string): string {
    const h = createHash('sha1')
      .update(`${hotelId}|${targetMorning}|${Date.now()}`)
      .digest('hex')
      .slice(0, 4);
    return `ho_${targetMorning}_${hotelId}_${h}`;
  }
}

/** Helper used by external diagnostics. */
export function summarizeThread(t: IncidentThread): string {
  return `${t.threadId} (${t.status}, ${t.events.length} events)`;
}
