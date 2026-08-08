# Architecture — Prep

> **Stack:** Next.js (App Router) · Supabase (Postgres + Auth + RLS) ·
> provider-agnostic AI Gateway (model choice open for v1) · Vercel hosting.
> Companion: [PRD.md](./PRD.md) · [phases.md](./phases.md) · [Rules.md](./Rules.md).

---

## 1. High-level shape

```
┌────────────────────────────────────────────────────────────┐
│  Browser (Next.js client components)                        │
│  ── design system from Prep.dc.html: IBM Plex, OKLCH tokens │
│  ── screens: Auth · Library · Onboarding · Roadmap ·        │
│               Topic · Recall · Progress · Print             │
└───────────────┬────────────────────────────────────────────┘
                │  (supabase-js: auth + direct row reads under RLS)
                │  (fetch: /api/* for anything privileged or AI)
                ▼
┌────────────────────────────────────────────────────────────┐
│  Next.js server (Route Handlers / Server Actions)           │
│  ── auth guard (verify Supabase session)                    │
│  ── quota + rate-limit enforcement                          │
│  ── AI Gateway (provider-agnostic)                          │
│  ── schema validation + retry-on-malformed                  │
│  ── recall scheduling writes (ladder + ease)                │
└───────┬───────────────────────────────────┬────────────────┘
        │ service-role (server only)         │
        ▼                                     ▼
┌───────────────────┐             ┌──────────────────────────┐
│ Supabase Postgres │             │ AI provider (v1: TBD)    │
│  + RLS policies   │             │  behind the Gateway iface │
└───────────────────┘             └──────────────────────────┘
```

**Rule of thumb for where logic runs** (refined by Phases 2–3 — it is *not*
owned-vs-not-owned):
- **Client + RLS** for plain reads/writes a user owns where the *value* carries no
  product rule (notes autosave, the mastery toggle).
- **Server route** whenever the value being written is **derived from a rule the
  product must guarantee** — AI calls, quota checks, usage metering, the recall
  scheduler's `due_at` (§4b), and study-session integrity (§4c). RLS answers
  "whose row is this?"; it cannot answer "is this the number the algorithm would
  have produced?" or "is this row internally coherent?"

## 2. Why this stack

- **Next.js (App Router):** gives a real server layer co-located with the UI.
  The AI provider key **never** reaches the browser; per-user caps and schema
  validation are enforced server-side. SSR + one-command Vercel deploy.
- **Supabase:** Postgres (write real SQL — DB is a stated skill gap, don't let an
  ORM hide it), Auth (email + Google OAuth), and RLS so most reads are safe direct
  from the client. Generous free tier.
- **AI Gateway abstraction:** the model/provider is an *open v1 decision*. Product
  code calls `generateRoadmap()`, never a vendor SDK, so the pick can change (or
  A/B) without a rewrite.

## 3. Routes / surface map

### Pages (App Router)
| Route | Screen | Rendering |
|-------|--------|-----------|
| `/login` | Auth | client (Supabase Auth) |
| `/` → `/library` | Library | server component shell + client grid |
| `/onboarding` | Onboarding | client (stateful wizard) |
| `/roadmap/[id]` | Roadmap | server-fetch + client accordions |
| `/roadmap/[id]/topic/[topicId]` | Topic/Study | server-fetch + client notes |
| `/recall` | Recall | client (grading interactions) |
| `/progress` | Progress | server-fetch aggregates + client charts |
| `/roadmap/[id]/print` | Print export | print-optimized (see `Prep-print.dc.html`) |

### API route handlers (all auth-gated)
| Route | Method | Purpose | AI? |
|-------|--------|---------|-----|
| `/api/roadmaps/generate` | POST | onboarding answers → schema-valid roadmap → persist | ✅ reasoning tier |
| `/api/topics/[id]/detail` | POST | generate mental model + exercises; **RAG-ground** ranked resources on the curated corpus (Phase 4.5) | ✅ reasoning tier + `embed()` |
| `/api/recall/[cardId]/grade` | POST | run the scheduler, write next due date + review log | ⚪ optional cheap-tier assist |
| `/api/recall/generate` | POST | derive recall cards for a topic | ✅ classification tier |
| `/api/sessions` | POST | log study hours (validates minutes + roadmap/topic ownership) | ❌ |
| `/api/usage` | GET | current user's AI usage vs cap | ❌ |

