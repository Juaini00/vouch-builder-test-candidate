# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A 2-hour take-home: a **Night-Shift Handover Service** for hotel front desks. Given a week of structured front-desk events (`data/events.json`) and free-text relief-staff logs (`data/night-logs.md`), it produces a manager-facing handover for the morning team that reconciles incidents across multiple nights.

Authoritative briefs:
- `BRIEF.md` — task description and grading dimensions (read this before doing any design work).
- `DECISIONS.md` — final design summary the brief asks for (root level).
- `docs/` — living design docs (overview, architecture, data model, AI strategy, grounding, API, observability, decisions, dependencies). `docs/08-decisions.md` is the running log; `DECISIONS.md` is the curated final.

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

## Deployment — Google Cloud Run

The service deploys to **GCP Cloud Run** (`semi-vouch` in `asia-southeast1` by default). All deployment glue lives in [`script/`](script/) and is endpoint-aware (knows about `/health`, `/handover`, `/handover/sample`).

```bash
./script/deploy.sh                          # build + deploy from .env
./script/test-prod.sh                       # smoke /health + /handover/sample + POST /handover
./script/logs.sh tail                       # live tail
./script/logs.sh trace ho_2026-05-30_lumen-sg_abcd   # filter by handoverId
./script/logs.sh app                        # Pino jsonPayload only
./script/logs.sh errors                     # severity >= WARNING
```

Override defaults via env: `SERVICE=`, `REGION=`, `MEMORY=`, `TIMEOUT=`, `MIN_INSTANCES=`, `MAX_INSTANCES=`. Preflight requires `gcloud auth login` and an active project (`gcloud config set project ...`). The `Dockerfile` at repo root is the build context.

`deploy.sh` reads `.env` and pushes every non-`PORT` key as a Cloud Run env var (Cloud Run injects its own `PORT`). Comma-safe via the `^|^` delimiter syntax.

## Architecture (must-know before editing)

The service is a **7-stage pipeline** inside one NestJS request. Each stage is pure-ish (input → output) and individually testable. LLM calls are confined to **stages 2 and 6** — the rest is deterministic logic we control.

```
POST /handover → INGEST → EXTRACT (LLM) → NORMALIZE → THREAD →
                 CLASSIFY → RENDER (LLM) → VALIDATE → response
```

- **INGEST** (`pipeline/ingest.ts`) — zod-validate, normalize timestamps to hotel tz, run injection sweep (`pipeline/injection.ts`).
- **EXTRACT** (`pipeline/extract.ts`) — LLM converts the free-text night log into normalized events, each carrying a source quote. Schema-validated; malformed responses degrade to a single "unparsed log" event.
- **NORMALIZE** (`pipeline/normalize.ts`) — merge structured + extracted into one canonical event list, sorted by timestamp.
- **THREAD** (`pipeline/thread.ts`) — group events by `room + topic + guest`. Assign `still_open` / `newly_resolved` / `new_tonight` anchored on `shiftDate` (the morning the shift ends on).
- **CLASSIFY** (`pipeline/classify.ts`) — bucket into `on_fire` / `pending` / `fyi` / `flag` via rules + light LLM tiebreaker.
- **RENDER** (`pipeline/render.ts`) — compose handover JSON, LLM writes per-thread prose, then immediately runs the validator below.
- **VALIDATE** (`pipeline/validate.ts`) — **grounding gate**. Strips any sentence whose numbers, currency, or proper nouns aren't supported by the cited evidence. Failures recorded in `meta.warnings`.

Module layout (current — pipeline is built, not scaffold):

```
src/
  main.ts
  app.module.ts
  health.controller.ts
  handover/
    handover.controller.ts          # POST /handover, GET /handover/sample
    handover.service.ts             # orchestrates the pipeline
    handover.module.ts
    handover.view.ts                # server-rendered HTML
    dto/input.dto.ts                # zod schemas
    pipeline/{ingest,extract,normalize,thread,classify,render,validate,injection}.ts
  llm/
    llm.client.ts                   # provider-agnostic interface
    llm.module.ts                   # selects provider via LLM_PROVIDER
    deepseek.client.ts
    gemini.client.ts
    prompts/{extract-nightlog,summarize-thread}.ts
  common/{time,types}.ts
```

