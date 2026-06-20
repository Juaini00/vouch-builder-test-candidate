# 10 — Ideal Architecture (Given More Time)

This document is honest about a tradeoff baked into the current build, and lays out what the system **should** look like if a proper engineering window were available rather than a two-hour slice.

## The honest tradeoff

The shipped service leans on the LLM at two stages: extracting structured events from free-text night logs, and writing manager-facing prose per thread. That is more LLM than is ideal for a system that runs unattended across hundreds of hotels.

It is what fit in two hours.

Doing it "properly" — a knowledge-driven, embedding-aware, policy-guarded pipeline with the LLM kept on a short leash — needs days, not hours: a capability catalog, an embedding index, a planner with approved templates, a policy guard layer, per-hotel calibration, an audit pipeline, and the operational glue around all of it.

What this document records is the architecture we'd build given that time, so the difference between the current shape and the target shape is explicit.

---

## What we have now (v1, the 2-hour build)

```
INGEST → EXTRACT (LLM) → NORMALIZE → THREAD → CLASSIFY → RENDER (LLM) → VALIDATE
              ↑                                                  ↑
              └──── LLM does the structural work ────────────────┘
```

- **EXTRACT** asks the LLM to translate prose → structured events. The model is the parser.
- **THREAD** uses a static keyword taxonomy. Works on the sample; brittle on unfamiliar wording.
- **CLASSIFY** is a small hand-coded rule set.
- **RENDER** asks the LLM to write the body, then a post-validator rejects ungrounded statements.

It works, it's grounded, it's auditable. It is **not** how this scales to hundreds of tenants and years of operational text.

---

## What we'd build given the time (v2)

The principle shifts from *"the LLM is a translator"* to **"the LLM is one component inside a knowledge-driven planner."** The system owns the knowledge; the LLM picks paths through it.

In standard terminology this is a **domain-constrained RAG (Retrieval-Augmented Generation)** system — with the twist that the *generation* step is itself constrained: the LLM proposes a plan over an approved capability set, and the final string comes from a template, not from free generation. Pure RAG (retrieve docs → LLM writes prose) would still leave the same hallucination surface we're trying to eliminate.

```
                    ┌─────────────────────────────────────────────┐
                    │           KNOWLEDGE LAYER                   │
                    │  capability catalog · event taxonomy        │
                    │  escalation rules · per-hotel SOPs          │
                    │  prior handovers (vector-indexed)           │
                    └────────────────┬────────────────────────────┘
                                     │
   raw input                         │
      │                              ▼
      ▼              ┌──────────────────────────────────┐
   INGEST  ──────►   RETRIEVAL (embedding similarity)    │
      │              └────────────────┬─────────────────┘
      │                               │ top-K matched capabilities,
      │                               │ topics, prior threads
      ▼                               ▼
   NORMALIZE  ──►    INTENT CLASSIFIER (embedding model)
                              │
                              ▼
                     CROSS-NIGHT RECONCILER
                              │ deterministic thread join over
                              │ persisted history (DB)
                              ▼
                     PLANNER  (LLM, narrow role)
                              │  picks: template + slots + policy class
                              ▼
                     POLICY GUARD
                              │  validates plan against:
                              │   - hotel-specific SOPs
                              │   - compliance windows
                              │   - escalation rules
                              ▼
                     COMPOSER (templates, NOT free LLM prose)
                              │
                              ▼
                     GROUNDING VALIDATOR  ◄── audit log + metrics
                              │
                              ▼
                          HANDOVER
```

### Key components and why

#### 1. Knowledge layer

A first-class artifact in the repo: the **capability catalog** (every operational concept the service understands — compliance scanner, deposit lifecycle, no-show, damage, medical, etc.), the **event taxonomy** (canonical event types and how they map to capabilities), and **per-hotel SOPs** (which compliance windows apply, who escalates what, when an issue is "on fire").

Versioned. Reviewable. Diffable. Not vibes baked into prompts.

#### 2. Embedding-based retrieval

Replace the hand-tuned topic regex with semantic similarity:

- Embed each canonical capability description once at build time.
- Embed each incoming event (structured or extracted) at request time.
- Cosine-similarity match → top-K candidate capabilities.

This handles wording the regex doesn't ("compressor down" → aircon; "客人晕倒了" → medical) without us writing rules for every phrasing.

#### 3. Persistent reconciler

A real database (Postgres or similar) of all events per hotel. The service no longer receives the entire week's history per request — it receives **today's** events and reconciles them against the persisted thread state.

