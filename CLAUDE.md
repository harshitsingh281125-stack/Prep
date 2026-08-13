# CLAUDE.md — Prep

Project config auto-loaded by Claude Code every session. This is the file that
kills the "re-paste context every time" workflow (the same problem Prep itself
solves). Keep it lean and current.

## What this project is

**Prep** — an AI-native learning OS for technical interview prep: structured
roadmaps, persistent per-topic notes, spaced-repetition recall on a real
scheduling algorithm, and an honest progress dashboard.

Full context lives in these docs — **read them before non-trivial work**:
- [PRD.md](./PRD.md) — product spec, screens, journeys, success metrics
- [Architecture.md](./Architecture.md) — stack, routes, DB schema, AI Gateway
- [design.md](./design.md) — visual system + tokens (UI source of truth)
- [phases.md](./phases.md) — build order (we ship phase by phase)
- [Rules.md](./Rules.md) — hard invariants (**these are non-negotiable**)
- [memory.md](./memory.md) — decisions + bugs log (append as we go)
- [interview.md](./interview.md) — resume bullets + interviewer Q&A (**this is a
  resume project** — update as subsystems get built)
- [nextjs-tutorial.md](./nextjs-tutorial.md) — running Next.js concept doc, grounded
  in Prep's actual files (**the user knows React, not Next.js** — this is how they'll
  answer Next.js interview questions; keep it current as new concepts get used)

## Stack

- **Frontend/server:** Next.js (App Router) + TypeScript
- **DB + Auth:** Supabase (Postgres + Auth + RLS). **Write raw SQL** — no ORM that
  hides the schema (DB fluency is a project goal).
- **AI:** provider-agnostic **AI Gateway** (`lib/ai/gateway.ts`). Product code calls
  `complete({ tier: 'reasoning' | 'classification', … })` — never a vendor SDK.
  **v1 = Google Gemini (settled 2026-07-28, live since Phase 4)**, bound in
  `lib/ai/config.ts` — the only file naming a model.
- **Hosting:** Vercel.

## Non-negotiable rules (see Rules.md for the full 27)

- **No unauthenticated AI route.** AI key is server-only; never reaches the browser.
- **Hard per-user daily AI caps**, enforced server-side before dispatch.
- **RLS on every table** (`user_id = auth.uid()`); every table ships with a policy.
- **Schema-validate every AI generation** + retry-on-malformed + seeded-template
  fallback. **AI must never hard-block a flow.**
- **Tiers, not model names**, in product code. All AI via the Gateway interface.
- **Mastery is earned** (kill-criterion check); **"close enough" recall = a miss**;
  **quota = 3 roadmaps**, enforced server-side.
- **Both light + dark themes**; all colors via OKLCH tokens (no raw hex in
  components — print view is the one exception).
- **Charts are hand-rolled SVG** — no charting library.
- **Animation: CSS first; Framer Motion (`motion`) is the only sanctioned JS
  animation dep**, used surgically. No UI/animation component libraries (no
  Animate UI / Inspira / Lenis) — see design.md §9.

## Working conventions

- **Spell out every manual step the user must do.** Anything that can't be done
  from code — creating a Supabase project, generating an API key/access token,
  clicking through a provider dashboard, setting OAuth redirect URLs, configuring
  a spend cap, enabling a login provider, adding env vars to Vercel — must be given
  as **explicit numbered click-by-click instructions**, telling them exactly where
  to go and what to copy. Then **pause and wait for confirmation** before continuing.
  Never assume a manual/console step was silently done, and never skip past one.
  The user is newer to this infra — err toward more detail, not less.


- **Ship phase by phase** (phases.md). Each phase ends demoable; no half-built
  horizontal slices. **Phases 0, 1, 2, 3 and 4 are DONE** (Phase 1 QA-gate closed
  2026-07-31; Phase 2 closed 2026-08-08 — Vitest 24/24, E2E 18/18, full manual pass;
  Phase 3 closed 2026-08-08 — Vitest 77/77, E2E 31/31, full manual pass incl. the
  Table-Editor elapsed-time cases; Phase 4 closed 2026-08-12 — Vitest 165/165,
  E2E 51/51, full manual pass all 76 cases incl. the cap/fallback env-injection
  suites); **next up is Phase 4.5 (RAG — grounding topic resources on a curated
  corpus)**.
