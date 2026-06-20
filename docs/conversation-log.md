# Conversation Log — Night-Shift Handover Service Build

Chronological record of requests and outcomes from the build session, for the AI conversation export deliverable.

---

## 1. Diagnose `nest new .` error
**User asked (Indonesian):**
> `nest new .` … `Error: A merge conflicted on path "/README.md".` … `kenapa error`

**Outcome:** Diagnosed root cause — Nest schematic refuses to overwrite pre-existing `README.md` (also `.gitignore`, `BRIEF.md`, `data/`). Offered three resolution paths (subfolder scaffold, rename and retry, dry-run preview). Recommended option 2 because `BRIEF.md` and `data/` were important to preserve.

---

## 2. Build deep understanding of the system before coding
**User asked (Indonesian):**
> you can read on `@BRIEF.md` … we have to build a system that can generate a handbook for the manager … I want you to understand more deeply first what system we will build now

**Outcome:** Read `BRIEF.md`, `data/events.json`, and `data/night-logs.md` in full. Returned a structured analysis covering:
- What the service does (night-shift handover for morning manager, 60-second skim).
- Why it's non-trivial: mixed input formats (structured + multilingual free-text Markdown), issues threading across nights, action-first ordering, grounding requirement, multi-tenant scale, observability.
- Surfaced concrete risks already present in the sample data: prompt injection in `evt_0026` (room 214 guest note), no-show 312 charge contradiction, room 205 system-vs-observation discrepancy, wifi complaint with no room identified.
- Proposed approach: deterministic parsing → LLM extraction with source quotes → deterministic reconciliation → constrained LLM rendering → post-generation grounding validation → prompt-injection quarantine.
- Asked three confirmation questions before designing.

---

## 3. Translate that analysis to English
**User asked:**
> can you translate my answer to English

**Outcome:** Delivered a full English version of the previous analysis, keeping the same structure (problem, six numbered points, core challenge, three confirmation questions).

---

## 4. Create a `docs/` folder with design documentation
**User asked:**
> first lets create doc folder where we can store all the document such as the purpose of this system, endpoints, AI, and all of important things. you can read env file we will use deepseek as main LLM to help us

**Outcome:**
- Flagged that `.env` keys (DeepSeek + Gemini) were shared in chat and recommended rotating them after the task; verified `.env` is gitignored and was never committed.
- Created nine docs:
  - `docs/README.md` — index + conventions + LLM provider note
  - `docs/01-overview.md` — problem, users, success criteria, non-goals
  - `docs/02-architecture.md` — 7-stage pipeline, module layout, why NestJS
  - `docs/03-data-model.md` — `CanonicalEvent`, `IncidentThread`, `Handover` shapes; shift-window math
  - `docs/04-ai-strategy.md` — where LLMs are used, prompts, injection defense
  - `docs/05-grounding.md` — the invariant + four layers of defense
  - `docs/06-api.md` — endpoints, request/response shapes, sample `curl`
  - `docs/07-observability.md` — pino structure, per-stage logs, critical events
  - `docs/08-decisions.md` — running tradeoff log + hour 3–6 plan + one surprise

---

## 5. Commit the docs
**User asked:**
> ok lets commit this changes first

**Outcome:** Noticed pre-existing staged files (`Dockerfile`, `.env.example`, `script/*`) unrelated to the docs work. Reset the index, staged only `docs/`, committed as `4ec42a3`:
```
docs: add design documentation for night-shift handover service
```
9 files, 780 insertions.

---

## 6. Implement the system
**User asked:**
> lets start the implementation

**Outcome:** Created and worked through 9 tracked tasks. Built in pipeline order:

1. **Foundation** — wired `@nestjs/config` (global) + `nestjs-pino` logger + `ValidationPipe` in `main.ts` / `app.module.ts`; added `src/health.controller.ts`; removed boilerplate AppController/AppService.
2. **Common helpers** — `src/common/types.ts` (full type system: `CanonicalEvent`, `IncidentThread`, `Handover`, etc.) and `src/common/time.ts` (shift-window math with Luxon, `shiftDateFor`, `shiftWindow`, `isInShift`).
3. **DeepSeek client** — `src/llm/deepseek.client.ts` (injectable HTTP client with timeout, retries, JSON mode) and `src/llm/llm.module.ts`.
4. **Ingest stage** — `src/handover/dto/input.dto.ts` (zod schema), `src/handover/pipeline/injection.ts` (regex heuristics), `src/handover/pipeline/ingest.ts` (structured event → canonical).
5. **Extract + Normalize** — `src/llm/prompts/extract-nightlog.ts` (system prompt with `<DATA>` quarantine), `src/handover/pipeline/extract.ts` (LLM call + verbatim-quote verification), `src/handover/pipeline/normalize.ts` (merge + sort).
6. **Thread + Classify** — `src/handover/pipeline/thread.ts` (topic-keyword threading, contradiction detection, status derivation) and `src/handover/pipeline/classify.ts` (rules for on_fire/pending/fyi/flag).
7. **Render + Validate** — `src/llm/prompts/summarize-thread.ts`, `src/handover/pipeline/render.ts` (LLM per thread, flag-bucket bypasses LLM), `src/handover/pipeline/validate.ts` (grounding check + templated fallback).
8. **Controller + sample endpoint + HTML view** — `src/handover/handover.service.ts` (orchestrator), `src/handover/handover.controller.ts` (POST `/handover`, GET `/handover/sample`), `src/handover/handover.view.ts` (HTML renderer), `src/handover/handover.module.ts`.
9. **End-to-end smoke test** — booted the server, hit `/handover/sample?targetMorning=2026-05-30`, inspected output.

