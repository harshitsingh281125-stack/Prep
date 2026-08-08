-- 0005_study_sessions.sql
-- Phase 3: the honest progress dashboard — study_sessions, the append-only log of
-- hours actually spent. Everything the Progress screen claims is derived from
-- these rows plus recall_reviews (Phase 2) and topics (Phase 1).
-- Rule 5: RLS on every table (user_id = auth.uid()). Rule 12: raw SQL, checked in.
--
-- Shape follows Architecture.md §4, with two deliberate departures from the
-- sketch there, both recorded in memory.md:
--
--   1. `minutes` is stored, not hours. Hours are the display unit but a bad
--      storage unit: "I studied 90 minutes" is not representable as an int hour,
--      and a float hour invites rounding drift once you sum hundreds of rows.
--      Integer minutes sum exactly; the UI divides by 60 at the last moment.
--
--   2. topic_id is `on delete set null`, matching recall_cards' choice in 0004
--      rather than the tree-cascade of weeks/topics. Deleting a topic must not
--      erase the fact that you spent four hours on it — that would let the
--      dashboard flatter you by forgetting effort, which is the exact opposite
--      of Rule 19 ("no vanity metrics; the headline is honest pace-vs-plan").
--      The hours survive as roadmap-level, unattributed time.
--
-- Week attribution (settled 2026-08-08): a session's bar in the hours chart is
-- resolved through topic_id -> topics.week_id, NOT by the calendar position of
-- logged_at. The chart therefore answers "what did you study", not "when did you
-- study" — which is what makes the "Week 3 hasn't started" blocker literally true
-- instead of merely suggestive. Sessions with a null topic_id are unattributed:
-- they still count toward total hours logged, but fill no week's bar.

-- ---------------------------------------------------------------------------
-- study_sessions — one row per logged block of study time. Append-only in
-- practice (the UI only ever inserts), so the hours history is auditable the
-- same way recall_reviews makes the grade history auditable.
-- ---------------------------------------------------------------------------
create table if not exists public.study_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  roadmap_id uuid not null references public.roadmaps (id) on delete cascade,
  topic_id   uuid references public.topics (id) on delete set null,
  -- Bounded at the column, not just in the route handler: the DB is the last
  -- line of defence for an invariant, and a client writing directly under RLS
  -- (as notes/mastery do) would otherwise be able to log a 10000-hour session
  -- and fake being on pace. 1..1440 = at least a minute, at most one day.
  minutes    int not null check (minutes > 0 and minutes <= 1440),
  note       text,
  logged_at  timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- The dashboard's two hot reads, both scoped to one user:
--   (a) "all sessions for this roadmap"  -> the per-week bars + total logged
--   (b) "my sessions, newest first"      -> the "0 hours in the last N days"
--                                           blocker and the pace calculation
-- Same column-order reasoning as recall_due_idx (Rule 13): the equality column
-- leads, the range/sort column trails, so each is an index range scan that emits
-- rows already ordered and needs no sort node.
create index if not exists study_sessions_roadmap_idx
  on public.study_sessions (roadmap_id, logged_at desc);

create index if not exists study_sessions_user_idx
  on public.study_sessions (user_id, logged_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security — a user only ever touches their own rows.
-- ---------------------------------------------------------------------------
alter table public.study_sessions enable row level security;

drop policy if exists "study_sessions_all_own" on public.study_sessions;
create policy "study_sessions_all_own" on public.study_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