Reads that don't need privilege (list my roadmaps, my due cards, my notes) go
**directly through supabase-js under RLS** — no API route needed.

## 4. Data model (Postgres)

All tables carry `user_id uuid references auth.users` and are protected by RLS
(`user_id = auth.uid()`). Timestamps `created_at`/`updated_at default now()`.

```sql
-- one row per user, extends auth.users
profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  track text,                     -- e.g. 'SDE-2 · Frontend'
  theme text default 'dark',
  max_roadmaps int default 3      -- quota
)

roadmaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  subtitle text,
  answers jsonb not null,         -- raw onboarding answers (audit + regen)
  weeks_count int not null,
  hours_planned int not null,
  hours_logged int default 0,     -- VESTIGIAL since Phase 3 — never written, never read
  status text default 'fresh',    -- VESTIGIAL since Phase 3 — see §4c, status is derived on read
  target_date date,
  created_at timestamptz default now()  -- Phase 3 measures pace from this
)
-- NOTE (Phase 3): hours_logged and status are dead columns. Hours come from
-- summing study_sessions; status comes from deriveStatus() at render time. They
-- are left in place rather than dropped so the migration history stays additive,
-- but nothing reads them — see §4c for why a STORED status is unsafe.

weeks (
  id uuid primary key default gen_random_uuid(),
  roadmap_id uuid not null references roadmaps on delete cascade,
  user_id uuid not null,
  n int not null,                 -- week number
  title text not null,
  hours int not null,
  kill_criterion text not null
)

topics (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks on delete cascade,
  roadmap_id uuid not null,
  user_id uuid not null,
  name text not null,
  status text default 'not_started', -- not_started|in_progress|mastered
  detail jsonb,                   -- AI-generated: {model, resources[], exercises[]}
  mastered_at timestamptz
)

notes (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references topics on delete cascade,
  user_id uuid not null,
  body text default '',
  updated_at timestamptz default now()
)

recall_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  topic_id uuid references topics on delete set null,  -- set null: keep history if the topic goes
  roadmap_id uuid references roadmaps on delete cascade,
  topic_label text not null,      -- denormalised topic name (survives topic deletion)
  question text not null,
  -- scheduler state (fixed ladder + ease modifier — lib/recall/scheduler.ts):
  ease numeric default 2.5,       -- clamped 1.3 .. 2.8
  interval_days int default 0,    -- 0 = never reviewed
  repetitions int default 0,      -- consecutive correct grades
  due_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  created_at timestamptz default now()
)

recall_reviews (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references recall_cards on delete cascade,
  user_id uuid not null,
  grade text not null,            -- 'right' | 'wrong'  (self-graded, check-constrained)
  -- the scheduler's decision at grade time (audit + Phase 3 accuracy trend):
  interval_after int not null,
  ease_after numeric not null,
  reviewed_at timestamptz default now()
)
-- append-only: a new grade INSERTS a row, never updates one, so accuracy history
-- survives even though the card's own state is overwritten each review.

-- Phase 3. Append-only log of hours actually spent; the Progress dashboard is
-- derived entirely from these rows (+ recall_reviews + topics).
study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  roadmap_id uuid not null references roadmaps on delete cascade,
  topic_id uuid references topics on delete set null,  -- set null: keep the hours if the topic goes
  minutes int not null check (minutes > 0 and minutes <= 1440),  -- stored as minutes, not hours
  note text,
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
)
-- minutes, not hours: "90 minutes" isn't an int hour, and float hours accumulate
-- rounding drift once summed. Integer minutes sum exactly; the UI divides by 60
-- at the last moment. The CHECK is the DB-level backstop under the route's own
-- validation — bounded at both layers deliberately.
create index study_sessions_roadmap_idx on study_sessions (roadmap_id, logged_at desc);
create index study_sessions_user_idx    on study_sessions (user_id, logged_at desc);

ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  route text not null,            -- which endpoint
  model text,                     -- which model actually served it
  input_tokens int, output_tokens int,
  cost_usd numeric,
  created_at timestamptz default now()
)
```

