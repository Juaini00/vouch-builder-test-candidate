# 02 — Architecture

## High-level pipeline

```
┌────────────────────┐
│  POST /handover    │  { hotel, events[], nightLog?, targetMorning }
└──────────┬─────────┘
           │
           ▼
┌─────────────────────────┐
│ 1. INGEST               │  Parse + validate input. Reject malformed.
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 2. EXTRACT              │  Free-text night log → normalized events.
│    (LLM: DeepSeek)      │  Each extracted event carries a source quote.
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 3. NORMALIZE            │  Merge structured + extracted into one
│    (deterministic)      │  canonical event list, sorted by timestamp.
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 4. THREAD               │  Group events into incidents (threads).
│    (deterministic +     │  Match by room + topic. Assign status
│     LLM-assisted topic) │  (still_open / newly_resolved / new_tonight).
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 5. CLASSIFY             │  Rules-based + LLM-assisted bucketing:
│                         │  on_fire / pending / fyi / flag.
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 6. RENDER               │  Compose handover JSON.
│                         │  Optional: LLM writes manager-facing prose
│                         │  per thread, post-validated against evidence.
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 7. VALIDATE             │  Reject/strip any output sentence whose
│                         │  cited evidence doesn't exist or doesn't
│                         │  support the claim (lexical overlap check).
└──────────┬──────────────┘
           │
           ▼
        Response
   (JSON or HTML)
```

## Module layout (NestJS)

```
src/
  app.module.ts
  main.ts
  handover/
    handover.controller.ts        # POST /handover, GET /handover/sample
    handover.service.ts           # orchestrates the pipeline
    pipeline/
      ingest.ts                   # zod schemas, validators
      extract.ts                  # LLM call to parse night-log
      normalize.ts                # merges + canonicalizes events
      thread.ts                   # incident threading
      classify.ts                 # bucketing
      render.ts                   # compose handover
      validate.ts                 # grounding check
    dto/
      input.dto.ts
      handover.dto.ts
  llm/
    deepseek.client.ts            # thin HTTP client, retries, timeout
    prompts/
      extract-nightlog.ts
      summarize-thread.ts
    schemas/                      # JSON schemas the LLM must obey
  common/
    logger.ts                     # structured (pino) logger
    time.ts                       # shift-window helpers (hotel-local tz)
    errors.ts
```

## Why NestJS

- Built-in DI makes swapping the LLM client (DeepSeek → Gemini → mock) trivial in tests.
- Validation pipes + DTO classes give us boundary validation for free.
- Familiar to most backend reviewers; not exotic.

## Why pipeline shape

Each stage is **pure-ish** (input → output, no I/O except the LLM client which is injected) so:

- Each stage is independently testable with fixtures.
- Failures localize: a bad handover comes with logs telling us *which stage* produced the bad data.
- The LLM is contained to two stages (extract, optionally render). The rest is deterministic logic we control.

## Deployment

- **Runtime:** Node 20.
- **Target:** Railway / Fly.io / Render — pick whichever deploys fastest from GitHub. (TBD; recorded in `08-decisions.md`.)
- Health check at `GET /health`.
- Env: `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `LOG_LEVEL`, `PORT`.
