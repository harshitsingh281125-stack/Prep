# Tests — Prep

Two layers, split by what actually needs a browser + DB (QA-lead discipline: don't
E2E what a unit test proves faster).

| Layer | Runner | Covers | Files |
|-------|--------|--------|-------|
| **Unit** | Vitest | Seed generator slice/reorder/pad/defaults (OB-08/09/10); recall scheduler ladder/ease/reset/DST; progress pace/status/attribution/trend | `tests/unit/*.test.ts` |
| **E2E** | Playwright | P0 security/RLS/mastery/cascade + recall grade round-trip + session logging (needs real session + DB) | `tests/e2e/*.spec.ts` |
| **Manual** | You | Feel/timing/theme/visual, multi-day scheduling, and elapsed-time pace behaviour | `tests/phase-<n>-*.md` |

Manual matrices, one per phase:
[phase-1-roadmaps.md](./phase-1-roadmaps.md) · [phase-2-recall.md](./phase-2-recall.md) ·
[phase-3-progress.md](./phase-3-progress.md).
The automated suites cover the highest-value subset; everything else stays manual.

**Current counts:** Vitest **77** (6 seed + 18 scheduler + 53 progress) · Playwright
**31** (10 Phase 1 + 8 recall + 13 sessions), all green as of 2026-08-08.

### Three harness gotchas that have bitten this suite (read before writing a spec)

All produced failures that *looked* like app bugs and weren't — see memory.md.

1. **`request.newContext()` inherits the project's `storageState`.** An "anonymous"
   request is only anonymous if you pass `storageState: { cookies: [], origins: [] }`.
2. **Playwright follows redirects by default.** When asserting something is *blocked*,
   pass `maxRedirects: 0` — otherwise it chases the gate's 307 to `/login`, which
   renders a 200 and makes a blocked request look like a success.
3. **`[attr!="x"]` is not valid CSS.** There is no `!=` attribute operator (that's
   XPath/jQuery); Playwright throws `SyntaxError` on it. Use `:not([attr="x"])`.
   Cost two red Phase 3 tests that had nothing to do with the app.

Corollary: **when a test claims the app is broken, reproduce it outside the harness
(curl / a probe / `node -e`) before changing app code.** Four of this project's red
suites were the test lying. Also note fixtures should assert their own preconditions —
a quota-full `403` from roadmap generation otherwise surfaces as a misleading "no cards
rendered". *(The reverse also holds: Phase 3's genuine float-boundary bug was confirmed
with a bare `node -e` **before** the fix — the same discipline catches real bugs, not
just false alarms.)*

---

## Unit tests (no setup — just run)

```bash
npm run test:unit          # once
npm run test:unit:watch    # watch mode
```
Pure functions only — the seed generator (`lib/seed/generate.ts`), the recall
scheduler (`lib/recall/scheduler.ts`), and the progress aggregation
(`lib/progress/compute.ts`). No DB, no browser, no env needed. The scheduler and the
progress functions both take `now` as an argument precisely so their date math is
assertable here rather than needing a real clock — which is also what let the Phase 3
0.8-threshold float bug be caught by a test instead of by a user.

---

## E2E tests — one-time setup

E2E runs against your **real dev server + real Supabase project**, signed in as two
dedicated test users. Do this once:

### 1. Create two test users in Supabase
These are real accounts (email/password) in your Supabase project:
1. Go to **https://supabase.com/dashboard** → your **Prep** project.
2. Left sidebar → **Authentication** → **Users** → **Add user** → **Create new user**.
3. Create **User A**: email `qa-a@yourdomain.com` (any email you control or a
   plus-alias), a strong password. **Check "Auto Confirm User"** so no email
   confirmation is needed.
4. Repeat for **User B**: `qa-b@yourdomain.com`, different password, auto-confirmed.

> Why two: the RLS suite (`rls.spec.ts`) proves User B **cannot** see or delete User
> A's roadmaps. That needs two distinct accounts.