This is what unlocks honest cross-night reasoning at production volumes. Open issues live as first-class rows with state transitions, not as records pulled from a request body.

#### 4. Planner (LLM, narrow)

The LLM does **one** job: given (a) the event, (b) the candidate capability matches from retrieval, (c) the relevant prior thread state, decide which template and which slot values to use.

Output is a structured plan, not prose:

```jsonc
{
  "capability": "compliance.passport_scan",
  "template_id": "scan_backlog_v3",
  "slots": { "rooms": ["204","207","210","211"], "deadline_hrs": 48 },
  "policy_class": "regulatory_deadline",
  "confidence": 0.93
}
```

If confidence is low or no template fits → route to a human-review queue. The LLM never writes the final string.

#### 5. Policy guard

A deterministic check on the plan before composition:

- Does this policy class require manager approval? Has it been granted?
- Does the deadline math actually warrant `on_fire`?
- Is the suggested action consistent with the hotel's SOP?

Same role grounding validation plays today, but at the level of *decisions* not *sentences*.

#### 6. Composer (templates)

The actual manager-facing string comes from an audited template library:

```text
templates/compliance/scan_backlog_v3.tmpl
  Immigration scanner backlog: {{rooms.length}} passport{{plural}} overdue.
  Rooms {{rooms|join}}.
  Reporting deadline: {{deadline_hrs}}h from check-in.
```

Templates are versioned, tested, and reviewable. Output prose is bounded by what the templates can say.

#### 7. Audit + feedback loop

Every plan, every slot, every retrieval score, every template chosen is logged with the `handoverId`. Manager edits to the rendered handover become labeled training data for:

- the intent classifier (when retrieval picked the wrong capability)
- new templates (when no template fit and a human had to write prose)
- policy rules (when the manager downgraded an `on_fire` to `fyi`)

The system gets better with use, instead of drifting with prompt changes.

---

## RAG specifics — what a good retrieval layer needs

Calling something "RAG" is easy; building one that doesn't degrade in production is the actual work. The pieces that need to be deliberately designed:

### Knowledge base, chunked deliberately

Three corpora, each chunked to its own grain:

- **Capability catalog** — one chunk per capability (compliance.passport_scan, deposit.lifecycle, safety.medical, …). Small, dense, hand-written.
- **Per-hotel SOPs** — chunked by procedure, with hotel id in metadata. A scan over "Lumen-SG SOPs only" is one metadata filter.
- **Prior handovers** — chunked by `IncidentThread`, not by paragraph. This is the corpus that lets the system recognise "this looks like the deposit-disputed pattern we saw last month."

Bad chunking is the #1 cause of bad RAG — chunk too small and you lose context; too big and you dilute relevance. The unit of meaning differs per corpus.

### Embedding model

Start with a strong general-purpose model (e.g. `text-embedding-3-small` or a local equivalent). Fine-tune later if the recall@k stays poor after retrieval is otherwise sound — fine-tuning is expensive and easy to do prematurely.

Crucially: **the same embedding model** is used at index time and query time. A model swap means re-indexing everything.

### Hybrid search, not pure vector

Pure cosine similarity quietly misses exact-match cases ("room 309", "SGD 100"). Production RAG always combines:

- **BM25 / lexical** — for rare strings (room numbers, currency amounts, IDs).
- **Vector / semantic** — for paraphrase ("aircon down" ↔ "compressor failed" ↔ "空调坏了").
- **Reciprocal Rank Fusion** to merge the two ranked lists.

This catches both "what room?" and "what kind of issue?" in one query.

### Re-ranking pass

After retrieval returns top-K (say K=20), run a cross-encoder re-ranker on those K and keep top-N (say N=5) for the planner. Cross-encoders are slower per-pair but vastly more accurate than cosine alone. The K→N funnel is where retrieval quality is actually earned.

### Query rewriting

User events rarely arrive in retrieval-friendly form. Two cheap rewrites pay back many-fold:

- **Decontextualisation** — "still not settled" → "room 309 deposit dispute, unresolved since Tuesday". Resolve pronouns and anaphora before retrieval.
- **HyDE (Hypothetical Document Embeddings)** — generate a hypothetical "ideal answer" and embed *that* rather than the raw query. Sounds odd, works very well on operational queries that are short and ambiguous.

### Vector store