### The gradeable index/query — "reviews due today"
```sql
create index recall_due_idx on recall_cards (user_id, due_at);

-- served from the client under RLS, or from /api for aggregates:
select * from recall_cards
where user_id = auth.uid() and due_at <= now()
order by due_at asc;
```
This composite index is the answer to the interview question in the PRD. Be ready
to explain: why `(user_id, due_at)` order, why it beats a full scan, and how RLS
+ the index interact.

**Column order (the part that matters):** `user_id` leads because it's the
**equality** predicate — and the column RLS filters on — so Postgres seeks straight
to one user's contiguous block. `due_at` follows because it's both the **range**
filter and the sort key, so walking that block emits rows already in `due_at` order:
an index range scan with no sort node. Flipping to `(due_at, user_id)` would sort by
date across *all* users, making the work grow with total traffic instead of with the
caller's own queue. Rule of thumb: **equality columns first, the range column last**
so it can also serve the `ORDER BY`.

### 4b. The scheduler (Phase 2) — fixed ladder + ease modifier

Implemented by hand in `lib/recall/scheduler.ts` (Rule 14), as a **pure function with
`now` injected** — no clock reads, no DB — which is what makes the UTC/DST behaviour
unit-testable.

```
LADDER = [1, 4, 14, 30] days          ease ∈ [1.3, 2.8], starts 2.5

right → repetitions += 1
        rung < 4 : interval = round(LADDER[rung] × (ease / 2.5))
        rung ≥ 4 : interval = round(prevInterval × ease)   // past the ladder
        ease += 0.1
wrong → repetitions = 0, interval = 1                      // hard reset (Rule 17)
        ease -= 0.2                                        // penalty PERSISTS
due_at = now + interval days                               // epoch ms, UTC (Rule 15)
```

**It is a justified variant, not SM-2 — say so.** Textbook SM-2 derives intervals
purely from ease (1, 6, then ×ease → ~15, ~38) and grades on a 0–5 quality scale.
Prep advertises a `+1d/+4d/+14d/+30d` cadence in the UI, and self-grades **binary**
(Got it / Missed) by product design — which collapses SM-2's ease formula to two
cases anyway. So we keep the ladder the product promises as the backbone and keep
SM-2's per-card adaptivity as a modifier on top. Claiming "I implemented SM-2" when
the intervals aren't SM-2's is the kind of thing one follow-up question exposes.

**Why the write is a server route, not client+RLS.** Unlike notes/mastery (Phase 1,
written directly from the browser), grading goes through
`/api/recall/[cardId]/grade`. RLS answers *"may this user write this row?"*; it
cannot answer *"is this the number the algorithm would have produced?"* A client
computing its own `due_at` could post a 10-year interval and opt out of spaced
repetition entirely. The handler therefore reads **only** `grade` off the body and
rejects anything that isn't exactly `right`/`wrong`. Generalised rule-of-thumb
refinement to §1: it isn't owned-vs-not-owned, it's **whether the value being written
is derived from a rule the product must guarantee.**

### 4c. The progress aggregation (Phase 3) — derived, never stored

Implemented as pure functions in `lib/progress/compute.ts`, with `now` injected —
the same discipline as the scheduler, and the reason the week-boundary and
threshold behaviour is unit-testable at all (53 tests).

```
perWeek        = hours_planned / weeks_count
weeksElapsed   = min(floor((now - created_at) / 7d), weeks_count)   // whole weeks, capped
expectedByNow  = weeksElapsed × perWeek
logged         = sum(study_sessions.minutes) / 60                   // sum ints, convert last
observedPace   = logged / weeksElapsed                              // null before week 1

status:  done    ← every topic mastered (Rule 16)
         fresh   ← nothing logged AND nothing expected yet
         stalled ← started, then silent ≥ 14 days
         behind  ← logged < round1(expectedByNow × 0.8)
         ontrack ← otherwise
```

**Why whole elapsed weeks, not a continuous fraction.** The plan is authored in
week-sized blocks with week-sized kill criteria, so a person is "a week behind",
never "0.42 weeks behind". Flooring also means a brand-new roadmap expects **0**
hours and therefore *cannot* be behind on day one — prorating by the hour would
put a red BEHIND PACE banner in front of someone three hours after they made a
plan. The cap matters for the opposite end: past the final week the expectation
is the whole plan, so an abandoned roadmap is "19 hours short", not "500 short".