**Iteration based on smoke results:**
- Fixed Express `Response` import → `import type` (TS isolatedModules).
- Fixed carry-forward logic: a thread whose latest event is unresolved/pending should be `still_open` regardless of whether the target shift contains an event.
- Rewrote grounding validator: focus on numbers / currency / proper nouns (where hallucination risk lives), not arbitrary English vocabulary — eliminates noisy fallbacks for words like "action", "needed", "review".
- Tightened topic-keyword rules and reordered them: `safe` before `compliance_scanner`; tightened the `compliance_scanner` regex so generic "passport" mentions in non-compliance contexts (booking name mismatch, safe locked with passport inside) don't collide.
- Dropped extracted events that lack an inferable timestamp instead of inventing one (and updated the extract prompt to instruct the model to read date references from the prose itself).
- Added a post-thread merge step that folds room-less threads into room-bearing same-topic threads when the room-less events explicitly mention the room — fixes the "leak in corridor near 215" being split across two threads.

**Final smoke against bundled data (handover for 2026-05-30):**

| Section | Count | Highlights |
|---|---|---|
| 🔥 On fire | 5 | passport scan backlog · safe locked 208 · medical 301 · damage 226 · deposit 309 |
| ⏳ Pending | 7 | aircon 112 · OTA name mismatch 309 · breakfast · early-checkout 220 · 108 deposit · 305 noise · 230 prepaid waiver |
| 🚩 Flags | 3 | 312 no-show contradiction · 205 occupancy mismatch · 214 prompt-injection quarantined |
| ℹ️ FYI | 1 | parcel 117 |

Cross-night threading verified: `thr_deposit_309` and `thr_no_show_312` each carry 3 evidence sources spanning structured + Markdown-extracted entries.

---

## 7. Make the LLM provider switchable via env (DeepSeek ↔ Gemini)
**User asked:**
> can you change the AI to use gemini, not change all but we can switch it from ENV

**Outcome:**
- Introduced an abstract `LlmClient` in `src/llm/llm.client.ts` (with shared `ChatMessage`, `ChatCompletionOptions`, `ChatCompletionResult` types and a `providerName` field).
- Refactored `DeepseekClient` to extend `LlmClient`.
- Added `src/llm/gemini.client.ts` — implements `LlmClient` against `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, mapping OpenAI-style messages to Gemini's shape (`system` → `systemInstruction`, `assistant` → `model`), with the same retry/timeout/JSON-mode contract.
- Rewrote `src/llm/llm.module.ts` as a factory provider that picks `DeepseekClient` or `GeminiClient` based on `LLM_PROVIDER` env var (default `deepseek`); only the chosen client is instantiated, so missing keys for the other provider don't crash startup.
- Updated `ExtractStage` and `RenderStage` to inject `LlmClient` (the abstract class), not `DeepseekClient`.
- Extended `.env.example` with `LLM_PROVIDER` and a full `GEMINI_*` block.
- Smoke-tested both providers:
  - `LLM_PROVIDER=deepseek` → `LLM provider: deepseek` logged, handover generated normally (`onFire: 5, pending: 7, fyi: 1, flags: 3`, 8 events extracted from prose).
  - `LLM_PROVIDER=gemini` → `LLM provider: gemini` logged, swap confirmed; Gemini API returned **403 (API disabled in the Google project)** — code-side abstraction works correctly; the pipeline degraded gracefully (handover still generated from structured events alone, `llmCalls: 0, warnings: 14`). Demonstrated that the service is robust to upstream LLM unavailability.

---

## 8. Write this conversation summary
**User asked:**
> can you create a summary of our chat … this is for the documentation

**Outcome:** Drafted the chronological summary inline.

---

## 9. Save the summary as a Markdown file
**User asked:**
> create it as md file

**Outcome:** This document — `docs/conversation-log.md`.

---

## Files touched this session

```
docs/                                  (committed 4ec42a3 — 9 docs)
docs/conversation-log.md               (this file)
src/main.ts                            (rewritten — pino + ValidationPipe)
src/app.module.ts                      (rewritten — ConfigModule + LoggerModule + HandoverModule)
src/health.controller.ts               (new)
src/app.controller.ts                  (deleted — boilerplate)
src/app.service.ts                     (deleted — boilerplate)
src/app.controller.spec.ts             (deleted — boilerplate)
src/common/types.ts                    (new)
src/common/time.ts                     (new)
src/llm/llm.client.ts                  (new — abstract base)
src/llm/deepseek.client.ts             (new, then refactored to extend LlmClient)
src/llm/gemini.client.ts               (new)
src/llm/llm.module.ts                  (new, then refactored to a factory)
src/llm/prompts/extract-nightlog.ts    (new, then prompt-tuned for date inference)
src/llm/prompts/summarize-thread.ts    (new)
src/handover/handover.module.ts        (new)
src/handover/handover.service.ts       (new — orchestrator)
src/handover/handover.controller.ts    (new)
src/handover/handover.view.ts          (new — HTML renderer)
src/handover/dto/input.dto.ts          (new — zod schema)
src/handover/pipeline/ingest.ts        (new)
src/handover/pipeline/injection.ts     (new)
src/handover/pipeline/extract.ts       (new, then iterated)
src/handover/pipeline/normalize.ts     (new)
src/handover/pipeline/thread.ts        (new, then iterated for status + merge)
src/handover/pipeline/classify.ts      (new)
src/handover/pipeline/render.ts        (new)
src/handover/pipeline/validate.ts      (new, then rewritten for proper-noun-only grounding)
.env.example                           (added LLM_PROVIDER and GEMINI_* block)
```
