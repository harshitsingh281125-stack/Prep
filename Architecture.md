# Architecture — Prep

> **Stack:** Next.js (App Router) · Supabase (Postgres + Auth + RLS) ·
> provider-agnostic AI Gateway (v1: Google Gemini, live since Phase 4) · Vercel hosting.
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
│ Supabase Postgres │             │ AI provider (v1: Gemini) │
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
- **AI Gateway abstraction:** product code calls `complete({ tier, … })`, never a
  vendor SDK, so the pick can change (or be A/B'd) without a rewrite. **v1 is Google
  Gemini** (settled 2026-07-28, live since Phase 4) — and the abstraction earned its
  keep immediately: Gemini's free tier was returning 429s for days at the start of
  that phase, and swapping to the mock adapter to keep building was a one-env-var
  change rather than a refactor.

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
| `/api/roadmaps/generate` | POST | onboarding answers → schema-valid roadmap → persist; seeded fallback | ✅ reasoning tier |
| `/api/roadmaps/[id]` | DELETE | delete a roadmap (cascades its tree) | ❌ |
| `/api/topics/[id]/detail` | POST | **RAG (Phase 4.5):** embed the topic → corpus search → grounded generation whose resources are real vetted links; empty retrieval falls back to generated `unverified` resources, then to the seeded template | ✅ `embed()` + reasoning tier |
| `/api/recall/[cardId]/grade` | POST | run the scheduler, write next due date + review log | ❌ (self-grade only — see below) |
| `/api/recall/generate` | POST | derive recall cards for one topic; seeded fallback, dedupes | ✅ classification tier |
| `/api/sessions` | POST | log study hours (validates minutes + roadmap/topic ownership) | ❌ |
| `/api/usage` | GET | current user's AI usage vs cap + the cost readout | ❌ |

**Grading stayed non-AI.** The Phase 4 spec floated an optional cheap-tier assist
on free-text recall grading; it wasn't built. Prep self-grades **binary** (Got it /
Missed) by product design, so there is no free text to grade — an AI call there
would be answering a question the product doesn't ask. Rule 17 ("close enough is a
miss") is a *user honesty* rule, and outsourcing it to a model that is structurally
inclined to be generous would work against the one thing the recall loop is for.

**Ownership is checked before spend.** Both generation routes that take an id
re-derive ownership of the row (`.eq('user_id', …)` on top of RLS → 404) *before*
entering the gateway, so a stranger's id can never spend a provider call.

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
  detail jsonb,                   -- NULL until generated on demand (Phase 4).
                                  -- {model, resources[], exercises[], source:'ai'|'seed'}
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

-- Phase 4. One row per provider DISPATCH (not per user action): a generation that
-- came back malformed and was retried writes two. Failures are metered too — the
-- provider billed for them, and metering only successes would make the cap
-- under-count exactly when a broken model is burning the most quota.
ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  route text not null,            -- which endpoint spent the call
  tier text not null,             -- reasoning|classification|embedding (check-constrained)
  model text not null,            -- which model actually served it
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cached_input_tokens int not null default 0,  -- SUBSET of input_tokens, not an addition
  cost_usd numeric not null default 0,         -- ACTUALLY charged; 0 on the free tier
  status text not null,           -- 'ok' | 'invalid' | 'error' (check-constrained)
  attempts int not null default 1,-- 2 = this dispatch was the retry-on-malformed
  latency_ms int,
  created_at timestamptz not null default now()
)
create index ai_usage_user_day_idx on ai_usage (user_id, created_at desc);

-- Phase 4.5. The RAG corpus: hand-vetted references, GLOBAL rather than per-user.
-- 48 rows across 7 topic_areas, curated in 0008_resources_seed.sql.
create extension if not exists vector with schema extensions;

