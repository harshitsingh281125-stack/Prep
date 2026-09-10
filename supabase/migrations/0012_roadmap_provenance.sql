-- 0012_roadmap_provenance.sql
-- Phase 5: make a roadmap's generator provenance DURABLE.
-- Rule 12: raw SQL, checked in. No new table, so no new RLS policy — the column
-- lives on `roadmaps`, which is already covered by `roadmaps_all_own` (0003).
--
-- ---------------------------------------------------------------------------
-- WHY THIS REVERSES A PHASE 4 DECISION (read before "simplifying" it away)
-- ---------------------------------------------------------------------------
-- Phase 4 deliberately reported `source` ('ai' | 'seed') in the POST response and
-- did NOT store it: at that point it was a fact about one request, and /usage was
-- the durable audit trail of what the gateway dispatched and how it ended.
--
-- Phase 5 adds a role the seeded catalog cannot serve ("SDE-2 · Backend" — the
-- CATALOG in lib/seed/catalog.ts is a FRONTEND curriculum). The moment that role
-- exists, "which generator produced this roadmap" stops being a fact about a
-- request and becomes a property of the plan the user is being held to: a backend
-- candidate whose generation fell back to the seed is holding a frontend plan.
-- Rule 9 says AI must never hard-block a flow, and it doesn't here — but an
-- honest fallback has to stay visible after the toast that announced it is gone.
-- A transient response field cannot label a row a user opens three weeks later.
--
-- The column is deliberately DUMB — it records which path ran, nothing more. The
-- judgement ("is this template wrong for your role?") is a pure function in
-- lib/seed/catalog.ts (templateMismatch), so it is unit-testable and can change
-- without a migration.
--
-- NULL is a real, expected value: every roadmap created before this migration
-- has unknown provenance. The UI must read NULL as "unknown", never as "ai" —
-- guessing 'ai' would silently un-label exactly the rows we cannot vouch for.

alter table public.roadmaps
  add column if not exists generated_from text;

-- Constrained at the column because the set of legal values is an invariant, not
-- a preference: the DB is the last line of defence, exactly as study_sessions'
-- `minutes` 1..1440 CHECK is (migration 0005), and `roadmaps` sits under a
-- `for all` RLS policy so a client CAN write to its own rows directly.
--
-- BE PRECISE ABOUT WHAT THIS DOES AND DOESN'T BUY. It guarantees the column only
-- ever holds 'ai', 'seed' or NULL, so nothing downstream has to defend against
-- junk. It does NOT stop an owner from flipping their own row from 'seed' to
-- 'ai' with the anon key and dismissing their own honesty notice — RLS scopes
-- writes to the owner, and there is no column-level grant here. That is accepted
-- rather than fixed: the only person deceived is the person doing it, no other
-- user's data is reachable, and the alternatives (a BEFORE UPDATE trigger, or
-- revoking client writes on `roadmaps` and routing mastery/edits through the
-- server) both cost more than the threat is worth. Recorded so nobody later
-- reads this CHECK as a tamper-proofing claim it never made.
--
-- Added separately (and idempotently) so re-running the file is safe.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'roadmaps_generated_from_check'
  ) then
    alter table public.roadmaps
      add constraint roadmaps_generated_from_check
      check (generated_from is null or generated_from in ('ai', 'seed'));
  end if;
end $$;

comment on column public.roadmaps.generated_from is
  'Which generator produced this tree: ai | seed | null (created before Phase 5, unknown). Read with lib/seed/catalog.ts templateMismatch().';
