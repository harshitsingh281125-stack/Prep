# Tests — Prep

Two layers, split by what actually needs a browser + DB (QA-lead discipline: don't
E2E what a unit test proves faster).

| Layer | Runner | Covers | Files |
|-------|--------------|--------|-------|
| **Unit** | Vitest | Seed generator slice/reorder/pad/defaults (OB-08/09/10); recall scheduler ladder/ease/reset/DST; progress pace/status/attribution/trend; AI schema validation, cost/projection maths, gateway cap+retry+metering; **RAG grounding validator + retrieval query + `embed()`** | `tests/unit/*.test.ts` |
| **E2E** | Playwright | P0 security/RLS/mastery/cascade + recall grade round-trip + session logging + AI auth/ownership/fallback/`ai_usage` RLS + **both RAG branches and corpus RLS** (needs real session + DB) | `tests/e2e/*.spec.ts` |
| **Manual** | You | Feel/timing/theme/visual, multi-day scheduling, elapsed-time pace behaviour, **the real AI provider, and whether retrieval retrieves the RIGHT documents** | `tests/phase-<n>-*.md` |

Manual matrices, one per phase:
[phase-1-roadmaps.md](./phase-1-roadmaps.md) · [phase-2-recall.md](./phase-2-recall.md) ·
[phase-3-progress.md](./phase-3-progress.md) · [phase-4-ai-gateway.md](./phase-4-ai-gateway.md) ·
[phase-4.5-rag.md](./phase-4.5-rag.md).
The automated suites cover the highest-value subset; everything else stays manual.

**Current counts:** Vitest **210** (6 seed + 6 seed-detail + 19 answers + 18 scheduler
+ 53 progress + 25 ai-validate + 18 ai-cost + 20 ai-gateway + 16 ai-embed + 29 rag) ·
Playwright **64** (10 Phase 1 + 8 recall + 13 sessions + 20 AI + 13 RAG), all green as
of 2026-08-14.

### The E2E suite runs against the MOCK AI provider — read this before trusting it

`playwright.config.ts` starts the dev server with `AI_PROVIDER=mock` and
`AI_DAILY_CALL_CAP=500`. Three reasons, all learned in Phase 4:

1. **A suite that depends on a third party's uptime is not a test of your code.**
   Phase 4 opened with Gemini's free tier returning 429 for days (memory.md).
2. **The real cap is 25/day.** A full run makes well over 25 dispatches, so against a
   live provider the suite exhausts its own cap partway through and every later spec
   fails as "capped" rather than on its own merits.
3. Once billing is on, it costs money.

The mock still goes through the **entire** gateway — cap, validation, retry,
metering — so everything under test is ours. **What is therefore NEVER exercised
automatically: the real Gemini adapter** (wire format, token accounting, cache hits).
That is manual suite **LIVE** in `phase-4-ai-gateway.md`, and skipping it means the
provider integration has been tested by nobody.

**The suite runs on port 3101, not the dev port, and never reuses a server.** That is
a bug fix, not a preference: it previously defaulted to 3001 with
`reuseExistingServer: true`, so if you had `npm run dev` running, Playwright reused
**your** server — with your real API key — and `AI_PROVIDER=mock` never applied. It
spent **26 real Gemini calls** that way while reporting green (memory.md). Every spec
that generates now also calls `assertMockProvider()` in `beforeAll` and **refuses to
run** against a real provider. Override the port with `PW_PORT=<n>` if 3101 is taken.

`AI_MOCK_MODE=ok|malformed|malformed-once|error` injects failures, which is the only
practical way to reach the retry and seeded-fallback paths on demand.

### TWO servers now run, and the second one is the point (Phase 4.5)

`webServer` is an array: **3101** (default) and **3102**. They differ in exactly one
variable, `RAG_MIN_SIMILARITY`:

| Port | Project | Floor | What it makes reachable |
|------|---------|-------|-------------------------|
| 3101 | `chromium` | `-1` | every retrieval **hits** → the grounded branch |
| 3102 | `chromium-no-corpus` | `2` | nothing can clear it → the **empty-retrieval fallback** |

