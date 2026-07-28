# Memory — Prep (decisions + bugs log)

> Append-only working log (Rule 23). Every non-obvious **decision** and every real
> **bug fixed** gets a dated line. This is the raw material for the interview
> stories in the [PRD.md](./PRD.md) defensibility checklist — "one real bug I hit
> and fixed" needs a specific entry here, not a vague memory.
>
> Format: newest at the top of each section. Date · what · **why** (the why is the
> part that matters for interviews).

---

## Settled decisions (don't re-litigate)

- **2026-07-25 · Pinned Next.js 15 (15.5.21), not 16 — Node version constraint.**
  Latest Next is 16.x but it requires **Node ≥20**; this machine runs **Node 18.19.1**,
  so Next 16 would fail to run. Pinned to the newest *patched* 15.x (15.5.21) — the
  scaffold's initial 15.5.4 carries CVE-2025-66478, fixed in later 15.5.x. Why it
  matters: staying on 15 is a deliberate compat choice, not laziness; revisit when
  Node is upgraded to 20 (then Next 16 unlocks). Remaining `npm audit` "16 high"
  findings are transitive **sharp/libvips** image-CVEs inside Next's optional image
  optimizer — `audit fix` only "resolves" them by downgrading Next to 9.x (a
  breaking non-fix), so left as-is and documented rather than pseudo-fixed.

- **2026-07-25 · Auth via `@supabase/ssr`, not the deprecated auth-helpers.**
  `@supabase/auth-helpers-nextjs` is deprecated; the current cookie-based SSR
  pattern is `@supabase/ssr` (browser client + server client + middleware session
  refresh). Decided at Phase 0 so the auth foundation isn't built on a dead package.
  (Wired in Stage C.)

- **2026-07-25 · Phase 0 shell built to design fidelity from the real source file.**
  The design source is `Prep - Interview Prep OS.html` (a designcode/Vue bundle,
  not the `Prep.dc.html` the docs name). Extracted the exact OKLCH token blocks +
  scrollbar CSS (verified identical to design.md), the 244px sidebar markup, nav
  `navStyle()` (active = elevated bg + border + 600 weight), header (screenTitle
  16/600/-0.01em + subtitle), the auth card, and the Library dashed empty state —
  reproduced as React with inline styles + CSS-var tokens (no raw hex, Rule 21).
  App uses inline styles like the source (no Tailwind), fonts via `@import` so the
  design's `font-family:'IBM Plex Mono'` inline styles resolve. Nav trimmed to the
  routes that exist in Phase 0 (My roadmaps→/library, Recall, Progress); Roadmap/
  Study are per-roadmap context, added later. Why: Rule 20 — match the source, don't
  improvise the look — and keep the frame reusable for every later screen.

- **2026-07-25 · Animation: Framer Motion only, added surgically. No UI libs.**
  Evaluated Inspira UI, Animate UI, Lenis. **Inspira** — Vue/Nuxt only, can't use.
  **Animate UI** — rejected: would force Tailwind + Motion + Radix + shadcn design
  system onto our hand-rolled OKLCH/inline-style design; too much to adopt/maintain/
  defend for a dashboard. **Lenis** — rejected: smooth-scroll momentum hurts precise
  navigation in a data-dense app. **Adopted:** CSS transitions by default (already in
  the design), plus **Framer Motion (`motion`)** as the single sanctioned JS animation
  dep, used only where physics helps (checkbox→mastery, accordions, card reveal).
  Policy written in design.md §9. Why: Prep is a productivity dashboard, not a
  landing page — restrained/functional motion fits the "no fluff" voice and avoids
  a dependency stack that works against Rule 25 + the "simplicity first" principle.

