export type EventSource = 'structured' | 'extracted';

export type EventStatus = 'resolved' | 'unresolved' | 'pending' | 'unknown';

export type ThreadStatus =
  | 'still_open'
  | 'newly_resolved'
  | 'new_tonight'
  | 'unknown';

export type Bucket = 'on_fire' | 'pending' | 'fyi' | 'flag';

export interface Evidence {
  sourceRef: string;
  quote: string;
  language?: string;
}

export interface CanonicalEvent {
  id: string;
  source: EventSource;
  timestamp: string;
  shiftDate: string;
  type: string;
  room: string | null;
  guest: string | null;
  description: string;
  status: EventStatus;
  evidence: Evidence[];
  extractionConfidence?: number;
  suspectedInjection?: boolean;
}

export interface Contradiction {
  kind: 'status_conflict' | 'fact_conflict' | 'system_vs_observation';
  description: string;
  evidence: Evidence[];
}

export interface IncidentThread {
  threadId: string;
  topic: string;
  room: string | null;
  firstSeen: string;
  lastUpdate: string;
  events: CanonicalEvent[];
  status: ThreadStatus;
  contradictions: Contradiction[];
}

export interface HandoverItem {
  threadId: string;
  title: string;
  body: string;
  room: string | null;
  status: ThreadStatus;
  evidence: Evidence[];
  contradictions?: Contradiction[];
}

export interface HandoverMeta {
  eventsIngested: number;
  extractedFromProse: number;
  threadsBuilt: number;
  llmCalls: number;
  warnings: string[];
}

export interface Handover {
  handoverId: string;
  hotel: { id: string; name: string };
  targetMorning: string;
  shiftWindow: { from: string; to: string };
  generatedAt: string;
  sections: {
    onFire: HandoverItem[];
    pending: HandoverItem[];
    fyi: HandoverItem[];
    flags: HandoverItem[];
  };
  meta: HandoverMeta;
}
