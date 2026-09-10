# Rules — Prep

> Engineering + product rules that hold across the whole build. These are the
> "don't violate these" invariants. Companion: [PRD.md](./PRD.md) ·
> [Architecture.md](./Architecture.md) · [phases.md](./phases.md).

---

## 1. Security & cost (non-negotiable, from commit 1)

1. **No unauthenticated AI route.** Every AI call goes through an auth-gated
   server route that verifies the Supabase session first.
2. **The AI provider key never reaches the browser.** Server-only. The client
   gets the Supabase *anon* key only.
3. **Hard per-user daily AI call caps**, enforced server-side against `ai_usage`,
   checked *before* dispatching a call.
4. **A provider spend alert/cap** is configured in the console before any real
   model is wired to real traffic.
5. **RLS on every table.** A user can only ever read/write rows where
   `user_id = auth.uid()`. No table ships without a policy. **One deliberate
   exception, and it is narrower than this rule originally claimed:** the global
   `resources` corpus (Phase 4.5 RAG) holds shared vetted references, not user data,
   so its read predicate is `true` rather than `user_id = auth.uid()`. It is the only
   table **without a `user_id` predicate** — *not* a table without RLS. That
   distinction is the whole point: on Supabase every `public` table is granted
   select/insert/update/delete to `anon`/`authenticated` by default and **RLS is what
   narrows those grants**, so shipping this table with RLS *disabled* — as this rule
   said until 2026-08-13 — would have made the vetted corpus **world-writable with
   the anon key**. As built: RLS enabled, `for select using (true)`, and no write
   policy at all, so writes are denied to every client and curation happens through
   migrations and the service role. See memory.md.
6. **Service-role key is server-only.** Never imported into a client component.

## 2. AI usage rules

7. **Product code depends on the AI Gateway interface, never a vendor SDK.**
   Model/provider is a config binding, not code scattered through features. This is
   why **no LangChain / LangGraph**: a single tiered `complete()` + `embed()` +
   pgvector query is fully owned; a framework would re-introduce the exact vendor-SDK
   spread this rule exists to prevent, and Prep has no agent loop for LangGraph to run.
8. **Tiers, not model names, in product code** (`reasoning` | `classification`).
9. **Every structured generation is schema-validated** with a retry-on-malformed
   path, then a **seeded-template fallback**. AI must **never hard-block** a user
   flow — the app stays usable with AI fully off.
   **Sharpened 2026-08-27 (Phase 5): "never blocks" is not "never tell them".**
   A fallback the user cannot see is the failure mode this rule is really guarding
   against, because it is the one that ships a wrong answer wearing a right answer's
   clothes. The test case that forced this: the seeded catalog is a *frontend*
   curriculum, so once `SDE-2 · Backend` existed, a failed generation would have
   handed that user a frontend plan and called it their plan — Rule 9 satisfied to
   the letter and broken in spirit. So a fallback whose content is materially wrong
   for what the user asked must be **labelled, durably** (persisted on the row, not
   announced once in a response the UI forgets). See `roadmaps.generated_from`,
   `templateMismatch()`, Architecture §5c.
10. **Prompt caching** on fixed system/rubric scaffolding wherever the provider
    supports it.
11. **Every AI call writes an `ai_usage` row** (route, model, tokens, cost) —
    including `embed()` calls for RAG, not just completions.

## 3. Data & DB rules

12. **Write the SQL yourself.** No ORM that hides the schema — DB fluency is a
    goal of this project. Migrations are plain SQL, checked into the repo.
13. **"Reviews due today" is served by the `(user_id, due_at)` index.** Don't
    regress it into a full scan; be able to explain the query plan.
14. **The scheduling algorithm is implemented by hand**, not pulled from a
    library. It must be derivable from scratch, no notes.
15. Timestamps are `timestamptz`. Due-date math is done in UTC on the server.

## 4. Product-integrity rules

16. **Mastery is earned:** a topic becomes `mastered` only when its kill
    criterion is explicitly checked. No auto-mastery.
17. **Recall honesty:** "close enough" is a **miss**. A miss resets the card to
    the shortest interval (+1d). Never soften this.
18. **Quota is real:** free plan = 3 roadmap creations; creating/regenerating is
    disabled at the limit (enforced server-side, not just hidden in UI).
19. **No vanity metrics as headline.** Streaks may appear but are de-emphasized;
    the headline signal is honest pace-vs-plan, including "behind pace."

## 5. Design-fidelity rules

20. **The pasted design (`Prep.dc.html`) is the source of truth for UI.** Tokens,
    spacing, and screen structure come from it — see [design.md](./design.md).
21. **Light + dark both ship.** Every color goes through an OKLCH token; no raw
    hex in components (the print view is the one allowed exception).
    *Exercised in Phase 5:* `app/(print)/print.css` is the only raw-hex surface and
    the only stylesheet — print colour management is not the screen pipeline and
    paper has one theme, and `@page`/`break-inside` have no inline form. The one
    other literal-colour file is `app/global-error.tsx`, which is not an exception
    so much as the boundary condition this rule assumes: it renders when the root
    layout (and therefore `globals.css`, and therefore the token layer) has failed.
22. **Charts are hand-rolled SVG** for v1 — no charting dependency.

## 6. Process rules

23. **Keep a decisions + bugs log** while building (one file, append-only). Every
    non-obvious decision and every real bug fixed gets a line — this is the raw
    material for the interview stories in the PRD checklist.
24. **Each phase in [phases.md](./phases.md) ships something demoable** before the
    next begins. No half-built horizontal slices.
25. **This is a side-track.** It must not eat weekday DSA/machine-coding hours
    from the main prep plan. Scope down before burning out.
26. **Every subsystem must be explainable cold** — if a piece can't be explained
    without notes, slow down before moving on (recognition ≠ recall).
27. **QA gate after every feature.** When a feature/subsystem is code-complete, before
    it's called "done" I write a **test-case doc** in [tests/](./tests/) — happy paths
    **and** edge/negative/security cases, written to a QA-lead bar (boundary values,
    RLS/quota bypass attempts, concurrency, malformed input, empty/loading/error states).
    Each case has: ID · area · precondition · steps · expected · priority. I then **pause
    and prompt the user to run them manually** and report Pass/Fail. Fails become bug-log
    entries (Rule 23) and are fixed before the phase is marked demoable (Rule 24). No
    phase advances on untested code. Test docs live in `tests/phase-<n>-<feature>.md`.
