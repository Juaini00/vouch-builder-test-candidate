# 07 — Observability

Goal: another builder (or an AI agent) can diagnose a bad handover in production with **only the logs**, no live debugging.

## Log format

Structured JSON via `pino`. One log line = one event. Every line carries:

```json
{
  "ts": "2026-05-30T07:02:14.123Z",
  "level": "info",
  "msg": "...",
  "handoverId": "ho_2026-05-30_lumen-sg_a8c2",
  "hotelId": "lumen-sg",
  "targetMorning": "2026-05-30",
  "stage": "extract | normalize | thread | classify | render | validate",
  "traceId": "uuid-for-request"
}
```

`handoverId` is also returned in the API response — operators can paste it into log search to find everything about a single handover.

## Per-stage logs

Each pipeline stage emits a `stage.start` and `stage.end` log line:

```json
{ "stage": "extract", "phase": "start", "input": { "nightLogChars": 2649 } }
{ "stage": "extract", "phase": "end",
  "durationMs": 4210, "llmTokensIn": 1340, "llmTokensOut": 980,
  "eventsExtracted": 8, "eventsDropped": 1,
  "drops": [{ "reason": "quote-not-in-source", "candidate": {...} }] }
```

## Critical event types

| `event` | When | Severity |
|---|---|---|
| `injection.suspected` | An input event matches injection heuristics | `warn` |
| `extraction.quote-mismatch` | LLM-returned quote not a substring of source | `warn` |
| `grounding.fallback-used` | Generated prose failed validation → templated fallback used | `warn` |
| `contradiction.detected` | Two events about same thread disagree | `info` |
| `llm.retry` | Upstream call retried after failure | `warn` |
| `llm.failed` | All retries exhausted | `error` |
| `thread.unknown-status` | Status logic couldn't decide; routed to flags | `warn` |

## Metrics worth surfacing (post-MVP)

Not built in v1, but the log shape supports aggregating later:

- p50 / p95 handover latency per hotel.
- LLM cost per handover.
- Rate of `grounding.fallback-used` per hotel (proxy for input quality / prompt drift).
- Rate of `injection.suspected` per hotel (proxy for adversarial pressure).

## Local dev

```bash
LOG_LEVEL=debug npm run start:dev | pino-pretty
```

`pino-pretty` renders the JSON streams readably without losing structure.

## What we do NOT log

- Raw API keys (obvious).
- Guest PII in body text gets logged because it's already in the operational data — but logs are short-lived (7 days retention assumed) and access-controlled. A production hardening step would be field-level redaction; out of scope for v1.
