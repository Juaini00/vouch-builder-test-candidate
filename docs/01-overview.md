# 01 — Overview

## The problem

Vouch operates overnight front desks for small hotels. When the night shift ends at 07:00, the **morning manager** needs to know — within ~60 seconds of reading — what they must act on. Today this handover is written manually and quality varies. We want it generated automatically, reliably, across many hotels.

## Who reads the output

A non-technical hotel manager arriving at 07:00 with coffee. They want:

1. **On fire** — must-act-now items (compliance deadlines, guest about to checkout with unresolved billing, safety).
2. **Pending** — needs a decision today but not minute-zero.
3. **FYI** — context worth knowing, no action.
4. **Flags** — anything the system *couldn't reconcile* (contradictions, incomplete entries, suspicious inputs).

## Inputs

Per hotel, per night, the service receives:

- **Structured events** (JSON) — most nights.
- **Free-text night log** (Markdown / plain text) — when the front-desk system was down or relief staff covered. May be in **any language**.

Both formats can coexist for the same night, and both contribute to a rolling history that **spans nights** (an issue opened Monday may resolve Friday).

## Outputs

- **JSON** — machine-readable handover (primary).
- **HTML** — same content, render-friendly for a manager in a browser.

Both contain the **same evidence trail** — every statement cites the source event(s) it came from.

## Success criteria

1. **Grounding** — no statement in the output is unsupported by the input. This is the bar the brief calls out as most important.
2. **Threading** — the same incident across nights is tracked as one thread; the handover distinguishes *still open / newly resolved / new tonight*.
3. **Action-first ordering** — a manager can stop reading after section 1 and not miss a fire.
4. **Robustness to messy input** — multilingual prose, missing fields, contradictions, and adversarial guest-supplied text are handled without breaking or hallucinating.
5. **Generalizes** — service works for hotels and nights it has never seen. No hotel-specific logic.

## Explicit non-goals (v1)

- Auth, multi-user, RBAC.
- Persistence across requests (state is derived from input each call).
- Pretty UI / branding.
- Performance optimization for >1 hotel-night per request.
- Streaming responses.