## Non-negotiable rules from the brief

1. **Grounding is the bar.** Every statement in the handover MUST trace to an input `event_id`. The VALIDATE stage exists for this — never bypass it, never let LLM prose ship without it. Flag contradictions; do not paper over them.
2. **Generalize.** Don't hard-code to the sample data — graders will run unseen night logs (possibly non-English).
3. **Reconciliation across nights** is the whole point. A handover must distinguish `still_open` vs `newly_resolved` vs `new_tonight` — don't re-report every open item from scratch.
4. **Structured logging per stage** is required so a bad handover can be debugged: which hotel, which night, which stage failed. `script/logs.sh trace <handoverId>` is the entry point for that.

## LLM usage

Two providers are wired and pluggable via `LLM_PROVIDER` in `.env`:

- `deepseek` (default) — `deepseek-chat`, JSON mode, low temperature.
- `gemini` — `gemini-2.5-flash`.

Both implement `LlmClient` (`src/llm/llm.client.ts`); the pipeline never imports a provider directly. `LlmModule` lazy-instantiates the chosen client based on `LLM_PROVIDER` so switching providers requires zero code change.

Rules for editing pipeline code:
- LLM is allowed **only** in stages 2 (EXTRACT) and 6 (RENDER). Do not call it from NORMALIZE / THREAD / CLASSIFY / VALIDATE.
- Inject the client via Nest DI; in unit tests, mock the `LlmClient` rather than calling the real API.

## Dependencies

Already installed; see `docs/09-dependencies.md` for the per-package rationale.

- `zod` — input + LLM-output validation
- `@nestjs/config` — typed env
- `@nestjs/axios` + `axios` — HTTP for LLM providers
- `nestjs-pino` + `pino` — structured per-request logs (rendered nicely by `script/logs.sh`)
- `luxon` — hotel-local timezone math
- `class-validator` + `class-transformer` — DTO pipes

## Environment

Loaded via `@nestjs/config` from `.env`. **`.env.example` and `.env` must stay in sync** (same key set); any key in either file must be consumed by code — there's no dead config.

| Var | Purpose |
|---|---|
| `PORT`, `NODE_ENV`, `LOG_LEVEL` | Server basics. Cloud Run overrides `PORT` at runtime. |
| `LLM_PROVIDER` | `deepseek` (default) or `gemini` |
| `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `DEEPSEEK_TIMEOUT_MS`, `DEEPSEEK_MAX_OUTPUT_TOKENS`, `DEEPSEEK_TEMPERATURE` | DeepSeek client config |
| `GEMINI_API_KEY`, `GEMINI_BASE_URL`, `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS`, `GEMINI_MAX_OUTPUT_TOKENS`, `GEMINI_TEMPERATURE` | Gemini client config |
| `DATA_ROOT` | Sample-data path used by `GET /handover/sample` (defaults to `./data`) |

`.env` is gitignored — never commit it. Hotel timezone comes from the request body (`hotel.timezone`), not env.

## Conventions

- All time reasoning happens in **hotel-local** time (IANA zone from request `hotel.timezone`). A "night shift" = `[date T 23:00, (date+1) T 07:00)`. A handover "for morning of YYYY-MM-DD" reports the shift that ended that morning. Events are anchored on `shiftDate` (the morning the shift ends).
- Every output claim carries an `evidence[]` array of source `event_id`s.
- Commits use conventional prefixes (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`). Do not squash — the brief asks for full commit history.

## What is intentionally out of scope (do not add)

No database, no queue, no auth, no caching layer. The service is stateless — a handover is computed per request from the posted payload. See `DECISIONS.md` and `docs/09-dependencies.md` for the rationale.