### 2. Put their creds in `.env.test`
```bash
cp .env.test.example .env.test
```
Edit `.env.test` and fill in the four values (`QA_A_EMAIL`, `QA_A_PASSWORD`,
`QA_B_EMAIL`, `QA_B_PASSWORD`). **`.env.test` is gitignored — never commit it.**

### 3. Make sure the migrations are applied + dev server can run
- All migrations through **`0005_study_sessions.sql`** must be applied (the tables must
  exist): `0003_roadmaps.sql`, `0004_recall.sql`, `0005_study_sessions.sql`.
- Playwright will auto-start `npm run dev` on port 3001 if one isn't already running
  (it reuses an existing server if you have one up).

---

## Running E2E

```bash
npm run test:e2e           # headless, all specs
npm run test:e2e:ui        # interactive UI mode (great for debugging a failure)
npx playwright show-report # open the HTML report after a run
```

First run does the **auth setup** (logs in A & B, saves their sessions to
`tests/e2e/.auth/` — also gitignored). Later runs reuse those sessions until they
expire, then re-run setup.

### Everything at once
```bash
npm test                   # unit, then E2E
```

---

## What the E2E specs assert (mapped to the manual matrix)

- **`quota.spec.ts`** — QT-04 (403 at cap via direct API), QT-06 (401 signed out),
  QT-07 (400 malformed), QT-08 (400 invalid weak areas), QT-01/OB-11 (≤ cap succeed,
  beyond 403s). *The security core: proves the quota is server-enforced, not UI-hidden.*
- **`rls.spec.ts`** — RLS-01/02/03 (User B gets 404 on A's roadmap + topic; B's DELETE
  affects none of A's rows; A's roadmap survives).
- **`study-flow.spec.ts`** — TP-03/05/06 (kill-criterion check → mastered, persists
  across reload, roadmap count reflects it), CC-03 (delete → 404, gone from Library).
- **`recall.spec.ts`** — RC-01/02/03 (anon blocked, non-binary grade rejected, unknown
  card 404), RC-04/05/06 (grade round-trip, miss resets to +1d, session accuracy),
  RC-07/08 (RLS: B can't grade or see A's cards).
- **`sessions.spec.ts`** (Phase 3) — SE-01/02/03/04/05 (anon blocked; `minutes`
  boundary validation incl. 0/-30/1441/45.5/NaN/`"60"`/null and the accepted 1 & 1440;
  missing roadmapId 400; unknown roadmap 404), SE-06/07/08 (log → dashboard stats move;
  the form path persists across reload; unattributed hours count but fill no bar),
  SE-09/10/11 (cross-roadmap topic rejected; B can't log against A's roadmap;
  client-supplied `logged_at` ignored), SE-12/13 (fresh roadmap shows no banner;
  accuracy empty state). *The integrity core: proves session rows can't be forged,
  misattributed, or backdated.*

Each spec **cleans up the roadmaps it creates** (afterEach), so the shared project's
quota resets and rows don't accumulate. Deleting a roadmap cascades its
`study_sessions` and `recall_cards` away, which is what resets the dashboard between
tests.

> **Port note:** if 3001 is busy with a server you don't control, run your own on a
> free port and point Playwright at it: `PW_PORT=3005 npx playwright test` (start
> `npx next dev -p 3005` first). Phase 2 and Phase 3 were both run this way.

---

## Version pin (important)

`@playwright/test` is pinned to **1.47.2** via `overrides` in `package.json` because
this machine runs **Node 18.19.1** and Playwright ≥ 1.48 requires **Node ≥ 20** (the
runner refuses to start otherwise). Same constraint as the Next.js 15 pin. When Node
is upgraded to 20+, the override can be removed to move to current Playwright.

---

## Reporting a manual pass

For the cases that stay manual (see the current phase's matrix — its § report format),
run them and reply with `ID Pass` / `ID FAIL — actual vs expected`.
Fails get logged in [../memory.md](../memory.md) as bugs and fixed before the phase is
marked demoable (Rule 24/27).
