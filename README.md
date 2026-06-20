# Night-Shift Handover Service

A backend that turns a hotel's overnight events — structured logs plus free-text relief-staff notes — into an action-first handover the morning manager can trust at 7am.

Built as a 2-hour take-home for Vouch ([`BRIEF.md`](BRIEF.md)). Design rationale lives in [`DECISIONS.md`](DECISIONS.md); deeper docs in [`docs/`](docs/).

## Quick start

```bash
cp .env.example .env       # set DEEPSEEK_API_KEY or GEMINI_API_KEY
npm install
npm run start:dev
```

Then in another shell:

```bash
# Run the pipeline against the bundled sample data
curl http://localhost:3000/handover/sample | jq .

# Same, but rendered as a manager-facing HTML page
open "http://localhost:3000/handover/sample?format=html"

# POST your own payload
curl -X POST http://localhost:3000/handover \
  -H 'content-type: application/json' \
  -d "$(jq '{hotel, events, nightLog: "", targetMorning: "2026-05-30"}' data/events.json)"
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness |
| `GET` | `/handover/sample?targetMorning=YYYY-MM-DD&format=json\|html` | Run against `data/` |
| `POST` | `/handover` | Run against a body you provide (see `docs/06-api.md`) |

## What it does

```
POST /handover
   │
   ▼
INGEST → EXTRACT (LLM) → NORMALIZE → THREAD → CLASSIFY → RENDER (LLM) → VALIDATE
                                                                            │
                                                                            ▼
                                                      handover JSON or HTML
```

- **EXTRACT** parses free-text night logs into normalized events; every extracted event carries a source quote.
- **THREAD** reconciles across nights — `still_open` vs `newly_resolved` vs `new_tonight`. The morning manager does not see the same open item re-reported every day.
- **VALIDATE** is the grounding gate: any sentence whose numbers, currency, or proper nouns aren't supported by the cited evidence is stripped before the response leaves the server.
- **Prompt-injection defense** quarantines suspicious events to `flags` before the prose LLM ever sees them. The sample data contains a real injection (`evt_0026`) for the reviewer to verify.

LLM use is confined to stages 2 and 6. Everything else is deterministic and unit-tested.

## LLM providers

Two are wired up; pick via `LLM_PROVIDER` in `.env`:

- `deepseek` (default) — `deepseek-chat`, JSON mode, low temperature.
- `gemini` — `gemini-2.5-flash`.

Both implement the same `LlmClient` interface. Swap freely; the pipeline doesn't care which one is loaded.

## Development

```bash
npm test            # unit tests
npm run test:cov    # coverage
npm run test:e2e    # e2e
npm run lint
npm run build
```

Run a single test:

```bash
npx jest src/handover/pipeline/thread.spec.ts
npx jest -t "stops grounding violations"
```

## Deploy

Cloud Run scripts live in [`script/`](script/):

```bash
./script/deploy.sh                       # deploy from .env
./script/test-prod.sh                    # smoke the deployed URL
./script/logs.sh tail                    # live logs
./script/logs.sh trace ho_2026-05-30_lumen-sg_abcd   # filter by handoverId
```

## Repository layout

```
src/
  handover/
    handover.controller.ts      # POST /handover, GET /handover/sample
    handover.service.ts         # orchestrates the 7-stage pipeline
    pipeline/                   # one file per stage; pure-ish + unit-tested
    dto/                        # zod schemas at the API boundary
  llm/
    llm.client.ts               # provider-agnostic interface
    deepseek.client.ts          # DeepSeek implementation
    gemini.client.ts            # Gemini implementation
    prompts/                    # versioned prompt templates
  common/                       # time/timezone helpers, shared types
  health.controller.ts
  main.ts

docs/                           # design docs (overview → decisions → deps)
script/                         # Cloud Run deploy + smoke + logs
data/                           # sample inputs (events.json + night-logs.md)
```

## Further reading

- [`BRIEF.md`](BRIEF.md) — the task as given.
- [`DECISIONS.md`](DECISIONS.md) — what I built, what I skipped, why.
- [`docs/02-architecture.md`](docs/02-architecture.md) — pipeline detail.
- [`docs/04-ai-strategy.md`](docs/04-ai-strategy.md) — where LLMs live, what they're constrained by.
- [`docs/05-grounding.md`](docs/05-grounding.md) — the validator and injection defense in depth.
- [`docs/conversation-log.md`](docs/conversation-log.md) — AI conversation export (per brief).
