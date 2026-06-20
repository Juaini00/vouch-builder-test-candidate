# Documentation Index

Living documentation for the **Night-Shift Handover Service**.

| # | Document | What it covers |
|---|---|---|
| 01 | [overview.md](./01-overview.md) | Purpose, users, success criteria |
| 02 | [architecture.md](./02-architecture.md) | High-level components & data flow |
| 03 | [data-model.md](./03-data-model.md) | Normalized event shape, threading model |
| 04 | [ai-strategy.md](./04-ai-strategy.md) | Where LLMs are used, prompts, guardrails, injection defense |
| 05 | [grounding.md](./05-grounding.md) | How every output statement traces to a source |
| 06 | [api.md](./06-api.md) | HTTP endpoints, request/response shapes, sample `curl` |
| 07 | [observability.md](./07-observability.md) | Structured logging, debug fields |
| 08 | [decisions.md](./08-decisions.md) | Tradeoffs, deliberately-skipped items, hour 3–6 plan |

## Conventions

- All times are stored & reasoned about in the **hotel's local timezone** (see `hotel.timezone` in input).
- A "night shift" = `[date T 23:00, (date+1) T 07:00)` in hotel-local time.
- A "handover for morning of `YYYY-MM-DD`" reports on the shift that **ended** that morning.
- Every claim in generated output carries an `evidence[]` array of source `event_id`s.

## LLM provider

DeepSeek (`deepseek-chat`) is the primary model. Configured via `.env`:

```
DEEPSEEK_API_KEY=...        # rotate before sharing repo
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_TEMPERATURE=0.1    # low — we want extraction, not creativity
```

Gemini key is present as a fallback but not used in v1.
