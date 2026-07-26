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
   `user_id = auth.uid()`. No table ships without a policy.
6. **Service-role key is server-only.** Never imported into a client component.

## 2. AI usage rules

7. **Product code depends on the AI Gateway interface, never a vendor SDK.**
   Model/provider is a config binding, not code scattered through features.
8. **Tiers, not model names, in product code** (`reasoning` | `classification`).
9. **Every structured generation is schema-validated** with a retry-on-malformed
   path, then a **seeded-template fallback**. AI must **never hard-block** a user
   flow — the app stays usable with AI fully off.
10. **Prompt caching** on fixed system/rubric scaffolding wherever the provider
    supports it.
11. **Every AI call writes an `ai_usage` row** (route, model, tokens, cost).

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
