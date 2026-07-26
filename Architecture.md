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
│  ── SM-2 scheduling writes                                  │
└───────┬───────────────────────────────────┬────────────────┘
        │ service-role (server only)         │
        ▼                                     ▼
┌───────────────────┐             ┌──────────────────────────┐
│ Supabase Postgres │             │ AI provider (v1: TBD)    │
│  + RLS policies   │             │  behind the Gateway iface │
└───────────────────┘             └──────────────────────────┘
```

**Rule of thumb for where logic runs:**
- **Client + RLS** for plain reads/writes a user owns (roadmaps, notes, grading a card).
- **Server route** for anything that must be trusted: AI calls, quota checks,
  usage metering, and any write whose integrity can't be guaranteed client-side.

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
| `/api/topics/[id]/detail` | POST | generate/refresh mental model + resources + exercises | ✅ reasoning tier |
| `/api/recall/[cardId]/grade` | POST | apply SM-2, write next due date | ⚪ optional cheap-tier assist |
| `/api/recall/generate` | POST | derive recall cards for a topic | ✅ classification tier |
| `/api/sessions` | POST | log study hours | ❌ |
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
  hours_logged int default 0,
  status text default 'fresh',    -- fresh|ontrack|behind|stalled|done
  target_date date,
  created_at timestamptz default now()
)

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
  topic_id uuid references topics on delete set null,
  roadmap_id uuid,
  question text not null,
  -- SM-2 state:
  ease numeric default 2.5,
  interval_days int default 0,
  repetitions int default 0,
  due_at timestamptz not null default now(),
  last_reviewed_at timestamptz
)

recall_reviews (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references recall_cards on delete cascade,
  user_id uuid not null,
  grade text not null,            -- 'right' | 'wrong'  (self-graded)
  reviewed_at timestamptz default now()
)

study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  roadmap_id uuid,
  topic_id uuid,
  minutes int not null,
  logged_at timestamptz default now()
)

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
}
```

- **Tiers, not model names**, in product code. A config map binds each tier to a
  concrete model. **v1 model choice for each tier is the open decision to brainstorm**
  (cheap/free candidates). Swapping = editing the config map.
- **Schema validation + retry:** if `schema` is set, validate the response; on
  failure, retry once with a "return valid JSON only" nudge; on repeated failure,
  the caller falls back to a **seeded template** (app never hard-blocks).
- **Prompt caching:** `system` scaffolding is marked cacheable where the provider
  supports it.
- **Metering:** every call writes an `ai_usage` row; caps are checked before dispatch.

Seeded/mock content (the `weeksData`, `recallData`, `topicDetail` maps already in
`Prep.dc.html`) becomes the **fallback + local-dev provider**, so the UI is fully
functional before any real model is wired.

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