Start with **`pgvector`** on Postgres — same DB the persistent reconciler already needs. Migrate to a dedicated store (Qdrant, Weaviate, LanceDB) only when one of these is true:

- Index size > 5M vectors per hotel.
- Latency SLO < 50 ms for top-K.
- Need filter-then-search at high QPS.

Premature DB sprawl is the second-biggest source of operational pain in RAG systems.

### Index lifecycle

The knowledge base is not "set once and forget":

- **Capability catalog** — change-controlled, versioned in git, rebuilt on change.
- **SOPs** — per-hotel, change-triggered re-index.
- **Prior handovers** — rolling window (last 90 days?), nightly incremental index, weekly full rebuild for compaction.

Without an explicit lifecycle, the index goes stale and the system silently gets worse.

### Evaluation harness — non-negotiable

A RAG system without measured quality drifts immediately. Two evaluation layers:

- **Retrieval quality** (component-level) — golden set of (query → relevant capability ids). Track **recall@k** and **MRR**. A drop here causes everything downstream to degrade.
- **End-to-end quality** (system-level) — golden set of (hotel-night → expected handover sections). Track per-section precision/recall: did we surface the right items as `on_fire`? Did the contradictions land in `flags`?

Both run in CI. A PR that drops retrieval recall@k by >5% gets blocked.

### Cost / latency budget per request

The component-level numbers we'd hold ourselves to:

- Embedding (query): ~50 ms
- Hybrid search over up to ~1 M vectors: ~80 ms
- Re-rank top-20 → top-5: ~150 ms
- Planner LLM call: ~1.5 s
- Compose + validate + persist: ~50 ms

**Total p50 ≈ 2 s** per event-processed, **~3–5 s** per handover (events processed in parallel). That's an order of magnitude better than the current ~14 LLM calls / handover.

---

## Why this matters

**Predictability.** The same input produces the same output. Today's pipeline can produce different prose run-to-run because the LLM is the author. Tomorrow's pipeline produces the same template-rendered string deterministically.

**Auditability.** A bad handover today means tracing through warnings and re-asking the LLM. A bad handover tomorrow means looking at: which capability did retrieval pick? which template did the planner choose? which policy class fired? Every step is a row, not a vibe.

**Cost and latency.** ~14 LLM calls per handover today. With retrieval + planner, that drops to 1–2 calls — and most of the work is local vector math and template instantiation.

**Multi-tenant safety.** Per-hotel SOPs and per-hotel template overrides become first-class. Today, every hotel runs the same prompts.

**Improvability without prompt-thrash.** Today you improve the output by editing prompts and hoping. Tomorrow you improve it by adding a template, tightening a policy rule, or labeling a misroute.

---

## Migration path from v1 to v2 (rough)

| Order | Work | Time |
|---|---|---|
| 1 | Add Postgres + `pgvector`; persist events/threads | half-day |
| 2 | Define the capability catalog as code (start with the 16 topics we already have as regex), commit as the first chunked corpus | half-day |
| 3 | Stand up the embedding pipeline — pick model, index capability catalog, write the eval harness with a small golden set | 1 day |
| 4 | Replace topic-regex with **hybrid retrieval** (BM25 + vector + RRF) over the catalog; keep regex as a fallback for explainability | 1 day |
| 5 | Add a re-ranker pass (cross-encoder) — measure recall@k uplift before committing | half-day |
| 6 | Introduce template library; cover the 10 most-common handover items | 1–2 days |
| 7 | Rewrite RENDER as planner → policy → composer; planner consumes retrieved top-N as context | 2 days |
| 8 | Query rewriting (decontextualisation + HyDE) ahead of retrieval | half-day |
| 9 | Index lifecycle — per-hotel SOP corpus, rolling prior-handover corpus, scheduled re-indexes | 1 day |
| 10 | Audit log every retrieval score + plan; add a manager-edit capture endpoint for feedback | 1 day |
| 11 | First feedback-driven re-tune of retrieval / re-ranker / templates | ongoing |

Conservative estimate: **~1.5 focused weeks** to get to a defensible v2 worth running across more than one hotel. The eval harness (step 3) is the non-skippable one — without it, every later step is uninformed.

---

## What we're explicitly choosing today

We chose to ship something honest in 2 hours — grounded, auditable, with prompt-injection defenses and a real grounding validator — rather than start the v2 build, hit the time wall, and submit a half-built scaffold with no working pipeline.

The current build is a working spike that proves the **product** is feasible. This document is the **engineering plan** for what comes next.