- **AI is live.** All generation goes through `lib/ai/gateway.ts`; `lib/ai/config.ts`
  is the only file naming a model (`gemini-3.5-flash` / `gemini-3.5-flash-lite`).
  Daily cap 25/user (`AI_DAILY_CALL_CAP` overrides). **`AI_PROVIDER=mock` gives a
  deterministic offline provider** with `AI_MOCK_MODE=ok|malformed|malformed-once|error`
  for exercising the Rule 9 paths — the E2E suite runs on it, on port 3101.
  Next.js reads env only at startup: **restart the dev server after any change.**
- **QA gate after every feature (Rule 27).** When a feature is code-complete, write a
  test-case doc in `tests/phase-<n>-<feature>.md` **before** calling it done —
  QA-lead-grade coverage (happy path + edge/negative/security/boundary/concurrency),
  each case as ID · area · precondition · steps · expected · priority. Then **pause and
  prompt the user to run them manually** and report Pass/Fail. Log fails as bugs
  (memory.md) and fix before the phase is marked demoable. Don't advance on untested code.
- **Log as we go:** append non-obvious decisions and every real bug fixed to
  [memory.md](./memory.md) — that's the raw material for interview stories.
- **Design fidelity:** tokens/spacing/components come from `Prep.dc.html` via
  design.md. Match it; don't improvise the look.
- **Explain-cold test:** if a subsystem can't be explained without notes, slow
  down before moving on (recognition ≠ recall).
- **Update [interview.md](./interview.md) when a subsystem lands.** When we finish
  a real piece (schema, scheduler, gateway, a bug fix), fill in its deep-dive /
  "why not X" / bug-story section — but only with answers that can be explained
  cold. No speculative answers for things not yet built.
- **Update [nextjs-tutorial.md](./nextjs-tutorial.md) whenever we use a new Next.js
  concept.** The user knows React but not Next.js and needs to defend this project in
  interviews. When a phase introduces a Next.js feature not yet in the doc (dynamic
  `[id]` routes, `loading.tsx`, `error.tsx`, data-fetching/caching, `generateMetadata`,
  streaming, etc.), add a section in the same format (**What / Why-as-a-React-dev /
  Where in Prep / Interview Q**), always grounded in the real file we just wrote. Only
  document concepts actually used in the code — no speculative theory.
- Prefer raw SQL migrations checked into the repo over ad-hoc schema changes.

## How to write code here (coding discipline)

Adapted from Karpathy's critique of how LLMs write code badly. These apply to
every change, on top of the project rules above.

- **Think before coding.** Don't act on silent assumptions. If a requirement,
  file, or API shape is unclear, check the docs/schema or ask — a wrong guess
  that compiles is worse than a question. State assumptions you couldn't verify.
- **Simplicity first.** Write the smallest thing that solves the actual request.
  100 lines beats a 1000-line "flexible" construction. No speculative features,
  no abstractions for a second use case that doesn't exist yet. (The MVP already
  cut the sandbox for this reason — hold the line at the code level too.)
- **Surgical changes.** Edit only what the request needs. No drive-by refactors,
  renames, reformatting, or "while I'm here" cleanups mixed into a feature change.
  If something unrelated looks worth fixing, flag it separately.
- **Goal-driven execution.** Turn a task into a verifiable success criterion
  (a test passing, a route returning the right shape, a query using the right
  index), then work until that's actually met — don't stop at "looks done."

If a change is growing past ~a screen of code or spilling into unrelated files,
stop and reconsider the approach before continuing.

## Commands

- `npm run dev` — local dev server (http://localhost:3000).
- `npm run build` — production build (also runs typecheck + lint; must pass clean).
- `npm run start` — serve the production build.
- `npm run lint` — ESLint (next/core-web-vitals).

**Runtime note:** pinned to **Next.js 15** because Node here is **18.19.1** (Next 16
needs Node ≥20). Don't bump to Next 16 until Node is upgraded. (See memory.md.)

_(Supabase migration + CLI commands: added in Phase 0 Stage B.)_

## Secrets (never commit)

Server-only: `SUPABASE_SERVICE_ROLE_KEY`, the AI provider key.
Client-safe: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Real values live in `.env.local` (gitignored). `.env.example` is the committed
template (placeholders only). `.mcp.json` is committed but references
`${SUPABASE_PROJECT_REF}` / `${SUPABASE_ACCESS_TOKEN}` — no real values in it.

**Supabase MCP server:** it reads `SUPABASE_PROJECT_REF` + `SUPABASE_ACCESS_TOKEN`
from the shell Claude Code is *launched* in (not from `.env.local`). To use MCP:
`export $(grep -E 'SUPABASE_(PROJECT_REF|ACCESS_TOKEN)' .env.local | xargs)` then
start Claude Code from that shell. (It's `--read-only`; DDL still goes via the SQL
Editor / Supabase CLI.)
