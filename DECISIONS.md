# DECISIONS.md

Final design decisions for the Vouch Builder take-home. The running log lives in [`docs/08-decisions.md`](docs/08-decisions.md); this file is the curated summary the brief asks for.

---

## What I built (and what I deliberately skipped)

### Built

- **NestJS service** exposing:
  - `POST /handover` — body in, handover out (JSON or HTML).
  - `GET /handover/sample` — runs the pipeline on the sample data in `data/` so the reviewer can try it with one curl.
  - `GET /health` — liveness.
- A **7-stage pipeline** (ingest → extract → normalize → thread → classify → render → validate). Stages are pure-ish modules so each is unit-testable in isolation.
- **Two pluggable LLM providers** (DeepSeek, Gemini) selected via `LLM_PROVIDER`. Both implement the same `LlmClient` interface; the pipeline never calls a provider directly.
- **Grounding validator** (`pipeline/validate.ts`) that strips any LLM-generated sentence whose numbers, currency amounts, or proper nouns aren't lexically supported by the cited evidence. Failure mode = strip the unsupported sentence, not silently keep it.
- **Prompt-injection defense** (`pipeline/injection.ts`) that quarantines suspicious events into the `flags` section before the prose-render LLM sees them. The sample data contains a real injection in `evt_0026` — exercised by the test suite.
- **Pino structured logging**, one log line per stage with `handoverId` + `hotelId` + `stage`, so a bad output can be traced in production.
- **Cloud Run deploy + smoke-test scripts** in `script/` driving the actual endpoints.
- **HTML view** so a manager can read the handover in a browser without a frontend.

### Skipped (on purpose)

- **No DB / no queue / no auth.** Stateless service — the caller provides the full event window per request. Adding persistence would have eaten the timebox.
- **No agentic loop / no LangChain.** A linear pipeline is easier to ground and to debug than an agent.
- **No embedding-based threading.** Keyword + room + guest taxonomy covered the sample cleanly. Embeddings are listed in the hour-3-6 plan.
- **No Slack/email delivery.** JSON + HTML satisfy the "way to view it" requirement without adding OAuth/SMTP infra.
- **No reflection loop** ("ask the model to critique itself"). Code-level validation is cheaper and more reliable than a second LLM call.

---

## How I handle reconciliation across nights

Every event is anchored to a `shiftDate` — **the morning the shift it falls in will end on**. A night spans two calendar dates; `shiftDate` collapses that to one unambiguous bucket per event.

Threading groups events by `room + topic-keyword + guest` across the full provided history (not just the target shift). Each thread carries a `status`:

- `new_tonight` — first event is in the target shift.
- `still_open` — opened on a prior shift, not yet resolved by the end of the target shift.
- `newly_resolved` — opened on a prior shift, resolved during the target shift.

The service then keeps threads that **touch the target shift, are still carrying open, contain contradictions, or look adversarial** — and drops anything cleanly resolved before the target shift. That's how it avoids the "re-report every open item from scratch every night" failure mode the brief warns about.

---

## How every statement stays grounded

Two layers, both required.

1. **Schema-level grounding.** Every `HandoverItem` carries an `evidence[]` array of source `event_id`s with verbatim quotes. The render stage refuses to emit an item that has no evidence.
2. **Lexical validator** (`pipeline/validate.ts`). After the LLM writes the per-thread prose, every sentence is scanned for the **hallucination-prone tokens** — numbers ≥2 digits, currency amounts, and capitalized proper nouns (with a generous safe-token list for days/months/rooms/etc.). Each such token must appear in the cited evidence. Any sentence that fails is stripped and a warning is recorded in `meta.warnings`. The output never reaches the client unless every kept claim traces back.

### Incomplete / contradictory entries

The threading stage explicitly looks for contradictions inside a thread (e.g. one event says "resolved", a later event says "still leaking") and surfaces them in `item.contradictions[]`. The render stage **emits the contradiction verbatim instead of papering over it** — the manager sees both sides and decides. Items with contradictions are forced into the `flags` bucket regardless of severity.

### Stopping the LLM from inventing facts

- **Schema-constrained output** — the extract stage uses zod schemas on the LLM JSON; malformed responses are rejected and the original prose is degraded into a single "unparsed log" event with the raw text as evidence.
- **Low temperature** (`0.1`) — extraction, not creativity.
- **The validator above** — a hallucinated room number or guest name gets the sentence stripped before the client sees it.
- **Injection defense before the LLM call** — patterns like "ignore previous instructions" or "goodwill credit" cause an event to be marked `suspectedInjection` and routed to `flags`, never to the prose-render LLM.

---

## Where AI helped most, where it got in the way

**Helped most**

- **Free-text → structured events** (stage 2). Relief-staff logs are messy and multilingual; this is exactly the shape LLMs are good at.
- **Per-thread prose** (stage 6). The classifier picks the bucket; the LLM picks the *words* a manager wants to read at 7am. Constrained by the validator so it can't get creative with facts.

**Got in the way**

- **Threading and classification.** Early attempt used the LLM to group events directly — it was non-deterministic, expensive, and gave different answers for the same input. Replaced with rules-based threading + a small LLM tiebreaker only when keywords are ambiguous. Faster, testable, and the failure mode is "doesn't thread something" instead of "invents a wrong thread."
- **"Be careful not to hallucinate" in the system prompt.** Necessary, not sufficient. The validator is the wall.

---

## Hour 3–6 plan

1. **Persistence (Postgres).** API takes `(hotelId, targetMorning)`, service pulls the rolling event window itself. Removes the "caller posts everything" awkwardness.
2. **Embedding-based threading fallback** for cases where the keyword taxonomy misses (e.g. paraphrased room references).
3. **Per-hotel calibration** of on-fire thresholds (one hotel's noise complaint is FYI; another's is on-fire on repeat).
4. **Confidence scores** per `HandoverItem` so the manager can sort by certainty.
5. **Second-model judge** running on a random sample of items to catch model-specific failure modes.
6. **Metrics + alerting** (Prometheus) on `grounding.stripped-sentences` rate per hotel.
7. **Multilingual stress-test corpus** — synthetic night-logs in Bahasa / Thai / Tagalog so we can measure extraction quality before a new hotel comes online.

---

## One thing that surprised me

The sample data contains a real, well-crafted **prompt injection** inside the structured events (`evt_0026`: an "instruction" to issue a goodwill credit, phrased as a guest note). The brief didn't warn about it; it was just there, the way it would be in production.

It shifted my mental model from *"design the prompt so the LLM behaves"* to *"assume the LLM will be tricked; the validator and the injection-quarantine are the wall."* That's why the architecture has injection detection at ingest and grounding validation post-render — two independent layers, both running, neither trusting the other.
