# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A 2-hour take-home: a **Night-Shift Handover Service** for hotel front desks. Given a week of structured front-desk events (`data/events.json`) and free-text relief-staff logs (`data/night-logs.md`), it produces a manager-facing handover for the morning team that reconciles incidents across multiple nights.

Authoritative briefs:
- `BRIEF.md` — task description and grading dimensions (read this before doing any design work).
- `docs/` — living design docs (overview, architecture, data model, AI strategy, grounding, dependencies, decisions). Always consult before implementing a stage — the architecture is decided.

## Commands

```bash
npm run start:dev          # nest start --watch (local dev)
npm run start              # nest start
npm run start:prod         # node dist/main (after build)
npm run build              # nest build

npm test                   # all unit tests
npm test -- path/to/file.spec.ts          # single file
npm test -- -t "test name regex"          # single test by name
npm run test:watch
npm run test:cov           # coverage
npm run test:e2e           # uses test/jest-e2e.json

npm run lint               # eslint --fix
npm run format             # prettier write
```

## Architecture (must-know before editing)

The service is a **7-stage pipeline** inside one NestJS request. Each stage is pure-ish (input → output) and individually testable. LLM calls are confined to **stages 2 and (optionally) 6** — the rest is deterministic logic we control.

```
POST /handover → INGEST → EXTRACT (LLM) → NORMALIZE → THREAD →
                 CLASSIFY → RENDER (LLM-optional) → VALIDATE → response
```

- **INGEST** — zod-validate the request body; reject malformed input.
- **EXTRACT** — DeepSeek converts the free-text night log into normalized events, each carrying a **source quote** for grounding.
- **NORMALIZE** — merge structured + extracted events into one canonical list sorted by timestamp (hotel-local tz, via `luxon`).
- **THREAD** — group events into incidents by room + topic; assign `still_open` / `newly_resolved` / `new_tonight` based on cross-night state.
- **CLASSIFY** — rules + light LLM assist to bucket into `on_fire` / `pending` / `fyi` / `flag`.
- **RENDER** — compose handover JSON; LLM may write per-thread prose.
- **VALIDATE** — **grounding gate**. Strip any sentence whose cited evidence doesn't lexically support it. Nothing reaches the client unless every claim traces back to a source `event_id`.

Module layout target (see `docs/02-architecture.md`):

```
src/handover/{handover.controller, handover.service, pipeline/*, dto/*}
src/llm/{deepseek.client, prompts/*, schemas/*}
src/common/{logger, time, errors}
```

Current `src/` still contains the Nest scaffold (`app.controller.ts`, etc.) — replace as the pipeline modules land.

## Non-negotiable rules from the brief

1. **Grounding is the bar.** Every statement in the handover MUST trace to an input `event_id`. The VALIDATE stage exists for this — never bypass it, never let LLM prose ship without it. Flag contradictions; do not paper over them.
2. **Generalize.** Don't hard-code to the sample data — the graders will run unseen night logs (possibly non-English).
3. **Reconciliation across nights** is the whole point. A handover must distinguish `still_open` vs `newly_resolved` vs `new_tonight` — don't re-report every open item from scratch.
4. **Structured logging per stage** is required so a bad handover can be debugged: which hotel, which night, which stage failed.

## LLM usage

- Primary: **DeepSeek** (`deepseek-chat`, low temperature for extraction).
- Gemini key exists in `.env` as a fallback provider but is unused in v1.
- LLM client is injected via Nest DI — swap to a mock in unit tests rather than calling the real API.
- LLM is allowed in stages 2 and 6 only. Do not introduce it into NORMALIZE / THREAD / CLASSIFY / VALIDATE.

## Dependencies

Already installed; see `docs/09-dependencies.md` for the per-package rationale.

- `zod` — input + LLM-output validation
- `@nestjs/config` — typed env
- `@nestjs/axios` + `axios` — DeepSeek client
- `nestjs-pino` + `pino` — structured per-request logs
- `luxon` — hotel-local timezone math
- `class-validator` + `class-transformer` — DTO pipes

## Environment

Required env (loaded via `@nestjs/config`): `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `DEEPSEEK_TEMPERATURE`, `PORT`, `LOG_LEVEL`, `HOTEL_TZ`. See `.env.example`. `.env` is gitignored — never commit it.

## Conventions

- All time reasoning happens in **hotel-local** time (IANA zone from input or `HOTEL_TZ`). A "night shift" = `[date T 23:00, (date+1) T 07:00)`. A handover "for morning of YYYY-MM-DD" reports the shift that ended that morning.
- Every output claim carries an `evidence[]` array of source `event_id`s.
- Commits use conventional prefixes (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`). Do not squash — the brief asks for full commit history.

## What is intentionally out of scope (do not add)

No database, no queue, no auth, no caching layer. The service is stateless — a handover is computed per request from the posted payload. See `docs/09-dependencies.md` for the rationale.