- **2026-07-25 · AI-coding scaffolding: lean, not framework.**
  Evaluated two repos. `affaan-m/ecc` (heavyweight 300+ file agent-harness system:
  67 subagents, 260 skills, hooks, scanner) — **rejected** as scale-mismatched for
  a solo side-track (would violate Rule 25). `multica-ai/andrej-karpathy-skills`
  (a single CLAUDE.md of 4 coding-discipline principles) — **adopted** by folding
  its principles into our own `CLAUDE.md` ("How to write code here" section),
  not as a plugin. Kept scaffolding to: CLAUDE.md, .claude/settings.json,
  .mcp.json (Supabase, read-only), .gitignore.
  Why: the useful part of "seamless coding" is auto-loaded context + a few
  guardrails, not a second system to maintain alongside the app.

- **2026-07-24 · Stack: Next.js (App Router) + Supabase + Vercel.**
  Why: Next's server layer keeps the AI key off the browser, enforces per-user
  daily caps, and validates generated JSON server-side — the auth-gated-AI
  requirement. Supabase gives Postgres (write raw SQL — DB is a stated skill gap),
  Auth (email + Google), and RLS. Chose Next.js over plain-React/Vite specifically
  for that server layer.

- **2026-07-24 · AI is integrated in v1, but the model/provider is an open decision.**
  Why: the *pick* (free/cheap vs Claude API) is deferred to a brainstorm, but the
  *architecture* is not. Everything routes through a provider-agnostic **AI Gateway**
  (`complete({ tier, … })`), so swapping models is a config change, not a rewrite.
  The model brainstorm lands in **Phase 4** of [phases.md](./phases.md).

- **2026-07-24 · Seeded content is the AI fallback + local-dev provider.**
  Why: the `weeksData` / `topicDetail` / `recallData` already in `Prep.dc.html`
  become the schema-valid fallback, so the whole app is usable before any real
  model is wired — and AI can never hard-block a user flow (Rule 9).

- **2026-07-24 · Five planning docs created** (PRD, Architecture, Rules, phases,
  design) from the pasted design source + `project-context.md`. Design tokens
  extracted verbatim from `Prep.dc.html`.

## Open questions (decide deliberately)

- **[Phase 4] v1 model/provider per tier** — the AI brainstorm. Cheapest option
  that clears the roadmap-JSON quality bar; verify free-tier limits + a spend cap.
- **Scheduling algorithm cadence** — the design uses a fixed **+1/+4/+14/+30**
  cadence, which is *not* literally SM-2 (SM-2 derives intervals from an ease
  factor). Decide: pure SM-2, or the fixed cadence with a justification. Matters
  because "explain the algorithm from scratch, no notes" is on the interview
  checklist — pick the one you can actually derive live.
- Roadmap JSON schema final shape (fields the generator must return).
- Onboarding question wording / weak-area taxonomy.
- Product name (still "Prep", a placeholder).
- When to revisit the v2 code-sandbox cut.

## Bugs hit + fixed

- **2026-07-26 · SECURITY DEFINER signup function was callable by clients via RPC.**
  Symptom: after applying `0001_profiles.sql`, Supabase security advisors flagged
  `handle_new_user()` as executable by `anon` + `authenticated` through
  `/rest/v1/rpc/handle_new_user`, plus a mutable `search_path` on `set_updated_at()`.
  Root cause: (a) Postgres grants EXECUTE on functions to `public` by default, and a
  SECURITY DEFINER function inherits the owner's rights — so any client could invoke
  the profile-insert routine directly, not just the signup trigger; (b) I set
  `search_path` on `handle_new_user` but forgot it on `set_updated_at`, leaving it
  resolvable against a caller-controlled schema. Fix (`0002_harden_functions.sql`):
  `revoke execute ... from public/anon/authenticated` (the trigger still fires as
  owner), and pin `set search_path = public` on `set_updated_at`. Advisors then
  clean. Why it happened: didn't account for Postgres's default-grant + SECURITY
  DEFINER interaction. Lesson: **run `get_advisors` after every DDL change** — this
  is exactly the class of hole it catches. Good interview story for "a security bug
  I found and fixed."

