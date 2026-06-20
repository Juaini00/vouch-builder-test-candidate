# 08 — Decisions

Running log of choices made during the 2-hour build. Each entry: **what**, **why**, **what we skipped**.

> This file evolves as we build. The final `DECISIONS.md` at repo root (per brief) will be derived from this.

---

## D1 — Framework: NestJS

**What:** Use NestJS over bare Express / Fastify.
**Why:** DI makes the LLM client swappable for tests; DTO validation pipes give boundary safety; familiar shape for reviewers.
**Skipped:** No microservices, no GraphQL, no WebSockets.

## D2 — LLM: DeepSeek `deepseek-chat`

**What:** Use DeepSeek as the only model in v1.
**Why:** Provided in the env, cheap, supports JSON-mode, low-latency.
**Skipped:** No Gemini fallback (key present but unused), no model A/B, no fine-tuning.

## D3 — Pipeline shape over agent shape

**What:** Linear pipeline (ingest → extract → normalize → thread → classify → render → validate). LLM calls are contained to 2 stages.
**Why:** Agents are harder to debug, harder to ground. A pipeline gives us per-stage logs and lets us unit-test each transform deterministically.
**Skipped:** No LangChain / no agentic loops.

## D4 — Grounding as a post-validation step, not a prompt instruction

**What:** Trust no LLM output until a deterministic validator checks it against source evidence.
**Why:** Prompt-level "don't hallucinate" is necessary but not sufficient. The brief explicitly cares about grounding above tool choice; we treat it as an engineering invariant, not a polite request.
**Skipped:** No reflection loop ("ask the model to critique its own output") — costs tokens, less reliable than code-level checks.

## D5 — Threading: deterministic rules first, LLM only as tiebreaker

**What:** Match events into incident threads using a static keyword + room + guest taxonomy. LLM is consulted only when rules are ambiguous, and its grouping must include a quoted justification.
**Why:** Threading is mostly a database problem. The sample data shows most threads are unambiguous (room number + topic noun is enough). Using an LLM for everything would add latency, cost, and a layer that's hard to test.
**Skipped:** No embedding-based semantic clustering in v1.

## D6 — Injection defense baked into ingest, not the prompt

**What:** Pre-LLM regex sweep for injection patterns (`ignore`, `system`, `instruction`, `goodwill credit`, etc.). Suspicious events are quarantined to `flags` and never sent to the prose-render LLM.
**Why:** Defense in depth. The model might be tricked; the regex won't.
**Skipped:** No classifier-based detection.

## D7 — Per-shift anchoring on `shiftDate`

**What:** Every event gets a `shiftDate` = the morning the shift it falls in will end on. All threading and classification keys off this, not the calendar date.
**Why:** A night spans two dates. Anchoring on the morning gives one unambiguous bucket per event and makes the "newly resolved" / "still open" logic trivial.
**Skipped:** No support for shifts other than 23:00–07:00 in v1 (would just need to make the boundary config).

## D8 — Output: JSON + minimal HTML, no Slack/email

**What:** Two output formats — JSON (primary) and a server-rendered HTML page (`/handover/sample?format=html`).
**Why:** The brief allows any of these. JSON proves the data is clean; HTML proves it's readable by a manager. Slack/email would add OAuth + delivery infra without showing more capability.
**Skipped:** No Slack bot, no email send.

## D9 — No persistence

**What:** Each request is stateless. The "history across nights" comes from the events the caller provides in the request body, not from a database.
**Why:** 2-hour scope. Adding a DB would mean migrations, seeding, and a deployment story for the DB too.
**Skipped:** No Postgres, no Redis. Means the caller must provide the full event window each request.

## D10 — Deploy target: TBD

Will pick the fastest-deploying option (Railway / Fly / Render) once code is buildable. Health check + single `Dockerfile`. Update this entry when chosen.

---

## Hour 3–6 plan (if we had it)

1. **Persistence** — store events per hotel in Postgres; the API takes only a hotel id + target morning, and pulls the rolling window itself.
2. **Embedding-based threading** — replace the keyword taxonomy with embedding similarity for ambiguous cases; keeps the rules layer but extends recall.
3. **Per-hotel calibration** — let each hotel tune its on-fire thresholds (e.g. one hotel's "noise complaint" is FYI; another's is on-fire if it's a repeat).
4. **Confidence scores in output** — surface "how sure are we" per item for the manager.
5. **A second LLM as judge** — use a different model family to spot-check grounding on a random sample of items, catch model-specific failure modes.
6. **Real metrics + alerting** — Prometheus + an alert when `grounding.fallback-used` rate spikes for a hotel.
7. **Test data generator** — synthetic multilingual night-logs to stress-test extraction quality across languages we haven't seen.

## One surprise (so far)

The sample data contains a real, well-crafted prompt-injection inside the structured events (`evt_0026`). That made it concrete that "grounding" isn't a theoretical concern — the very first dataset already has someone trying to game the system. It shifted my design from "make the LLM behave" to "assume the LLM will be tricked; the validator is the wall."