resources (
  id          uuid primary key default gen_random_uuid(),
  topic_area  text not null,          -- curation tag: 'react' | 'js-async' | …
  title       text not null,
  url         text not null unique,   -- real, HTTP-verified at curation time
  kind        text not null,          -- doc|deep|article|talk|spec (check-constrained)
  summary     text not null,          -- THIS is the text that gets embedded
  embedding   extensions.vector(1536),-- NULL until scripts/embed-corpus.ts fills it
  created_at  timestamptz not null default now()
)
create index resources_area_idx on resources (topic_area);
create index resources_embedding_idx on resources using hnsw (embedding extensions.vector_cosine_ops);
```

**Why `vector(1536)` and not the model's native 3072** — measured, not assumed
(probe, 2026-08-13): `gemini-embedding-001` returns 3072 dims at unit length and
honours `outputDimensionality` to truncate, but the truncated vectors come back
**not** normalised (1536 → L2 0.7023). We take 1536 regardless because **pgvector
cannot index a `vector` wider than 2000 dimensions** (HNSW and IVFFlat both
refuse) — at 3072 the options are a sequential scan forever or `halfvec` at half
precision. 1536 is a Matryoshka truncation, so the leading dims carry most of the
signal. The backfill normalises: irrelevant under `vector_cosine_ops` (cosine is
scale-invariant, so both the ranking and the floor are unaffected), but it removes
a trap if the opclass is ever changed to inner-product or L2.

**`resources` is NOT "the table without RLS" — that plan was a hole.** Earlier
drafts of this document and Rules.md described it that way. On Supabase every
`public` table is granted select/insert/update/delete to `anon` and
`authenticated` by default, and **RLS is what narrows those grants** — so a public
table with RLS *off* is world-**writable** with the anon key, i.e. anyone could
inject a URL into the one list this feature promises is trustworthy. As shipped:
RLS is **enabled**, with `for select using (true)` (shared public reference data)
and **no** write policy at all, so every client write is denied and curation goes
through migrations and the service role. A redundant `revoke insert, update,
delete … from anon, authenticated` backs that up in case a later migration
copy-pastes a `for all` policy from a sibling table.

So the Rule 5 exception is narrower than originally advertised: **`resources` is
the one table with no `user_id` PREDICATE, not the one table with no RLS.** It is
the same two-axis shape as `ai_usage` — *ownership decides who may READ; whether
the value enforces a product rule decides who may WRITE* — with the read scope
widened from "own rows" to "everyone" because the data is public rather than
personal.

### The retrieval query — `match_resources()`
```sql
create or replace function public.match_resources(
  query_embedding extensions.vector(1536),
  match_count     int   default 5,
  min_similarity  float default 0.64
) returns table (id uuid, topic_area text, title text, url text,
                 kind text, summary text, similarity float)
language sql stable security invoker
set search_path = public, extensions
as $$
  select r.id, r.topic_area, r.title, r.url, r.kind, r.summary,
         1 - (r.embedding <=> query_embedding) as similarity
  from public.resources r
  where r.embedding is not null
    and 1 - (r.embedding <=> query_embedding) >= min_similarity
  order by r.embedding <=> query_embedding
  limit match_count;
$$;
```
It is a database function because supabase-js has no vocabulary for a vector
operator — there is no way to express `order by embedding <=> $1` through the
client library. `security invoker` + a pinned `search_path` are both direct
consequences of the Phase 0 SECURITY DEFINER bug (memory.md). **Honest note on
the index:** at 48 rows the planner will very likely seq-scan, and it should — an
ANN index earns its keep in the thousands. It exists so the query doesn't have to
change as the corpus grows, and because adding it to a live table later is the
expensive version of the same decision.

**`ai_usage` is the one table whose RLS is deliberately NOT the flat `for all`
policy** every other table here uses. It gets `for select using (user_id =
auth.uid())` and **no insert/update/delete policy at all**; the gateway writes it
through the service-role client (`lib/supabase/admin.ts`). **Why:** the daily cap
is a `COUNT` of these rows, so a `for all` policy would let any signed-in browser
`DELETE /rest/v1/ai_usage` with the anon key and reset its own cap — Rule 3's
"hard cap" would be advisory. Generalising the Phase 2/3 rule-of-thumb one step
further: **a row can be about a user without being theirs to write. Ownership
decides who may READ it; whether the value enforces a product rule decides who
may WRITE it.** The service-role client is typed against only this table, so
using it to bypass RLS elsewhere is a compile error, and `import "server-only"`
makes leaking it into a client bundle a build failure.

**`cost_usd` is what was actually charged — not the paid-tier projection.** On the
v1 free tier it is `0` on every row. The projection ($/roadmap, cache saving) is
derived at read time in `lib/ai/cost.ts` from the token columns × a rate card, for
the same reason §4c derives roadmap status instead of storing it: a stored
projection goes stale the moment the rate card or the model binding changes, and a
column named `cost_usd` holding money nobody was charged is a fiction waiting to be
quoted. `AI_BILLING_MODE=paid` switches it to the computed cost once billing is real.

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

## 5. AI Gateway (built in Phase 4)

A single server-side module. Product code depends on **this interface only** —
never a vendor SDK.

**As built (Phase 4).** The shipped signature differs from the original sketch in
one way worth calling out: it returns a **discriminated union rather than
throwing**, and the caller must destructure `ok`.

```ts
// lib/ai/gateway.ts  (server-only)
type Tier = 'reasoning' | 'classification' | 'embedding';

