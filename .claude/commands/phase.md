---
description: Build a full Prep phase end-to-end (plan → build → test → QA gate → commit/PR), the way Phase 1 was done.
argument-hint: <phase number, e.g. 2>  (optional; defaults to the next unfinished phase in phases.md)
---

# Build Phase $1 of Prep

You are executing **one full phase** of the Prep build, following the exact
disciplined workflow this project established in Phase 1. Do the whole loop; don't
stop halfway. The target phase is **$1** (if blank, read `phases.md` and pick the
first phase not marked ✅ DONE).

## Rules that govern this (read them, they override defaults)
Load context first — **read these before writing any code**:
- `phases.md` — the spec for phase $1 (its Goal, bullets, and Demo line are the
  success criteria).
- `Rules.md` — all 27 invariants, especially **Rule 27 (QA gate)**, Rule 18 (quota),
  Rule 5 (RLS), Rule 12 (raw SQL), Rule 16 (mastery earned), Rule 9 (AI fallback).
- `Architecture.md` (§4 schema, §5 gateway if AI is involved) and `design.md`
  (token/component fidelity — Rule 20/21).
- `memory.md` — settled decisions (don't re-litigate) + open questions (some phases
  have one that must be decided first).
- `CLAUDE.md` — coding discipline + working conventions.
- The design source `Prep - Interview Prep OS.html` — extract the real seeded data /
  markup for this phase's screens (as done for `weeksData`/`topicDetail` in Phase 1).

## The workflow — do these steps in order

1. **Plan.** Maintain a TodoWrite list for the phase. Read the docs above. If
   `memory.md` flags an **open question** that blocks this phase (e.g. the Phase 2
   SM-2-vs-fixed-cadence decision), **stop and ask the user with AskUserQuestion
   before building** — a wrong guess here is expensive. State any assumptions you
   can't verify.

2. **Schema first (if the phase adds tables).** Write a plain-SQL migration
   `supabase/migrations/000N_<name>.sql` — RLS on every table (denormalised
   `user_id` → flat `user_id = auth.uid()` policy, one `for all` policy per table),
   cascade FKs, `set_updated_at` triggers where relevant, and any required indexes
   (e.g. the `(user_id, due_at)` recall index — Rule 13). Follow the 0001/0003
   patterns exactly.
   - **You cannot apply migrations** (MCP is unauthorized in the shell; the
     Management API WAF-blocks DDL — see memory.md). So after writing it, **give the
     user click-by-click SQL-Editor steps and PAUSE for confirmation** before relying
     on the tables.

3. **Build the logic + screens.** Smallest thing that satisfies the phase (Rule:
   simplicity first, surgical changes). Server-enforce anything that must be trusted
   (quota, AI, privileged writes) via route handlers; owned rows under RLS can be
   written directly from the client. Match design tokens/components; no raw hex.
   Reuse existing helpers (`lib/roadmap/status.ts`, `lib/seed/*`, shell components).

4. **Typecheck + build green.** `npm run build` must pass clean (typecheck + lint).
   Fix everything.

5. **Automated tests (the layered strategy from Phase 1).**
   - **Vitest** (`tests/unit/*.test.ts`) for any pure logic this phase adds (e.g. the
     Phase 2 scheduler: ease/interval/repetitions, "wrong → +1d"). Test the function
     directly.
   - **Playwright** (`tests/e2e/*.spec.ts`) for the P0 paths that need a real
     session + DB: security, RLS/cross-user, quota, and the phase's core stateful
     flow. Reuse `tests/e2e/auth.setup.ts` sessions and `helpers.ts`. Clean up rows in
     `afterEach`. Remember: `newContext()` inherits auth unless you pass empty
     `storageState`; wait on the network response, not the optimistic DOM.
   - Get **all** of them green. If a test fails, **reproduce the claim independently
     (curl / a probe) before "fixing" the app** — in Phase 1 two "bugs" were the test
     lying, not the app. Log any genuine bug fixed in `memory.md`.
   - Note: E2E may need port juggling if 3001 is busy — run with `PW_PORT=<free port>`
     and your own clean dev server, as in Phase 1.

6. **Manual test-case doc (Rule 27 QA gate).** Write
   `tests/phase-<$1>-<feature>.md` — QA-lead-grade: happy + edge/negative/security/
   boundary/concurrency, each case `ID · area · precondition · steps · expected ·
   priority`, split into suites, with a report format. Cover what automation
   intentionally skips (feel/timing/theme/visual). Then **PAUSE and prompt the user to
   run the manual cases and report Pass/Fail.** Turn any Fail into a `memory.md` bug +
   fix, and re-run.

7. **Update the running docs** (as we go, not at the end):
   - `nextjs-tutorial.md` — any new Next.js concept used this phase (What / Why-as-a-
     React-dev / Where in Prep / Interview Q), grounded in the real file.
   - `interview.md` — fill the phase's subsystem deep-dive(s) + any new "why not X" /
     bug story — **only** with answers explainable cold.
   - `memory.md` — every non-obvious decision + every real bug fixed (dated).

8. **Commit + PR (only after build green + automated tests green; ask before the
   manual pass is in if the user wants to commit early).**
   - Branch first (never commit straight to `main`): `phase-<$1>-<name>`.
   - Verify **no secrets/artifacts staged** (`.env*`, `.auth/`, `.next/`,
     `node_modules`, `test-results`). Confirm gitignore covers them.
   - Commit with a detailed message ending in the `Co-Authored-By: Claude Opus 4.8`
     trailer. Push. `gh` isn't installed → give the user the PR "compare" URL + a
     ready-to-paste PR body (ending with the Claude Code generated-with line).

9. **Mark the phase done.** Update `phases.md` (✅ DONE + status line with test
   results) and the `CLAUDE.md` current-phase pointer once the QA gate is closed.

## Guardrails
- **Manual/console steps** (Supabase migrations, dashboard toggles, creating test
  users, provider keys) must be spelled out click-by-click, then **pause for
  confirmation** — never assume they were done.
- **Never** put real secrets in committed files. `.env.test` / `.auth/` stay
  gitignored.
- Keep it **explain-cold** (Rule 26): if a subsystem can't be explained without
  notes, slow down.
- Respect the **open questions** in memory.md — decide them deliberately with the
  user, don't silently pick.
- One phase per invocation. End demoable (Rule 24). Don't start the next phase.