**Why status is computed on read and `roadmaps.status` is dead.** RLS-style
storage would need something to *write* the status, and nothing naturally does —
a roadmap decays into "stalled" through the passage of time, not through a user
action. A stored value would therefore only update when you touched the roadmap,
i.e. it would go stale exactly when it mattered and would need a cron to stay
honest. Deriving on read cannot go stale. The cost is that Library, Roadmap and
Progress must all call the same function — which they do, and DS-04 pins it.

**Week attribution is by topic, not by calendar.** A session fills a week's bar
via `topic_id → topics.week_id`, not by where `logged_at` falls. That makes the
chart answer *"what did you study"*, which is what lets a "Week 3 hasn't started"
blocker be literally true rather than merely suggestive — under calendar
attribution a week's bar could be full while that week's topics were untouched,
so the chart would contradict the blockers list directly beneath it. The accepted
cost: unattributed sessions (no topic, or a deleted one) count toward total hours
but fill no bar, so **the bars can legitimately sum to less than the headline.**

**Why the session write is a server route.** Same reasoning as grading (§4b): RLS
answers *"may this user write this row?"* but not *"is this a coherent row?"* A
direct client write could log minutes against a topic belonging to a **different
roadmap**, silently corrupting the per-week bars the whole screen derives from.
`/api/sessions` re-derives ownership of both the roadmap and the topic, validates
`minutes` as an integer in `[1, 1440]`, and lets the DB's CHECK constraint
backstop it. `logged_at` is always the server's `now()` — a client-supplied
timestamp is ignored, so nobody can backdate a history that makes them look
on-pace (SE-11).

### Daily quota (server-enforced)
```sql
create index ai_usage_user_day_idx on ai_usage (user_id, created_at);
-- count calls since midnight before allowing a new AI request.
```

## 5. AI Gateway (the abstraction the whole "model choice is open" plan rides on)

A single server-side module. Product code depends on **this interface only** —
never a vendor SDK.

```ts
// lib/ai/gateway.ts  (server-only)
type Tier = 'reasoning' | 'classification';

interface AIGateway {
  complete(opts: {
    tier: Tier;
    system: string;          // cacheable scaffolding
    input: string;
    schema?: JSONSchema;     // when set → validate + retry on malformed
    userId: string;          // for metering + caps
  }): Promise<{ data: unknown; usage: Usage }>;

  // Phase 4.5 (RAG): embeddings route through the same gateway so they're
  // provider-agnostic AND metered like completions (Rules 7, 8, 11).
  embed(opts: {
    input: string | string[];  // query text, or a batch of corpus docs
    userId: string;            // for metering + caps
  }): Promise<{ vectors: number[][]; usage: Usage }>;
}
```

- **Tiers, not model names**, in product code. A config map binds each tier to a
  concrete model. **v1 binding (settled 2026-07-28) — Google Gemini free tier:**
  ```ts
  // lib/ai/config.ts  (the ONLY file naming concrete models)
  const MODELS = {
    reasoning:      'gemini-flash',       // roadmap gen, topic detail (rare, high-value)
    classification: 'gemini-flash-lite',  // recall grading, recall-card gen (frequent)
    embedding:      'gemini-embedding',   // embed() for Phase 4.5 RAG
  };
  ```
  Chosen so a solo portfolio project runs at ~$0. **Cost-routing insight:** the
  pricier-per-token tier is on the *rare* call, the cheap tier on the *frequent* one
  — cost tracks volume, not importance. Swapping to Claude (or A/B-ing) = editing this
  one map; product code never changes.
- **Schema validation + retry:** if `schema` is set, validate the response; on
  failure, retry once with a "return valid JSON only" nudge; on repeated failure,
  the caller falls back to a **seeded template** (app never hard-blocks).
- **Prompt caching:** `system` scaffolding is marked cacheable where the provider
  supports it. On the v1 free tier the *dollar* saving is ~$0 (already free), so
  caching is a **latency + token-efficiency** win here; the dollar saving becomes
  real at paid-tier rates — which is how the cost readout below frames it.
- **Metering + cost readout:** every `complete()` **and** `embed()` call writes an
  `ai_usage` row (route, model, tokens, cost); caps are checked before dispatch. A
  small internal **cost readout** aggregates these into $/roadmap, per-call token
  usage, and cache hit-rate, and **projects** the paid-tier cost — the honest source
  for the "cut inference cost ~X%" résumé bullet (a projection, not a free-tier
  fiction).

