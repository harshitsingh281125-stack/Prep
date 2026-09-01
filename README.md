# Prep — an AI-native learning OS for technical interview prep

Structured roadmaps, persistent per-topic notes, spaced-repetition recall on a
scheduler written by hand, and a progress dashboard that will tell you you're
behind.

Built as a portfolio project with one constraint applied throughout: **every
subsystem has to be explainable cold, without notes** ([Rules.md](./Rules.md)
#26). This README is the "why" tour — what each piece does, and the decision
behind it. The full engineering rules are in [Rules.md](./Rules.md); the settled
decisions and the bug log are in [memory.md](./memory.md).

---

## The problem it solves

Prepping with an AI chat window means re-pasting your context every session,
tracking nothing, and getting no honest signal about whether you're on pace. Prep
turns that into a system: the plan persists, the review queue schedules itself,
and the dashboard is allowed to say "you're behind".

The AI is **one component behind a gateway**, not the product.

---

## Stack

| Layer | Choice | Why not the obvious alternative |
|-------|--------|-------------------------------|
| App + server | **Next.js 15** (App Router), TypeScript | Plain React/Vite has no trusted server layer, and the provider key, the per-user caps and schema validation all have to live somewhere the client can't bypass. |
| DB / auth | **Supabase** (Postgres + Auth + RLS) | Wanted to write real SQL — schema, indexes and RLS by hand — without running auth and connection infra. **No ORM**, on purpose: DB fluency is a goal, and an ORM hides the schema. |
| AI | Provider-agnostic **gateway** (`lib/ai/gateway.ts`) → Google Gemini | No LangChain/LangGraph. A tiered `complete()` + `embed()` + one pgvector query is ~fully owned; a framework would re-introduce exactly the vendor-SDK spread the gateway exists to prevent, and there is no agent loop for it to run. |
| Charts | Hand-rolled SVG | A charting library for two charts is a dependency you can't explain in an interview. |
| Hosting | Vercel | Same deploy as the server routes. |

Node is pinned at **18.19.1**, so Next stays on **15** (16 needs Node ≥20).

---

## The subsystems, and the decision behind each

### 1. Roadmaps as data — the plan is a contract

Onboarding is five questions. The answers produce a tree: roadmap → weeks →
topics → notes, all plain SQL migrations with RLS on every table.

**The decision worth defending:** the generator returns *content, not contract*.
The roadmap schema contains **no week count, no hours, no week numbers** — those
are computed from the user's own answers and stamped on server-side. Validating
them would only catch a mismatch; not asking makes one impossible, and it is what
lets the seeded template be a true drop-in when generation fails.

### 2. Spaced repetition — written by hand, and deliberately not SM-2

The design advertises a **+1 / +4 / +14 / +30** day cadence, so that ladder is the
backbone; an **SM-2 ease factor** then stretches or compresses each rung, and past
the top rung it becomes `prevInterval × ease`. A miss hard-resets to +1 day, but
the ease penalty **persists**.

**Why not textbook SM-2:** its intervals contradict the cadence the UI promises,
and Prep's self-grade is *binary* (Got it / Missed), which collapses SM-2's 0–5
quality formula anyway. Adopting SM-2 wholesale would have meant either lying in
the UI or feeding a five-point formula a two-point input.

"Close enough" is a **miss** (Rule 17). That is a product rule, not a technical
one, and it is why grading was never handed to a model — a model is structurally
inclined to be generous, which would quietly dismantle the only thing the recall
loop is for.

"Reviews due today" is served by a composite `(user_id, due_at)` index: equality
column first, range/sort column second, so it's an index range scan that emits
rows already ordered — no sort node.

### 3. Progress — derived on read, never stored

Every number on the dashboard is computed at render time from `study_sessions`
and the append-only `recall_reviews` log by pure functions with `now` injected
(`lib/progress/compute.ts`).

**The decision worth defending:** `roadmaps.status` and `roadmaps.hours_logged`
exist in the schema and are **never read or written**. A stored status is a lie
the moment time passes without a write — a roadmap would only decay into
"stalled" when you *touched* it, which is exactly backwards. Deriving on read
cannot go stale.

Two more judgement calls that make the numbers honest:

- **Pace is measured in whole elapsed weeks**, capped at the plan's length. A
  fresh roadmap expects 0 hours and therefore *cannot* be behind on day one.
- **A session fills a week's bar via its topic**, not by calendar position — so
  "Week 3 hasn't started" is literally true rather than merely suggestive.

### 4. The AI gateway — tiers, not model names

Product code calls `complete({ tier: 'reasoning' | 'classification', … })`.
`lib/ai/config.ts` is **the only file in the repo that names a model**.

It returns a **discriminated union rather than throwing**, which forces every
call site to state its fallback. Around that: JSON-schema validation, one
retry-on-malformed, `ai_usage` metering, and a per-user daily cap checked
*before* dispatch. The provider, meter and counter are dependency-injected, so
the cap and retry logic are unit-testable with no network and no DB.

**The counterintuitive bit (and the best cost story here):** the *pricier* tier
sits on the **rare** call (roadmap generation, ~3 per user ever) and the *cheap*
tier on the **frequent** one (recall cards). Cost follows call volume, not
perceived importance.

**Rule 9 governs the whole thing:** every generation is schema-validated, retried
once, then falls back to a seeded template. **AI never hard-blocks a flow** — the
app stays fully usable with the key removed.

### 5. RAG — grounding resources on a curated corpus

The one genuine retrieval problem in Prep: topic resources were hallucinated
links. Fixed by embedding the topic query, cosine-searching a hand-curated
**202-document corpus across 26 areas** (`pgvector`, HNSW, a `match_resources()`
SQL function), and generating grounded on what came back.

**The decision worth defending:** *the model is never asked for a URL.* It cites
documents by 1-based index and the validator resolves that index to our own row —
so a hallucinated link is **unrepresentable**, not merely rejected.

Two measurements that turned out to matter:

- **The similarity floor is 0.64, measured rather than guessed.** At the
  intuitive 0.55, an off-domain topic ("Postgres query planner" → 0.568) would
  have been grounded on frontend docs and badged VERIFIED. Gemini embeddings
  aren't zero-centred.
- **The embedding column is `vector(1536)`**, not the model's native 3072,
  because **pgvector cannot index a vector wider than 2000 dims**.

Every URL in the corpus was fetched and confirmed 200 before it was written into
a migration.

### 6. Print / export

`/roadmap/[id]/print` renders the plan for paper: light-only, hex tokens, 0.7in
margins, `break-inside: avoid` on week cards. It reuses the *same* progress
functions as the dashboard, so a print-out and the screen can never disagree —
and the print-out is the copy that gets carried into a room.

**Why the browser's print pipeline and not a generated PDF file:** it already
does pagination, page size, margins and "Save as PDF" on every platform. A
server-side PDF means headless Chromium (which doesn't fit a Vercel serverless
function) or a PDF library that makes you re-implement layout by hand.

---

## Security model, in four lines

- **RLS on every table**, `user_id = auth.uid()`. One deliberate exception: the
  global `resources` corpus reads `using (true)` — it is the only table without a
  **`user_id` predicate**, *not* a table without RLS. On Supabase every `public`
  table grants writes to `anon` by default and **RLS is what narrows them**, so
  shipping it with RLS off would have made the vetted corpus world-writable.
- **No unauthenticated AI route**; the provider key is server-only and never
  reaches the browser.
- **Hard per-user daily AI cap**, counted from `ai_usage` before dispatch.
  `ai_usage` is the one table users may read but not write (SELECT-only RLS,
  service-role inserts) — a `for all` policy would have let any browser `DELETE`
  its way to an uncapped endpoint.
- **Quota (3 roadmaps) is enforced server-side**, not hidden in the UI.

---

## Honesty as a feature

Several things in here exist specifically to stop the product flattering its
user, or flattering itself:

- The dashboard says **"BEHIND PACE"** and projects how many days late you'll
  finish. Streaks are shown de-emphasised ("13d streak · not that it matters").
- Mastery is **earned** — a topic counts only when its kill criterion is
  explicitly checked. No auto-mastery from time spent.
- Resources carry their provenance: green **VERIFIED** for a corpus link, amber
  **UNVERIFIED** for a model-recalled one (which gets a *search* link we
  construct, never an invented URL).
- `/usage` reports **what was actually charged** next to a projection at
  paid-tier rates, computed from real token counts and never stored.
- A roadmap built from the seeded fallback when your role needs another track is
  permanently labelled **TEMPLATE MISMATCH**. Rule 9 says AI must never
  hard-block — that isn't the same as never telling you.

---

## Testing

Three layers, split by what actually needs a browser and a DB:

| Layer | Runner | Covers |
|-------|--------|--------|
| Unit | Vitest | Scheduler, progress maths, AI validation/cost/gateway, RAG grounding, print bucketing |
| E2E | Playwright | RLS/cross-user, auth gating, server-enforced quota, the stateful flows, both RAG branches |
| Manual | A written matrix per phase | Feel/timing/theme/visual, multi-day scheduling, the real provider, and whether retrieval retrieves the *right* documents |

The E2E suite runs against a **mock AI provider on its own port** and refuses to
run against a real one — an earlier version reused a developer's dev server and
silently spent 26 real Gemini calls while reporting green. See
[tests/README.md](./tests/README.md), which also lists every harness gotcha that
has produced a failure looking like an app bug and wasn't.

```bash
npm run test:unit     # Vitest
npm run test:e2e      # Playwright (starts its own servers)
npm run build         # typecheck + lint + build; must pass clean
```

---

## Running it locally

1. `npm install`
2. Copy `.env.example` → `.env.local` and fill in your Supabase URL + anon key,
   the service-role key, and an AI provider key.
3. Apply `supabase/migrations/*.sql` **in order** via the Supabase SQL Editor.
4. `npm run embed:corpus` to compute the RAG corpus vectors.
5. `npm run dev` → http://localhost:3001

`AI_PROVIDER=mock` gives a deterministic offline provider, with
`AI_MOCK_MODE=ok|malformed|malformed-once|error` for exercising the fallback
paths. **Next reads env only at startup — restart the dev server after any
change.**

---

## Docs map

[PRD.md](./PRD.md) · [Architecture.md](./Architecture.md) ·
[design.md](./design.md) · [phases.md](./phases.md) · [Rules.md](./Rules.md) ·
[memory.md](./memory.md) · [interview.md](./interview.md) ·
[nextjs-tutorial.md](./nextjs-tutorial.md) · [tests/](./tests/)
