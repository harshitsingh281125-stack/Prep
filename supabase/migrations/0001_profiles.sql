-- 0001_profiles.sql
-- Phase 0: the profiles table (one row per user, extends auth.users) + RLS.
-- Rule 5: RLS on every table, user_id = auth.uid(). Rule 12: raw SQL, checked in.
--
-- profiles.id IS the auth.users id (not a separate user_id column), so the RLS
-- predicate compares `id = auth.uid()`. A trigger auto-creates the row on signup
-- so the app never has to insert it, and display_name/track seed from OAuth
-- metadata when present.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  track         text,                       -- e.g. 'SDE-2 · Frontend'
  theme         text not null default 'dark',
  max_roadmaps  int  not null default 3,    -- free-plan quota (Rule 18)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- A user can read only their own profile.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

-- A user can update only their own profile.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- A user can insert only their own profile row (belt-and-suspenders; the
-- trigger below normally creates it via SECURITY DEFINER).
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Auto-create a profile row on signup
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer            -- runs as owner so it can insert past RLS
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, track)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    null
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Keep updated_at fresh on profile updates
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
