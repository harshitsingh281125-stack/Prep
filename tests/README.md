# Tests — Prep

Two layers, split by what actually needs a browser + DB (QA-lead discipline: don't
E2E what a unit test proves faster).

| Layer | Runner | Covers | Files |
|-------|--------|--------|-------|
| **Unit** | Vitest | Seed generator slice/reorder/pad/defaults (OB-08/09/10) | `tests/unit/*.test.ts` |
| **E2E** | Playwright | P0 security/RLS/mastery/cascade (needs real session + DB) | `tests/e2e/*.spec.ts` |
| **Manual** | You | Feel/timing/theme (OB-03, TP-08, CC-02, visual) | `tests/phase-1-roadmaps.md` |

The full manual test matrix is [phase-1-roadmaps.md](./phase-1-roadmaps.md). The
automated suites cover the highest-value subset of it; everything else stays manual.

---

## Unit tests (no setup — just run)

```bash
npm run test:unit          # once
npm run test:unit:watch    # watch mode
```
Pure functions only (the seed generator). No DB, no browser, no env needed.

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

### 3. Make sure the migration is applied + dev server can run
- `0003_roadmaps.sql` must be applied (the tables must exist).
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

Each spec **cleans up the roadmaps it creates** (afterEach), so the shared project's
quota resets and rows don't accumulate.

---

## Version pin (important)

`@playwright/test` is pinned to **1.47.2** via `overrides` in `package.json` because
this machine runs **Node 18.19.1** and Playwright ≥ 1.48 requires **Node ≥ 20** (the
runner refuses to start otherwise). Same constraint as the Next.js 15 pin. When Node
is upgraded to 20+, the override can be removed to move to current Playwright.

---

## Reporting a manual pass

For the cases that stay manual (see [phase-1-roadmaps.md](./phase-1-roadmaps.md) §
report format), run them and reply with `ID Pass` / `ID FAIL — actual vs expected`.
Fails get logged in [../memory.md](../memory.md) as bugs and fixed before the phase is
marked demoable (Rule 24/27).
