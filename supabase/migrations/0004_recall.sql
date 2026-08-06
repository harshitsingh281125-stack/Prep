-- 0004_recall.sql
-- Phase 2: spaced repetition — recall_cards (scheduler state) + recall_reviews
-- (the append-only grade log).
-- Rule 5: RLS on every table (user_id = auth.uid()). Rule 12: raw SQL, checked in.
-- Rule 13: "reviews due today" is served by the (user_id, due_at) index.
--
-- Shape follows Architecture.md §4. Same denormalisation choice as 0003: every
-- table carries user_id copied from the parent, so each RLS predicate is a flat
-- `user_id = auth.uid()` with no join to the parent inside the policy. Tree
-- integrity is held by the FK cascades, not by RLS.
--
-- Scheduler state lives on the card (ease/interval_days/repetitions/due_at); the
-- review log is a separate append-only table so accuracy history survives even
-- when a card's state is overwritten by the next grade.

-- ---------------------------------------------------------------------------
-- recall_cards — one question per card, plus its scheduling state.
--
-- topic_id is `on delete set null` (NOT cascade): if a topic is deleted we keep
-- the card's review history meaningful rather than silently dropping it. The
-- card still belongs to the user via user_id, which is what RLS keys on.
-- roadmap_id cascades, because a card has no meaning without its roadmap.
-- ---------------------------------------------------------------------------
create table if not exists public.recall_cards (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  topic_id         uuid references public.topics (id) on delete set null,
  roadmap_id       uuid references public.roadmaps (id) on delete cascade,
  topic_label      text not null,                  -- denormalised topic name for display
  question         text not null,
  -- scheduler state (fixed ladder + ease modifier — see lib/recall/scheduler.ts):
  ease             numeric not null default 2.5,   -- clamped 1.3 .. 2.8
  interval_days    int     not null default 0,     -- 0 = never reviewed yet
  repetitions      int     not null default 0,     -- consecutive correct grades
  due_at           timestamptz not null default now(),
  last_reviewed_at timestamptz,
  created_at       timestamptz not null default now()
);

-- Rule 13: THE gradeable index. Column order matters — user_id first (equality,
-- and it is what RLS filters on) then due_at (range + the ORDER BY). That lets
-- Postgres seek straight to this user's slice and walk it already sorted by
-- due_at, so `where user_id = auth.uid() and due_at <= now() order by due_at`
-- is an index range scan instead of a full scan + sort.
create index if not exists recall_due_idx on public.recall_cards (user_id, due_at);

-- ---------------------------------------------------------------------------
-- recall_reviews — append-only log of every grade. Never updated, only inserted.
-- This is what session accuracy and (Phase 3) the accuracy trend read from.
-- ---------------------------------------------------------------------------
create table if not exists public.recall_reviews (
  id             uuid primary key default gen_random_uuid(),
  card_id        uuid not null references public.recall_cards (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  grade          text not null check (grade in ('right', 'wrong')), -- self-graded, binary
  -- the scheduler's decision at the time of this grade (audit + Phase 3 trend):
  interval_after int  not null,
  ease_after     numeric not null,
  reviewed_at    timestamptz not null default now()
);

create index if not exists recall_reviews_user_idx on public.recall_reviews (user_id, reviewed_at desc);
create index if not exists recall_reviews_card_idx on public.recall_reviews (card_id, reviewed_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security — a user only ever touches their own rows.
-- ---------------------------------------------------------------------------
alter table public.recall_cards   enable row level security;
alter table public.recall_reviews enable row level security;

drop policy if exists "recall_cards_all_own" on public.recall_cards;
create policy "recall_cards_all_own" on public.recall_cards
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "recall_reviews_all_own" on public.recall_reviews;
create policy "recall_reviews_all_own" on public.recall_reviews
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