Seeded/mock content (the `weeksData`, `recallData`, `topicDetail` maps already in
`Prep.dc.html`) becomes the **fallback + local-dev provider**, so the UI is fully
functional before any real model is wired.

## 5b. RAG — grounding topic resources against a curated corpus (Phase 4.5)

**The problem it solves (a real failure mode, not a résumé item).** When
topic-detail resources are generated purely from the model's memory, the model
**hallucinates URLs and cites stale/dead links** — the #1 known failure of "ask an
LLM for learning resources." That *is* a retrieval problem, and it's the only place
in Prep that has one. RAG's job here is narrow and honest: **ground the ranked-
resources list on real, vetted documents so no link is invented.** Mental-model and
exercises stay pure generation — no retrieval problem there, so no retrieval.

**Storage — pgvector in the same Postgres (no new datastore).**
```sql
create extension if not exists vector;

resources (
  id uuid primary key default gen_random_uuid(),
  topic_area text not null,        -- coarse tag, e.g. 'react' | 'system-design'
  title text not null,
  url text not null,               -- a real, hand-vetted link
  kind text not null,              -- 'doc' | 'article' | 'talk' | 'spec'
  summary text not null,           -- what it covers (embedded)
  embedding vector(1536)           -- dims match the chosen embedding model
)
-- approximate-NN index for similarity search:
create index resources_embedding_idx on resources
  using hnsw (embedding vector_cosine_ops);
```
This corpus is **global, not per-user** (shared vetted references), so it's the one
table *without* a `user_id`/RLS predicate — reads are public-safe, writes are
server-only via service role. (Call that out explicitly; it's the deliberate
exception to Rule 5, and an interviewer will ask why this table has no RLS.)

**The retrieval → grounding flow (`/api/topics/[id]/detail`):**
1. Build a query string from the topic name + roadmap track.
2. `gateway.embed({ input: query })` → query vector.
3. `pgvector` cosine-similarity search over `resources` (top-k, filtered by
   `topic_area`) → the retrieved docs.
4. `gateway.complete({ tier: 'reasoning', … })` with the retrieved docs in context
   and a schema that requires resources to be **selected/ranked/annotated from the
   provided list** — the model may not introduce a URL that isn't in the retrieved
   set.
5. **Fallback (Rule 9):** if retrieval is empty (niche topic, thin corpus), fall
   back to generated resources **flagged `unverified: true`** in the `detail` JSON so
   the UI can mark them. RAG never hard-blocks.

**Corpus seeding.** v1 corpus is a **hand-curated seed migration** of vetted
MDN/spec/article/talk entries per weak-area — small, honest, defensible. Not
scraped. Embeddings for the seed rows are computed once (a one-off script calling
`gateway.embed()` on the batch) and written to the `embedding` column.

**Why not LangChain/LangGraph for any of this** (asked-about, so decided here):
the retrieval pipeline is *embed → pgvector query → grounded completion* — three
steps we already own end-to-end. A framework would re-introduce exactly what Rule 7
exists to keep out (a vendor SDK in product code) and hide the one interesting part.
There is also **no agent loop** in Prep, so LangGraph has nothing to orchestrate.
Kept the hand-rolled gateway; prepared the "why not" answer instead.

## 6. Auth & security

- Supabase Auth (email/password + Google OAuth).
- **RLS on every table** — a user can only see their own rows.
- Server routes verify the Supabase session before any privileged action.
- **No unauthenticated AI route.** Per-user daily caps enforced server-side.
- Service-role key is server-only; the browser only ever gets the anon key.

## 7. Client architecture

- Design tokens (OKLCH light/dark, IBM Plex) lifted from `Prep.dc.html` into
  global CSS variables — see [design.md](./design.md).
- Screen state that lives in the DB (roadmaps, grades, notes) is fetched via
  supabase-js; transient UI state (wizard step, theme) stays local.
- Charts (hours bars, accuracy line) are hand-rolled SVG as in the design — no
  chart lib dependency for v1.

## 8. Deployment

- **Vercel** for the Next.js app (free tier at MVP traffic).
- **Supabase** managed Postgres + Auth (free tier).
- Env: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (client), `SUPABASE_SERVICE_ROLE_KEY`
  + AI provider key (server-only). Spend cap configured in the chosen provider console.