Why a whole second server rather than a flag: Next reads env only at startup, so one
process cannot serve both branches — and the fallback is the half of RAG that Rule 9
is actually about. The alternative was exposing the floor as a per-request parameter,
i.e. putting a knob in the product API purely so a test could turn it.

**Why the floor is overridden at all.** The corpus holds real Gemini vectors (written
by `npm run embed:corpus`), while the mock provider embeds **lexically** — two
different vector spaces, so every similarity between them is meaningless noise near
zero. Forcing the floor is what makes the pipeline testable without a live provider.
**What no automated test therefore claims: that the ranking is any good.** That is
`npm run probe:retrieval` plus manual suite RANK, and skipping them means retrieval
quality has been checked by nobody.

`PW_PORT=3105` shifts both (the second is always `PW_PORT + 1`).

### The RAG suites need the corpus to exist

`rag.spec.ts` calls `assertCorpusEmbedded()` in `beforeAll` and **refuses to run**
if `resources` has no embedded rows — because migrations `0007`/`0008` applied
without `npm run embed:corpus` produce a corpus that retrieves *nothing*, every
topic correctly falls back to ungrounded, and every grounding assertion fails with
"expected rag, got ai". That reads like a broken pipeline and is actually a setup
step nobody ran. Same reasoning as `generateCardsForFirstTopic` throwing rather than
returning 0.

### Harness gotchas that have bitten this suite (read before writing a spec)

All produced failures that *looked* like app bugs and weren't — see memory.md.

1. **`request.newContext()` inherits the project's `storageState`.** An "anonymous"
   request is only anonymous if you pass `storageState: { cookies: [], origins: [] }`.
2. **Playwright follows redirects by default.** When asserting something is *blocked*,
   pass `maxRedirects: 0` — otherwise it chases the gate's 307 to `/login`, which
   renders a 200 and makes a blocked request look like a success.
3. **`[attr!="x"]` is not valid CSS.** There is no `!=` attribute operator (that's
   XPath/jQuery); Playwright throws `SyntaxError` on it. Use `:not([attr="x"])`.
   Cost two red Phase 3 tests that had nothing to do with the app.
4. **`reuseExistingServer: true` will happily reuse a server started before your
   env vars existed.** Next.js reads env only at startup, so a config change can
   appear to do *nothing* while you edit it repeatedly. Phase 4 lost a cycle to
   this. Check what's actually listening (`ss -ltnp | grep 3001`) and kill it
   before concluding the config is wrong.
5. **A conditional `test.skip()` in a security test is a hole with a green tick on
   it.** Phase 4's four `ai_usage` RLS cases skipped silently for a run because they
   read the session from `localStorage` — but this app uses `@supabase/ssr`, whose
   session lives in **cookies** (chunked `sb-<ref>-auth-token.0/.1`, base64-encoded).
   The summary said "41 passed, 4 skipped" and looked fine. Prefer asserting the
   precondition over skipping on it.
6. **Never rebuild a URL, port or session the runner already owns — derive it.**
   `quota.spec.ts` QT-06 built `http://localhost:${process.env.PW_PORT ?? "3001"}`,
   but 3001 is the **dev** port and the test port has been 3101 since Phase 4. With
   `PW_PORT` unset it had been posting at whatever was listening on 3001 — so this
   security case passed for two phases by testing *the developer's* dev server, and
   only surfaced when the suite ran with no dev server up (`ECONNREFUSED`). Use the
   `baseURL` fixture; `request.newContext({ baseURL })` accepts it. Third instance of
   this exact shape in the project (see gotchas 1 and 4).
7. **Read the response shape before asserting on it.** Two Phase 4.5 specs asserted
   `body.summary.calls` from `/api/usage`, which returns `today` and `recent`. Cost
   a red run that had nothing to do with the feature.