- **2026-07-26 · Supabase Management API blocks DDL over HTTP (Cloudflare 1010).**
  `POST /v1/projects/{ref}/database/query` runs SELECTs fine and even a trivial
  `create temp table`, but rejects `create or replace function` / `revoke` / `$$`
  bodies with 403 "error code 1010" (WAF pattern-match on "dangerous" SQL). Not a
  perms issue. Consequence: migrations go through the **SQL Editor** (or Supabase
  CLI later), not the HTTP query endpoint. The endpoint is still fine for read-only
  verification (table/column/RLS/policy introspection), which is how Phase 0 was
  checked. Also note the Supabase **MCP server is read-only AND needs
  `SUPABASE_ACCESS_TOKEN` in Claude Code's launch shell** — `.env.local` doesn't
  reach it (that's only Next.js runtime), so MCP stayed unauthorized; verification
  was done via direct Management API calls instead.

## Deploy / infra facts

- **2026-07-27 · Phase 0 shipped to Vercel.** Repo:
  github.com/harshitsingh281125-stack/Prep (personal account; pushed over HTTPS with
  a repo-scoped fine-grained PAT via a one-off token URL so nothing landed in
  `.git/config` — the machine also has a work GitHub identity, so origin is stored
  clean with no creds). Live: prep-seven-theta.vercel.app. Vercel env vars =
  the 3 app vars only (URL, anon, service_role) — NOT the MCP token/ref. Supabase
  Auth URL config: Site URL = the Vercel URL; Redirect URLs include both
  `https://prep-seven-theta.vercel.app/**` and `http://localhost:3000/**`. Prod
  signup + profiles trigger + auth gate all verified against the live origin.

## Bugs hit + fixed (continued)

- **2026-07-28 · Google OAuth redirected to prod /login (with ?code=) instead of
  /auth/callback — dev port not in Supabase's redirect allow-list.**
  Symptom: clicking "Continue with Google" on localhost:3100 → Google consent → landed
  back on `https://prep-seven-theta.vercel.app/login?code=...`, stuck (user created in
  Supabase, but no session). Root cause: the browser sent `redirectTo=
  http://localhost:3100/auth/callback`, but the Supabase **Redirect URLs** allow-list
  only had `http://localhost:3000/**` (wrong port). Supabase rejects a non-allow-listed
  `redirect_to` and **falls back to the Site URL** (the Vercel origin) at its default
  path — so the `code` hit `/login`, which has no exchange logic (only `/auth/callback`
  does). Fix: add `http://localhost:3100/**` to the allow-list. Lesson: every origin
  *and port* you start an OAuth flow from must be in Supabase's redirect allow-list;
  otherwise it silently falls back to Site URL. Good "config bug that looked like a
  code bug" interview story.

## Verified subsystems (explain-cold ready)

- **2026-07-28 · Google OAuth (Stage C) — verified end-to-end.**
  Browser Supabase client `signInWithOAuth({provider:'google', redirectTo:
  '/auth/callback'})` → Google consent → `/auth/callback` route handler
  `exchangeCodeForSession` → session cookie → `/library`. Signup trigger fires for
  OAuth too (profile auto-created, display_name from Google metadata). Google client
  in Google Cloud Console (Web app, test-user mode); provider enabled in Supabase with
  client id/secret; redirect URI `https://<ref>.supabase.co/auth/v1/callback`. Both
  email + Google auth paths now live. Documented in nextjs-tutorial.md §7b (two
  Supabase clients + browser-driven OAuth flow).

- **2026-07-26 · Phase 0 auth + RLS foundation — verified end-to-end.**
  Email/password signup → session issued (confirm-email off for dev) → DB trigger
  auto-creates the `profiles` row (display_name pulled from `full_name` metadata,
  theme=dark, max_roadmaps=3). RLS proven: anon read of `profiles` returns `[]`;
  authenticated read returns only the caller's own row. Auth gate proven: logged
  out, both `/` and `/library` redirect to `/login` (root middleware calling
  `updateSession`). Cascade proven: deleting the auth user removes the profile.
  Stack: `@supabase/ssr` (browser + server + middleware clients), Next server
  actions for sign-in/up/out.

## Decisions changed / reversed

_(none yet — when a settled decision changes, move it here with the reason, so the
history is visible)_
