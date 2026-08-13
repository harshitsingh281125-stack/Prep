-- 0006_ai_usage.sql
-- Phase 4: the AI Gateway's metering table. Every provider call — completion now,
-- embed() in Phase 4.5 — writes exactly one row here (Rule 11), and the hard
-- per-user daily cap (Rule 3) is a COUNT over this table taken *before* dispatch.
-- Rule 5: RLS on every table. Rule 12: raw SQL, checked in.
--
-- Shape follows Architecture.md §4 with three deliberate additions, all recorded
-- in memory.md:
--
--   1. `tier` alongside `model`. Product code speaks tiers (Rule 8); the model is
--      a config binding that will change. Storing both means the usage history
--      stays readable across a model swap ("what did the reasoning tier cost"
--      still answers itself after gemini-3.5-flash becomes something else).
--
--   2. `cached_input_tokens`. The prompt-caching win (Rule 10) is unmeasurable
--      without it — cache hit-rate is cached_input_tokens / input_tokens, and
--      that ratio is the honest basis for the "cut inference cost" claim.
--
--   3. `status` + `attempts`. A malformed generation that was retried and then
--      fell back to the seed (Rule 9) still consumed tokens, so it must still be
--      metered. Recording *how* the call ended is what makes the fallback rate a
--      visible number rather than an invisible degradation.
--
-- On `cost_usd` — it stores the ACTUALLY CHARGED cost, which on the v1 free tier
-- is 0. It is NOT the paid-tier projection. The projection is derived at read
-- time in lib/ai/cost.ts from the token columns times a rate card, for the same
-- reason Phase 3 derives roadmap status instead of storing it: a stored
-- projection goes stale the moment the rate card or the model binding changes,
-- and a column named `cost_usd` holding a number nobody was charged is a lie
-- waiting to be quoted in an interview.

-- ---------------------------------------------------------------------------
-- ai_usage — one row per dispatched provider call. Append-only.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_usage (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  route               text not null,          -- which endpoint spent the call
  tier                text not null check (tier in ('reasoning', 'classification', 'embedding')),
  model               text not null,          -- the concrete model that served it
  input_tokens        int  not null default 0,
  output_tokens       int  not null default 0,
  cached_input_tokens int  not null default 0, -- subset of input_tokens served from cache
  cost_usd            numeric not null default 0, -- actually charged; 0 on the free tier
  status              text not null check (status in ('ok', 'invalid', 'error')),
  attempts            int  not null default 1, -- 2 = the retry-on-malformed path ran
  latency_ms          int,
  created_at          timestamptz not null default now()
);

-- The cap query: "how many calls has this user made since midnight UTC".
-- Same column-order reasoning as recall_due_idx (Rule 13) — the equality column
-- (user_id) leads, the range column (created_at) trails, so the count is an
-- index range scan over one user's slice rather than a scan of everyone's usage.
create index if not exists ai_usage_user_day_idx
  on public.ai_usage (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security — and here it is deliberately NOT the flat `for all`
-- policy every other table in this schema uses.
--
-- ai_usage is the one user-owned table the user must not be able to WRITE. The
-- daily cap (Rule 3) is a COUNT of these rows; a `for all` policy would let any
-- signed-in browser do `DELETE /rest/v1/ai_usage` with the anon key and reset
-- its own cap to zero — the cap would be advisory, which is exactly what Rule 3
-- says it must not be. So: SELECT-only for the owner (the /usage readout reads
-- its own rows), and INSERTs come from the server through the service-role
-- client, which bypasses RLS by design.
--
-- Generalising the Phase 2/3 rule-of-thumb one step further: a row can be about
-- a user without being theirs to write. Ownership decides who may READ it;
-- whether the value enforces a product rule decides who may WRITE it.
-- ---------------------------------------------------------------------------
alter table public.ai_usage enable row level security;

drop policy if exists "ai_usage_all_own"    on public.ai_usage;
drop policy if exists "ai_usage_select_own" on public.ai_usage;
create policy "ai_usage_select_own" on public.ai_usage
  for select using (user_id = auth.uid());

-- No insert/update/delete policy exists on purpose. With RLS enabled and no
-- permissive policy for those commands, every client-side write is denied.