8. **Never assert that a WINDOWED aggregate grows.** AI-16 asserted
   `allTime.calls` strictly increased after a generation. `/api/usage` aggregates at
   most `USAGE_WINDOW` (500) rows, so the moment qa-a crossed 500 lifetime
   dispatches the count pinned at 500 and the assertion became structurally
   unpassable — a test that could only ever go red from then on, for a reason
   unrelated to the code under test. It now asserts `usedToday`, which comes from an
   exact `COUNT`. (The field was also renamed `allTime` → `recent`, because the
   readout was labelling a capped window as a lifetime total.)

8. **Leftover rows from an ABORTED run look like a performance problem.** `afterEach`
   cleanup only runs for tests that finish. An interrupted run leaves roadmaps behind,
   the next run starts at the 3-roadmap quota, `generateRoadmap()` returns **403**, and
   the specs then time out waiting for cards and dashboard rows that were never
   created — which presented once as "the suite got 6x slower" (20.5 min, 7 red across
   three files, a different set each run). The `setup` project now clears each QA
   user's roadmaps after login, so an aborted run self-heals. If you see widespread
   timeouts, check for a `403` in the fixture message before profiling anything.

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

### 3. Make sure the migrations are applied + the corpus is embedded
- All migrations through **`0008_resources_seed.sql`** must be applied (the tables
  must exist): `0003_roadmaps.sql`, `0004_recall.sql`, `0005_study_sessions.sql`,
  `0006_ai_usage.sql`, `0007_resources.sql`, `0008_resources_seed.sql`.
- **Run `npm run embed:corpus` once** (needs `CORPUS_EMBED_USER_ID` and a real
  `GEMINI_API_KEY` in `.env.local`). This is the only setup step that needs a live
  provider — the suite itself does not. Without it the RAG specs refuse to run.
- No AI provider key is needed to *run* E2E — the suite uses the mock provider.
- Playwright starts its **own two servers** (3101 + 3102) and never reuses one.

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
- **`ai.spec.ts`** (Phase 4) — AI-01/02/03/04 (all four AI routes blocked when
  anonymous), AI-05/06/07/08 (unknown-topic 404 *before* any spend, `topicId`
  validation, User B blocked from generating against A's topic), AI-09/10/11/12
  (Rule 9: the flow completes whatever the AI does — roadmap always matches the
  user's contract, a topic starts empty and always ends with detail, detail persists
  across reload, repeat card generation doesn't duplicate), AI-13/14/15/16
  (`/api/usage` coherence, charged-vs-projected kept separate, the cap meter renders,
  a dispatch writes a usage row), AI-17/18/19/20 (**the security core**: the owner
  can read their `ai_usage` rows but can neither DELETE nor INSERT them, and B can't
  see A's spend — this is what stops the daily cap being self-resettable).
- **`rag.spec.ts`** (Phase 4.5, port 3101) — RAG-01…06 (a topic with corpus hits is
  grounded; **every returned URL exists in the corpus**; linked ⟺ verified, never
  both flags or neither; the UI shows VERIFIED chips + `rel=noopener` links; the
  retrieval embedding is metered as a second call; grounded detail survives a
  reload), RAG-07…10 (**the security core**: the corpus is publicly readable but
  no client can INSERT, DELETE or PATCH it — this is what stops an attacker choosing
  which links Prep vouches for).
- **`rag-fallback.spec.ts`** (Phase 4.5, port 3102) — RAG-11/12/13 (with retrieval
  guaranteed empty: the topic still gets full study material, its resources are
  flagged `unverified` and carry no link, and a missed retrieval spends exactly two
  calls rather than attempting a grounded completion against nothing).
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

> **Port note (updated Phase 4):** Playwright now starts its **own** server on
> **3101** and never reuses one, so you can leave `npm run dev` running on 3001 and
> the two won't interact. Only override if 3101 itself is taken:
> `PW_PORT=3105 npx playwright test` — no need to start a server yourself any more.
> *(Phases 2 and 3 predate this and were run by hand-starting a server on a free
> port; that workaround is what the current config makes unnecessary.)*

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
