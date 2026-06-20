# 03 — Data Model

## Canonical event (post-normalization)

Every input — structured JSON event or extracted-from-prose snippet — is normalized to this shape:

```ts
type CanonicalEvent = {
  id: string                    // evt_NNNN for structured; ext_<hash> for extracted
  source: 'structured' | 'extracted'
  timestamp: string             // ISO 8601 with offset, hotel-local
  shiftDate: string             // YYYY-MM-DD — the MORNING this shift ends on
  type: string                  // free-form taxonomy; not enforced
  room: string | null
  guest: string | null
  description: string           // verbatim from input (or extracted span)
  status: 'resolved' | 'unresolved' | 'pending' | 'unknown'
  evidence: {
    sourceRef: string           // 'events.json#evt_0007' | 'night-logs.md:L17-L19'
    quote: string               // the exact substring backing this event
    language?: string           // ISO 639-1 if extracted (e.g. 'zh', 'en')
  }[]
  extractionConfidence?: number // 0-1; only set when source === 'extracted'
}
```

### Why `shiftDate`

A single night spans two calendar dates. Anchoring on the *morning the shift ends* gives every event one unambiguous "handover bucket."

```
event at 2026-05-27 T 02:05 +08:00  →  shiftDate = 2026-05-27
event at 2026-05-26 T 23:50 +08:00  →  shiftDate = 2026-05-27   (next-day morning)
```

Boundary rule: `shiftDate = (timestamp >= 23:00) ? next_calendar_day : same_calendar_day` in hotel-local tz.

## Incident thread

Multiple events about the same underlying issue are grouped:

```ts
type IncidentThread = {
  threadId: string
  topic: string                 // short label, e.g. 'aircon_room_112'
  room: string | null
  firstSeen: string             // ISO timestamp
  lastUpdate: string
  events: CanonicalEvent[]      // ordered by timestamp
  status: 'still_open' | 'newly_resolved' | 'new_tonight' | 'unknown'
  contradictions: Contradiction[]
}
```

### Threading rules (deterministic first)

Two events join the same thread if **any** holds:

1. Same `room` AND overlapping topic keywords (aircon, leak, deposit, scanner, no-show, damage, etc.).
2. Same `guest` AND topic keywords overlap.
3. Explicit reference in description (regex for `re:`, `update on`, `still`, `已经`, `仍然`, etc.).

The keyword taxonomy is a static dictionary in `thread.ts`. LLM is only consulted as a tiebreaker when deterministic rules are ambiguous — and its proposed grouping must include a justification quoting both events.

### Status derivation

- `new_tonight` — all events in thread have `shiftDate === targetMorning`.
- `newly_resolved` — thread has prior-night unresolved events AND target-night event with `status: 'resolved'`.
- `still_open` — thread has unresolved events; no resolution on target night.
- `unknown` — cannot determine (e.g. contradictory updates) → goes to flags.

## Contradiction

```ts
type Contradiction = {
  kind: 'status_conflict' | 'fact_conflict' | 'system_vs_observation'
  description: string           // human-readable explanation
  evidence: { sourceRef: string; quote: string }[]   // ≥ 2 entries
}
```

Examples we expect to detect on the sample data:

- **312 no-show**: Thursday night-log says "charged," Friday `evt_0012` says guest disputes the charge → `status_conflict`.
- **Room 205**: System shows Daniel Chen in-house through Saturday (`evt_0024`), Wednesday night-log says room appears empty → `system_vs_observation`.

## Handover (output)

```ts
type Handover = {
  hotel: { id: string; name: string }
  targetMorning: string              // YYYY-MM-DD
  shiftWindow: { from: string; to: string }   // ISO
  generatedAt: string
  sections: {
    onFire: HandoverItem[]
    pending: HandoverItem[]
    fyi: HandoverItem[]
    flags: HandoverItem[]            // contradictions, incomplete entries, suspicious inputs
  }
  meta: {
    eventsIngested: number
    extractedFromProse: number
    threadsBuilt: number
    llmCalls: number
    warnings: string[]
  }
}

type HandoverItem = {
  threadId: string
  title: string                      // short, action-oriented
  body: string                       // 1-3 sentences
  room: string | null
  status: 'still_open' | 'newly_resolved' | 'new_tonight' | 'unknown'
  evidence: { sourceRef: string; quote: string }[]   // ALWAYS non-empty
  contradictions?: Contradiction[]
}
```

**Invariant:** `evidence.length >= 1` for every `HandoverItem`. The validator drops any item that violates this.
