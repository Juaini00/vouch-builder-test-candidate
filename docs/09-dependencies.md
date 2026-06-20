# 06 — Dependencies

Stack overview for reviewers: what each package does, which pipeline stage uses it, and why it was chosen over alternatives.

## Runtime dependencies

| Package | Version | Role | Used in |
|---|---|---|---|
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` | ^11 | HTTP framework, DI container | All modules |
| `@nestjs/config` | latest | Typed env loading (`DEEPSEEK_API_KEY`, `LOG_LEVEL`, `PORT`, etc.) | `app.module`, `llm/deepseek.client` |
| `@nestjs/axios` + `axios` | latest | HTTP client wrapped in an injectable service for the DeepSeek call | `llm/deepseek.client` |
| `zod` | latest | Schema validation at the API boundary **and** for LLM JSON outputs | Stage 1 INGEST, Stage 2 EXTRACT (response parsing), Stage 6 RENDER |
| `class-validator`, `class-transformer` | latest | DTO decorators used by Nest's `ValidationPipe` for the controller layer | `handover.controller`, `dto/*` |
| `nestjs-pino` + `pino` + `pino-http` | latest | Structured JSON logs with per-request correlation IDs — needed so a bad handover can be traced to the stage that produced it | `common/logger`, every pipeline stage |
| `pino-pretty` | latest | Human-readable logs in local dev (`LOG_LEVEL=debug`) | dev only |
| `luxon` | latest | Hotel-local timezone arithmetic for the shift window (e.g. 22:00→06:00 local) | `common/time`, Stage 3 NORMALIZE, Stage 4 THREAD |
| `reflect-metadata`, `rxjs` | (from scaffold) | Required by Nest DI / interceptors | framework |

## Dev dependencies (already from scaffold)

- `jest`, `ts-jest`, `@nestjs/testing`, `supertest` — unit + e2e tests; each pipeline stage gets a fixture-driven spec.
- `@types/luxon` — types for the timezone helper.
- `typescript`, `eslint`, `prettier` — lint/format/build toolchain.

## Why these and not alternatives

- **zod over Joi / yup** — same package validates the API input AND the LLM's JSON output; one schema language across boundaries. Inferred TS types remove the `interface` + `validate` duplication.
- **axios via `@nestjs/axios` over native `fetch`** — interceptors give us a single place for retries, timeout, and request-ID propagation to the LLM call. Easy to mock in unit tests via DI.
- **pino over winston** — ~5× faster, JSON-first, designed for the "every stage logs a structured event" pattern this pipeline needs.
- **luxon over `Date` / dayjs** — first-class IANA timezone support; hotels run in local time and the brief explicitly involves an overnight shift window.
- **DeepSeek as primary LLM** — confined to stages 2 (EXTRACT) and optionally 6 (RENDER) per [02-architecture.md](02-architecture.md). The client is injected so Gemini or a mock can be swapped in tests without touching pipeline code. `GEMINI_API_KEY` is kept in `.env` as a fallback provider.

## Environment variables

See `.env.example`. Required at startup (validated by `@nestjs/config` schema):

- `DEEPSEEK_API_KEY` — LLM auth
- `DEEPSEEK_BASE_URL` — defaults to the public endpoint
- `PORT` — HTTP listen port
- `LOG_LEVEL` — `debug` | `info` | `warn` | `error`
- `HOTEL_TZ` — IANA zone for shift-window math (e.g. `Asia/Singapore`)

## What is intentionally NOT included

- **No database / ORM** — the service is stateless; a handover is computed per request from the posted payload.
- **No queue (BullMQ, etc.)** — the pipeline runs synchronously inside one request; no background work.
- **No auth library** — out of scope for the brief; add `@nestjs/passport` + JWT when productionizing.
- **No caching layer** — same reason; can add `cache-manager` later if the LLM cost becomes the bottleneck.