async function complete<T>(opts: {
  tier: Exclude<Tier, 'embedding'>;
  route: string;              // the endpoint spending the call → $/roadmap grouping
  userId: string;             // metering + caps
  system: string;             // fixed, cacheable scaffolding (no interpolation!)
  input: string;              // the per-call variable part
  jsonSchema?: JsonSchema;    // provider-side structured-output constraint
  validate: (raw: unknown) => T | null;   // OUR check; null ⇒ unusable
}, deps?: Partial<GatewayDeps>): Promise<
  | { ok: true;  data: T; usage: Usage; model: string; attempts: number }
  | { ok: false; reason: 'cap' | 'provider' | 'invalid' | 'disabled'; attempts: number }
>;

// Phase 4.5 (RAG): embed() joins the same module, metered identically (Rules 7/8/11).
async function embed(opts: {
  route: string;
  userId: string;
  input: string;
  purpose: 'query' | 'document';   // retrieval embeddings are asymmetric
}, deps?: Partial<GatewayDeps>): Promise<
  | { ok: true;  vector: number[]; usage: Usage; model: string }
  | { ok: false; reason: 'cap' | 'provider' | 'invalid' | 'disabled' }
>;
```

**`embed()` differs from `complete()` in three deliberate ways.** (1) **No retry.**
`complete()` retries once because a model can return malformed JSON and then valid
JSON for the same prompt — the failure is non-deterministic. An embedding has no
schema to get wrong; the only non-network failure is a **width** mismatch, which is
a config error that reproduces exactly, so retrying would spend a second call from
the user's cap to fail identically. (2) **No `validate` callback** — the sole
correctness property is the vector width, and the gateway already knows it
(`EMBEDDING_DIM`), so the caller isn't asked. It is checked *here* rather than left
to Postgres, because a rejected insert would abandon a corpus backfill half-done.
(3) It writes `ai_usage` with `tier: 'embedding'`, which is what makes the true cost
of grounding visible: **two metered calls per topic, not one.**

`Provider.embed()` is **required**, not optional, even though one route uses it —
an adapter that can complete but not embed would fail at runtime in the middle of a
user's request, and making it part of the interface turns "can this provider serve
Prep?" into a compile-time question.

**Why a union and not an exception.** An AI failure is a routine, expected branch
here — Rule 9 says it must never hard-block a flow. Forcing every call site to
destructure `ok` means every call site has to *state its fallback*; a thrown error
can be forgotten and take out the request. `deps` exists so the cap/retry/metering
logic is unit-testable against a fake provider with no network and no DB — the same
discipline as the pure scheduler (§4b) and progress aggregation (§4c).

**The gateway owns four things call sites are not trusted with:**

1. **The cap** (Rule 3) — counted from `ai_usage` *before* dispatch, and re-checked
   before the retry so a user on the boundary can't step over it via a malformed
   first response. It **fails closed**: if the usage table can't be read we cannot
   prove the user is under their cap, so we don't dispatch (a DB blip must not
   silently produce an uncapped AI endpoint).
2. **Validation + exactly one retry** (Rule 9), then it gives up on purpose.
3. **Metering** (Rule 11) — one row per dispatch, failures included.
4. **The provider binding** — which adapter, which model for this tier.

**Provider adapters** implement a deliberately narrow interface (`complete()` →
text + token counts). Two ship: `gemini` (raw `fetch`, no vendor SDK — Rule 7) and
`mock` (deterministic, with injectable failure modes via `AI_MOCK_MODE`, used by
local dev and the whole E2E suite so tests never depend on a third party's uptime).

- **Tiers, not model names**, in product code. A config map binds each tier to a
  concrete model. **v1 binding (settled 2026-07-28) — Google Gemini free tier:**
  ```ts
  // lib/ai/config.ts  (the ONLY file naming concrete models)
  const MODELS = {
    reasoning:      'gemini-3.5-flash',       // roadmap gen, topic detail (rare, high-value)
    classification: 'gemini-3.5-flash-lite',  // recall-card gen (frequent)
    embedding:      'gemini-embedding-001',   // embed() for Phase 4.5 RAG
  };
  ```
  *(Model ids verified against the live `models.list` endpoint before the adapter
  was written, 2026-08-08.)*
  Chosen so a solo portfolio project runs at ~$0. **Cost-routing insight:** the
  pricier-per-token tier is on the *rare* call, the cheap tier on the *frequent* one
  — cost tracks volume, not importance. Swapping to Claude (or A/B-ing) = editing this
  one map; product code never changes.
- **Schema validation + retry:** if `schema` is set, validate the response; on
  failure, retry once with a "return valid JSON only" nudge; on repeated failure,
  the caller falls back to a **seeded template** (app never hard-blocks).
- **Prompt caching — be precise about which kind.** We rely on Gemini's **implicit**
  caching, not the explicit `CachedContent` API. Implicit caching keys on a stable
  leading prefix, so the mechanism is a discipline rather than a call: every
  `SYSTEM_*` string in `lib/ai/prompts.ts` is a module constant with **no
  interpolation**, and all per-user variation lives in the input. Move one
  user-specific token up into the system string and the hit-rate silently goes to
  zero. The retry nudge is appended to the *input* for the same reason — rewriting
  the system string on retry would invalidate the cached prefix and make the retry
  cost more than the call it retries. `cached_input_tokens` is recorded per dispatch
  so the hit-rate is **measured, not assumed**. *Explicit `CachedContent` was
  considered and skipped: it carries minimum-token thresholds and TTL management for
  a scaffolding block of a few hundred tokens — cost without benefit at this size.*
  On the v1 free tier the *dollar* saving is ~$0 (everything is free), so caching is
  a **latency + token-efficiency** win here; the dollar saving becomes real at
  paid-tier rates, which is how the cost readout frames it.
- **Metering + cost readout:** every `complete()` **and** `embed()` call writes an
  `ai_usage` row (route, model, tokens, cost); caps are checked before dispatch. A
  small internal **cost readout** aggregates these into $/roadmap, per-call token
  usage, and cache hit-rate, and **projects** the paid-tier cost — the honest source
  for the "cut inference cost ~X%" résumé bullet (a projection, not a free-tier
  fiction).

**Seeded/mock content is the fallback + local-dev provider** — as of Phase 4 this is
built, not planned. Three distinct things play that role and they are worth keeping
separate:

- `lib/seed/generate.ts` (from the design's `weeksData`) — the fallback when a
  roadmap generation is capped, unreachable, or twice-malformed;
- `lib/seed/detail.ts` (from `topicDetail`) — the same for topic detail. It moved out
  of the roadmap generator in Phase 4: roadmaps now ship `detail: null` on every
  topic, so this is a fallback rather than a default;
- `lib/seed/recall.ts` (from `recallData`) — the same for recall cards, keyed by
  *catalog* topic name, so it only matches seeded roadmaps.

Plus `lib/ai/providers/mock.ts`, a deterministic provider selected by
`AI_PROVIDER=mock`, with `AI_MOCK_MODE` to inject the malformed/error paths on demand.
The app is therefore fully functional with AI switched off entirely — which is Rule 9's
real test, and is exercised by manual suite FALL rather than merely asserted.

## 5b. RAG — grounding topic resources against a curated corpus (Phase 4.5)

**The problem it solves (a real failure mode, not a résumé item).** When
topic-detail resources are generated purely from the model's memory, the model
**hallucinates URLs and cites stale/dead links** — the #1 known failure of "ask an
LLM for learning resources." That *is* a retrieval problem, and it's the only place
in Prep that has one. RAG's job here is narrow and honest: **ground the ranked-
resources list on real, vetted documents so no link is invented.** Mental-model and
exercises stay pure generation — no retrieval problem there, so no retrieval.

**Storage — pgvector in the same Postgres (no new datastore).** Schema, index,
RLS and the `match_resources()` function are in §4 above, as applied by
`0007_resources.sql`. Two things changed between the sketch and the build and are
called out there: the table **does** have RLS (a `true` read predicate, no write
policy — "no RLS" on Supabase means world-writable), and `kind` has five values
rather than four so a corpus row maps onto the UI's existing resource chips
without a lossy translation.

**The retrieval → grounding flow (`/api/topics/[id]/detail`), as built:**
1. Build a query string from the topic name + **its week title** —
   `lib/rag/query.ts`, pure and unit-tested. It deliberately excludes the roadmap
   title: those are model-written plan names ("8 weeks to a senior bar") whose
   vocabulary appears in no technical document, so they pull the query vector away
   from the corpus without adding subject signal.
2. `gateway.embed({ purpose: 'query' })` → query vector, metered like any other
   call (Rule 11).
3. `match_resources()` — cosine top-k over `resources`, above a **similarity
   floor**.
4. **Grounded** `complete({ tier: 'reasoning' })`: the retrieved documents are
   given to the model **numbered**, and the schema asks only for
   `{ ref, why }` pairs.
5. **Fallback (Rule 9):** empty retrieval → the Phase 4 ungrounded generation,
   resources flagged `unverified: true`; that failing twice → the seeded template.
   Three rungs, each labelled in the response (`source: 'rag' | 'ai' | 'seed'`).

**The two design decisions worth defending in §5b:**

**(a) The model never handles a URL — it cites by index.** The original plan was
"a schema that requires resources to be selected from the provided list", then
validating that no returned URL is outside the retrieved set. What shipped is
stronger: `GROUNDED_DETAIL_SCHEMA` has no `url`, `title` or `tag` field, so the
model returns a 1-based `ref` into the documents we supplied plus a one-line
`why`, and `validateGroundedDetail()` resolves that index back to **our** row.
A hallucinated citation isn't rejected — it's **unrepresentable**, and the only
remaining check is that an integer is in range. Same move as "the model writes
content, not contract" (§4/validate.ts): *don't validate away a failure you can
make impossible to express.* The honest cost: the model can no longer recommend a
genuinely good document that isn't in the corpus.

**(b) The similarity floor is the gate, and it was calibrated, not guessed.** The
sketch said "top-k filtered by `topic_area`"; the filter was dropped and the floor
kept. A plain top-k always returns k rows however irrelevant, so the floor is what
makes "we have nothing for this topic" expressible — and therefore what makes the
Rule 9 fallback branch reachable at all. Filtering by area on top would need a
keyword classifier from a generated topic name to a corpus tag, adding a failure
mode (misclassification silently excludes the right documents) to solve a problem
the embedding already solves, since cross-domain bleed shows up as a low score.
**The number matters more than it looks:** it started at 0.55 and that was wrong —
Gemini embeddings are not zero-centred, and unrelated text ("Kafka consumer group
rebalancing") still scores ~0.55–0.57. It is **0.64**,
above every off-domain score measured and below every relevant one, and
`npm run probe:retrieval` re-checks that separation and exits non-zero if an
off-domain query ever clears the floor.

**Corpus seeding.** A **hand-curated seed migration** (`0008_resources_seed.sql`)
of vetted MDN / WHATWG / react.dev / web.dev / RFC / spec entries across 26
topic areas — small, honest, defensible, not scraped. **Every URL was fetched and
confirmed to return 200 before it was written into the migration**, which caught a
404 and a redirect-to-a-duplicate; shipping links one is merely confident about
would have reproduced by hand the exact failure this phase removes. Embeddings are
computed afterwards by `scripts/embed-corpus.ts` through `gateway.embed()`, so the
corpus stays reviewable as plain SQL in git rather than as 48 unreadable 1536-float
literals, and re-embedding after a model change is a re-run rather than a migration.

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
