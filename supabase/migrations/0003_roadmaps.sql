-- 0003_roadmaps.sql
-- Phase 1: the roadmap data model — roadmaps, weeks, topics, notes.
-- Rule 5: RLS on every table (user_id = auth.uid()). Rule 12: raw SQL, checked in.
--
-- Shape follows Architecture.md §4. A roadmap owns weeks; a week owns topics; a
-- topic owns exactly one notes row. Every child table carries user_id (denormalised
-- from the parent) so its RLS predicate is a direct `user_id = auth.uid()` — no join
-- to the parent needed inside the policy (RLS predicates that self-join are slow and
-- easy to get wrong). Integrity of the tree is held by the FK cascades, not by RLS.

-- ---------------------------------------------------------------------------
-- roadmaps — one per onboarding run (quota: max_roadmaps rows per user, Rule 18)
-- ---------------------------------------------------------------------------
create table if not exists public.roadmaps (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null,
  subtitle      text,
  answers       jsonb not null,                 -- raw onboarding answers (audit + regen)
  weeks_count   int  not null,
  hours_planned int  not null,
  hours_logged  int  not null default 0,
  status        text not null default 'fresh',  -- fresh|ontrack|behind|stalled|done
  target_date   date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists roadmaps_user_idx on public.roadmaps (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- weeks — ordered curriculum blocks within a roadmap
-- ---------------------------------------------------------------------------
create table if not exists public.weeks (
  id            uuid primary key default gen_random_uuid(),
  roadmap_id    uuid not null references public.roadmaps (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  n             int  not null,                  -- week number (1-based, ordered)
  title         text not null,
  hours         int  not null,
  kill_criterion text not null,
  unique (roadmap_id, n)
);

create index if not exists weeks_roadmap_idx on public.weeks (roadmap_id, n);

-- ---------------------------------------------------------------------------
-- topics — study units within a week. detail jsonb is the mental model /
-- resources / exercises (seeded now, AI-generated in Phase 4).
-- ---------------------------------------------------------------------------
create table if not exists public.topics (
  id           uuid primary key default gen_random_uuid(),
  week_id      uuid not null references public.weeks (id) on delete cascade,
  roadmap_id   uuid not null references public.roadmaps (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  position     int  not null default 0,         -- order within the week
  status       text not null default 'not_started', -- not_started|in_progress|mastered
  detail       jsonb,                           -- {model, resources[], exercises[]}
  mastered_at  timestamptz
);

create index if not exists topics_week_idx on public.topics (week_id, position);

-- ---------------------------------------------------------------------------
-- notes — exactly one autosaved note body per topic
-- ---------------------------------------------------------------------------
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  topic_id    uuid not null references public.topics (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  body        text not null default '',
  updated_at  timestamptz not null default now(),
  unique (topic_id)                             -- one note row per topic (upsert target)
);

-- ---------------------------------------------------------------------------
-- Row Level Security — every table: a user only ever touches their own rows.
-- ---------------------------------------------------------------------------
alter table public.roadmaps enable row level security;
alter table public.weeks    enable row level security;
alter table public.topics   enable row level security;
alter table public.notes    enable row level security;

-- roadmaps
drop policy if exists "roadmaps_all_own" on public.roadmaps;
create policy "roadmaps_all_own" on public.roadmaps
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- weeks
drop policy if exists "weeks_all_own" on public.weeks;
create policy "weeks_all_own" on public.weeks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- topics
drop policy if exists "topics_all_own" on public.topics;
create policy "topics_all_own" on public.topics
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- notes
drop policy if exists "notes_all_own" on public.notes;
create policy "notes_all_own" on public.notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Keep updated_at fresh (reuses public.set_updated_at() from 0001/0002 —
-- already SECURITY-safe with a pinned search_path).
-- ---------------------------------------------------------------------------
drop trigger if exists roadmaps_set_updated_at on public.roadmaps;
create trigger roadmaps_set_updated_at
  before update on public.roadmaps
  for each row execute function public.set_updated_at();

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();
