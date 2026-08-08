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

- **2026-08-08 · Phase 3 pace model: whole elapsed weeks since `created_at`, not a
  continuous fraction and not `target_date`.** Three options were on the table for the
  dashboard's denominator ("hours you should have logged by now"). **Decision: whole
  weeks elapsed since `roadmaps.created_at`, capped at `weeks_count`, times the plan's
  weekly rate.** **Why whole weeks:** the plan is *authored* in week-sized blocks with
  week-sized kill criteria, so a person is "a week behind", never "0.42 weeks behind";
  prorating by the hour would also declare you behind pace a few hours after creating a
  roadmap, which is useless and demoralising. Flooring means a fresh roadmap expects
  **0** hours and therefore *cannot* be behind on day one — which is the honest reading,
  and is asserted by test PC-01/SE-12. **Why the cap:** past the final week the
  expectation is the whole plan, not a number that keeps growing — an abandoned 5-week
  roadmap is "19 hours short", not "500 hours short". **Why not `target_date`:** it is
  `NULL` for every roadmap onboarding creates today, so it would have meant changing
  onboarding *and* carrying a NULL-fallback path — scope for no extra honesty.
  **Why not summing `weeks.hours` for elapsed weeks:** marginally more precise (it
  respects a 14h week vs the 12h average) but needs the weeks tree loaded before the
  banner can render, and the average is what the plan actually promised the user.

- **2026-08-08 · Phase 3 week attribution: by topic, not by calendar.** A study session
  fills a week's bar via `topic_id → topics.week_id`, **not** by where `logged_at` falls
  relative to the roadmap's start. **Why:** the chart then answers *"what did you
  study"* rather than *"when did you study"*, which is the only reading that makes the
  "Week 3 hasn't started" blocker **literally true** instead of merely suggestive. Under
  calendar attribution a week's bar could be full while that week's topics were
  untouched — the chart would contradict the blockers list sitting directly beneath it.
  **The accepted cost, made explicit rather than hidden:** sessions logged with no topic
  are *unattributed* — they count toward total hours but fill no bar, so **the bars can
  legitimately sum to less than the headline total**. Asserted deliberately (unit +
  SE-08) so it can never later be misread as a bug.

- **2026-08-08 · Phase 3 status is computed on read; `roadmaps.status` is now
  vestigial.** `deriveStatus()` returns fresh/ontrack/behind/stalled/done from live
  data at render time; the `roadmaps.status` **and** `roadmaps.hours_logged` columns are
  no longer read by any screen. **Why:** a stored status is a lie the moment time passes
  without a write — a roadmap would only decay into "stalled" *when you touched it*,
  which is exactly backwards, and it would need a cron or a trigger to stay honest.
  Computing on read cannot go stale and is a pure, unit-testable function. **The
  consequence, handled not deferred:** Library and Roadmap were switched off both
  columns in the same change, or they'd have kept rendering `'fresh'` / `0h` forever
  while Progress showed the truth — two screens disagreeing about the same roadmap.
  Test DS-04 pins this by setting `status='done'`/`hours_logged=999` in the Table Editor
  and asserting all three screens ignore them. **Ordering inside `deriveStatus` is
  load-bearing:** done → fresh → stalled → behind → ontrack, and the *fresh* branch is
  the subtle one — "nothing logged" is only `fresh` while **nothing is expected yet**;
  once hours were owed and none were logged it is `behind`, because an untouched
  two-week-old roadmap is failing, not new.

- **2026-08-06 · Phase 2 scheduling algorithm: the design's fixed ladder + an SM-2
  ease modifier (the open question, now closed).** memory.md had flagged "pure SM-2 vs
  the design's +1/+4/+14/+30 cadence" as undecided, with the deciding criterion being
  *which one can be derived live, no notes* (Rule 14 + Rule 26). **Decision: keep the
  ladder as the backbone, add a per-card ease factor that stretches/compresses it.**
  Correct grade → `repetitions` climbs a rung and `interval = ladder[rung] × (ease/2.5)`;
  past the top rung there's no ladder left so it switches to pure multiplicative growth
  (`prevInterval × ease`), which is exactly SM-2's steady state. Ease moves +0.1 per hit,
  −0.2 per miss, clamped 1.3–2.8. Wrong grade → **hard reset** to `repetitions = 0`,
  `interval = 1` (Rule 17: "close enough" is a miss), but **the ease penalty persists
  through the reset** — that's the card's memory of being hard for this user, so a
  repeatedly-missed card re-climbs the same ladder more slowly.
  **Why not pure SM-2:** (a) SM-2's intervals (1, 6, then ×ease → 15, 38…) do **not**
  match the `+1d +4d +14d +30d` chips the Recall screen renders to the user — shipping
  textbook SM-2 would have meant the UI lying about the cadence, or redesigning a screen
  the design source already settled; (b) SM-2 grades on a 0–5 quality scale, but Prep
  self-grades **binary** (Got it / Missed) by product design, which collapses SM-2's ease
  formula to two cases anyway — so "pure SM-2" was never actually on the table in its real
  form. **Why not the bare ladder:** it wastes the `ease`/`repetitions` columns
  Architecture §4 already specced and isn't adaptive — every card of the same rung would
  behave identically regardless of how hard it is for *you*. The variant keeps the
  product's promise, keeps per-card adaptivity, and is honestly labelled a *justified
  variant* rather than passed off as SM-2. Implemented in `lib/recall/scheduler.ts` as a
  **pure function with injected `now`** (18 unit tests) — purity is what makes the
  DST/UTC math (Rule 15) assertable at all. Date math is epoch-millisecond arithmetic,
  not calendar-field `setDate`, so a "day" is always 24h and never drifts across a DST
  boundary.

- **2026-08-06 · Grading is a server route, not a client write — the one place Phase 1's
  "owned rows go direct" rule-of-thumb does NOT apply.** Phase 1 settled that
  user-owned rows (notes, mastery) are written straight from the browser under RLS, and
  only quota/AI go through route handlers. Recall grading looks like the same shape (the
  card is the user's own row) but goes through `/api/recall/[cardId]/grade` anyway.
  **Why:** the row is the user's, but *the scheduling decision is not theirs to make* — a
  client computing its own `due_at` could hand itself a 3650-day interval and quietly opt
  out of the retention loop the product exists to enforce. RLS answers "whose row is
  this?"; it cannot answer "is this the number the algorithm would have produced?" So the
  split is sharper than "owned vs not-owned": **it's whether the value being written is
  derived from a rule the product must guarantee.** Verified by test SC-07/RC-02 — posting
  `{grade:'right', intervalDays:9999}` returns the algorithm's own value, ignoring the
  injected field, because the handler only ever reads `grade` off the body.

- **2026-07-30 · QA gate (Rule 27) + two-layer automated testing added.** After every
  feature I now write a manual test-case doc in `tests/phase-<n>-<feature>.md`
  (QA-lead-grade: happy + edge/negative/security/boundary/concurrency), the user runs
  it, fails become bug-log entries fixed before the phase is demoable. On top of the
  manual matrix, **automated tests split by cost:** **Vitest** unit-tests the pure seed
  generator (slice/reorder/pad/defaults — 6 tests, green); **Playwright** covers the P0
  cases that genuinely need a real browser+session+DB (quota 403/401/400, RLS cross-user
  404 + no-op delete, mastery earn/persist, delete cascade — 8 E2E + 2 auth-setup).
  **Deliberately NOT automated:** feel/timing/theme-legibility (live preview, debounce,
  dark mode) — low ROI, brittle; those stay manual. **Test DB strategy:** run against the
  **same** Supabase project with per-test cleanup (afterEach deletes created roadmaps) +
  two dedicated users (qa-a/qa-b) whose sessions are saved via a Playwright `setup`
  project — chosen over a separate test project / local Docker for lowest setup on a solo
  side-track. **Playwright pinned to 1.47.2 via `overrides`** because Node here is 18.19.1
  and Playwright ≥1.48 requires Node ≥20 (the *runner* refuses, not just the browser
  download) — same class of constraint as the Next-15 pin; the caret `^1.47.2` initially
  deduped up to 1.62 (Next pulls it transitively), so an exact `overrides` pin was needed.
  Revisit when Node → 20. Docs: Rules §27, CLAUDE.md, phases header, tests/README.md.

- **2026-07-30 · Phase 1 built — seeded roadmap experience, no AI.** Schema
  (`0003_roadmaps.sql`: roadmaps/weeks/topics/notes) + the full Library → Onboarding →
  Roadmap → Topic flow, driven by a **seed generator** that Phase 4 keeps as the
  AI-failure fallback (Rule 9). **Key decisions:**
  (1) **Seed generator = slice + reorder of a fixed catalog**, not a bigger templated
  generator. The design's 5-week frontend curriculum (`weeksData`) is the catalog
  (`lib/seed/catalog.ts`); `generateSeedRoadmap()` front-loads the catalog blocks that
  match the user's picked weak areas, slices to the timeline (3/5/8 wks), pads longer
  timelines by *cycling the focus blocks* (honest "spend extra weeks reinforcing weak
  areas", not invented content), and scales `hours_planned = weeks × hours-per-week`.
  Chosen over "verbatim, count only" (ignores weak areas — the one answer that should
  shape the plan) and over a full authored generator (invents content beyond the design
  source, more to defend). It returns the exact `SeedRoadmap` shape the AI path must also
  produce, so it stays a drop-in fallback.
  (2) **Child tables denormalise `user_id`** (weeks/topics/notes each carry it, copied
  from the parent) so every RLS policy is a flat `user_id = auth.uid()` — no self-join
  inside the policy (join-in-policy is slow + easy to get wrong). Tree integrity is held
  by `on delete cascade` FKs, not by RLS. One `for all` policy per table covers
  select/insert/update/delete.
  (3) **Gated writes vs owned writes split** (Architecture §1 rule-of-thumb, made
  concrete): roadmap *creation* + *deletion* go through **route handlers**
  (`/api/roadmaps/generate`, `/api/roadmaps/[id]`) because the **quota (Rule 18)** can't
  be trusted to the browser — the server counts existing roadmaps against
  `profiles.max_roadmaps` before inserting, and rolls back the whole tree on partial
  failure. **Mastery toggle + notes autosave** go **direct via supabase-js under RLS**
  (client component) — they're owned rows with no cross-user integrity rule, so no server
  hop needed. Mastery is still "earned" (Rule 16): status→`mastered` *only* on the
  explicit kill-criterion checkbox; first note keystroke flips `not_started`→
  `in_progress` but **never** to mastered.
  (4) **404 = authorization for free:** Roadmap/Topic pages call `notFound()` when the
  row is missing; under RLS a stranger's id returns zero rows → same 404, so a user can
  never view someone else's roadmap. Docs updated: nextjs-tutorial §9–14 (dynamic
  segments, async server-component fetch, `force-dynamic`, `notFound()`, route-handler
  APIs, `router.refresh()`), interview.md (Phase 1 subsystems). **Migration 0003 written
  but NOT yet applied** — must go via the Supabase SQL Editor (MCP stays unauthorized in
  this shell; Management API blocks DDL — see the two bug entries below).

- **2026-07-28 · v1 AI models: Google Gemini free tier, tier-routed behind the gateway.**
  Brainstormed cost vs quality for the Phase 4 model pick. **Decisions:** (1) **v1 uses
  Google Gemini's free tier** across all bindings — `reasoning` = **Gemini Flash**
  (roadmap gen + topic detail), `classification` = **Gemini Flash-Lite** (recall
  grading + recall-card gen), `embed()` = **Gemini's free embedding model** (Phase 4.5
  RAG). Chosen so a solo portfolio project runs at ~$0. (2) **The routing insight worth
  leading with in interviews:** the pricier-per-token tier is on the *rare* call
  (roadmap gen — ≤3/user by the quota rule), the cheap tier on the *frequent* one
  (recall grading — every review) — **cost follows call volume, not perceived
  importance**, so the "expensive" model is the cheap line item. (3) **Full cost
  showcase:** `ai_usage` metering + per-user caps + provider spend cap (the
  non-negotiables) **plus** a small internal cost readout ($/roadmap, token usage,
  cache hit-rate, before/after). (4) **Two honesty caveats baked into the docs, framed
  as assets not weaknesses:** (a) free tier is rate-limited + its data-use terms differ
  from paid — deliberate for a portfolio project, and a config-swap (not a rewrite) to
  move to paid before real users; (b) **prompt caching's dollar saving is ~$0 on a free
  tier** — so at v1 it's a latency/token-efficiency win, and the "cut cost X%" bullet is
  an honest **projection at paid-tier rates**, never a claimed live free-tier cut.
  **Why Gemini free over Claude/Haiku or local:** Gemini has a genuine free tier
  (best "$0 portfolio" story) with acceptable structured-JSON quality that the
  schema-validate-+-retry-+-seeded-fallback path absorbs; the provider-agnostic gateway
  keeps A/B-ing or switching to paid Claude a config edit. Docs updated: phases (Phase 4
  model block + cost readout, open-Q settled), Architecture §5 (tier→model config map +
  caching/readout framing), interview (bullet §2, §4e, §5 rapid-fire, §6 weaknesses).
  Still to confirm during build: Gemini's exact free-tier rate limits, data-use terms,
  and the embedding output dim (sets `vector(N)` in Phase 4.5).

- **2026-07-28 · GenAI scope: scoped RAG for resources; NO LangChain/LangGraph.**
  Brainstormed how to integrate AI + whether to showcase RAG/LangChain/LangGraph.
  **Decisions:** (1) **RAG is scoped in — but only for topic-detail resources**, the
  one surface with a genuine retrieval problem: generated-from-memory resources
  hallucinate URLs / cite dead links, so we ground the ranked-resources list on a
  **curated, embedded corpus** (retrieve → ground; schema forbids URLs outside the
  retrieved set). Roadmap gen, mental model, exercises stay pure generation — no
  retrieval problem there. (2) **Storage = `pgvector` in the same Supabase Postgres**
  (global `resources` table, HNSW cosine index) — no new datastore; it's the one
  table *without* RLS (shared vetted refs, service-role writes), the deliberate
  Rule-5 exception. (3) **Embeddings go through the gateway via a new `embed()`**
  method so they're provider-agnostic + metered like `complete()` (Rules 7/8/11).
  (4) **No LangChain / LangGraph** — the pipeline (embed → pgvector → grounded
  completion) is fully owned; a framework re-introduces the vendor-SDK spread Rule 7
  bans and hides the interesting part, and Prep has **no agent loop** for LangGraph.
  (5) **Phasing:** generation ships in Phase 4 (resources generated + flagged
  `unverified`); RAG grounding is a new **Phase 4.5**. Fallback (Rule 9): empty
  retrieval → generated `unverified` resources; RAG never hard-blocks.
  **Why it matters for interviews:** "RAG to kill hallucinated citations" is a
  failure-mode-driven answer; "no LangChain because I own the 3-step pipeline" mirrors
  the animation-lib / AI-scaffolding evaluate-then-reject pattern. Docs updated: PRD §7,
  Architecture §5/§5b + routes, phases (Phase 4.5 + open Q), Rules 5/7/11, interview
  §4g/§5/§6.

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
- ~~**Scheduling algorithm cadence**~~ — **SETTLED 2026-08-06:** the design's fixed
  +1/+4/+14/+30 ladder as the backbone **plus** an SM-2 ease factor that stretches or
  compresses each rung (past the top rung it becomes pure `prevInterval × ease`). A miss
  hard-resets to +1d but the ease penalty persists. Chosen because textbook SM-2's
  intervals contradict the cadence the UI advertises, and because Prep's binary
  self-grade collapses SM-2's 0–5 ease formula anyway. See the settled-decisions entry
  above + `lib/recall/scheduler.ts`.
- Roadmap JSON schema final shape (fields the generator must return).
- Onboarding question wording / weak-area taxonomy.
- Product name (still "Prep", a placeholder).
- When to revisit the v2 code-sandbox cut.
- **[Phase 4.5] RAG corpus taxonomy + seed contents** — the `topic_area` tag set and
  the initial hand-vetted resource list per weak-area. (Whether RAG is in and how is
  now *settled* above; what goes *in the corpus* is still open.)

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

- **2026-08-08 · Phase 3: floating-point rounding told a user who hit their target
  exactly that they were BEHIND PACE.** Symptom: the unit test asserting the 0.8
  behind-pace boundary (`is 'ontrack' at exactly the boundary`) failed — 9.6 hours
  logged against 12 hours expected returned `behind` instead of `ontrack`.
  **Verified it was the app, not the test, before changing anything** (the Phase 1/2
  discipline): reproduced in a bare `node -e` outside the harness — `12 * 0.8` evaluates
  to **`9.600000000000001`** in IEEE-754 binary floating point, so `9.6 < 9.6000...1` is
  `true` and the comparison classified the user as behind by **1.8e-15 hours**. Root
  cause: `logged` was rounded to 1dp but the *threshold* it was compared against was
  raw, so two values that should have been equal were compared at different precisions.
  Fix: round the threshold to the same 1dp as the logged total before comparing
  (`logged < round1(expected * BEHIND_RATIO)`) — **not** an epsilon nudge, which would
  just relocate the arbitrary line somewhere less obvious. Two regression tests pin it:
  the exact-boundary case, plus a "still behind a hair below" case proving the fix
  didn't simply widen the threshold. **Why it matters beyond the arithmetic:** this is a
  user-visible honesty bug in the one screen whose entire purpose is being honest — it
  flips a green "On track" chip to a red "BEHIND PACE" banner for someone who did
  exactly what they planned. **Lesson: when a threshold comparison decides something a
  user reads as a verdict, round both sides to the same precision — a derived
  comparison value is as much a floating-point hazard as the value being compared.**

- **2026-08-08 · Phase 3 E2E: 2 failures, both my test's invalid CSS selector — not the
  app.** Two `sessions.spec.ts` cases failed with `SyntaxError: 'option[value!=""]' is
  not a valid selector`. There is **no `!=` attribute operator in CSS** (that's XPath /
  jQuery), and Playwright *throws* on an invalid selector rather than quietly matching
  nothing — which at least made it obviously a harness fault rather than a silent empty
  result masquerading as "no topics rendered". Fixed with `:not([value=""])`. Fourth
  time in this project that a red E2E was the test lying (see the three entries above),
  and the first where the error message pointed straight at the harness. **Lesson: an
  invalid selector that throws is a better failure than one that matches nothing** — the
  Phase 2 "no cards render" scare was expensive precisely because the fixture failed
  *quietly*.

- **2026-08-06 · Phase 2 E2E: 6 of 8 tests failed for TWO different reasons, neither of
  them an app bug — and the app was verified correct before a single line was changed.**
  Third time this pattern has appeared (see the two 2026-07-31 entries), so the discipline
  is now reflexive: **reproduce outside the harness before touching app code.**
  **(1) The "anonymous request returned 200" scare.** The anon-grading test asserted the
  gate blocked it and got **200** — reading as a Rule-1 violation. Reproduced with `curl`
  against a clean dev server on a free port: **307 → /login**. The app was fine. Root
  cause was a *second*, distinct Playwright footgun beyond the one Phase 1 taught: I
  correctly passed `storageState: {cookies:[],origins:[]}` (the Phase 1 lesson), but
  **omitted `maxRedirects: 0`** — so Playwright happily **followed** the gate's 307 to
  `/login`, which renders fine and returns 200. The "success" was the login page. Phase
  1's `quota.spec.ts` already had `maxRedirects: 0` for exactly this reason; I'd copied
  the storageState half of the pattern and not the redirect half. **Lesson: when asserting
  that something is *blocked*, you must stop the client from following the block.** A
  redirect-following HTTP client turns every gate into a 200.
  **(2) The "no cards render" scare.** The remaining 5 failures all timed out waiting for
  recall cards. Probed the DB directly: User A had **zero** cards. Probed the seed
  function in isolation: it correctly produced 13. Probed the real route end-to-end via a
  throwaway spec: **201, and 13 cards rendered.** So generation worked all along. Actual
  cause: **two roadmaps left over from the 2026-07-31 Phase 1 run** put User A at the
  3-roadmap cap, so every in-test `generateRoadmap()` after the first returned **403** —
  and a 403 yields an empty queue, which surfaced as the *misleading* "no cards found"
  instead of "quota full". **Fix (harness, not app):** added a `seedQueue()` helper that
  asserts generation returned **201** and prints an explicit "quota full — leftover
  roadmaps" message otherwise, so this failure can never again masquerade as a rendering
  bug; then cleared the stale rows. **Lesson: shared-DB test suites need cleanup to be
  verified, not assumed — and a fixture's failure must be loud and self-describing, or it
  gets misdiagnosed as a failure of the thing under test.** All 18 E2E green after
  (8 new recall + 10 Phase 1, no regressions).

- **2026-07-31 · E2E "unauthenticated bypass" that looked like a security hole was a
  test-context bug — Playwright `newContext()` inherits ambient auth.** QT-06 (anon POST
  to `/api/roadmaps/generate` must be blocked) returned **201 + created a roadmap** from a
  supposedly-anonymous request. Looked like a Rule-1 violation. **Investigated before
  "fixing" the app** (right instinct): raw `curl` with no cookies got **307 → /login**
  (the middleware gate works). The difference was the test: `playwright.request.newContext()`
  **inherits the project's `storageState`** (User A's session) unless you pass
  `storageState: { cookies: [], origins: [] }` explicitly — so the "anon" request was
  actually authenticated. Fix: pass empty storageState. Lesson: **when a test says the app
  is insecure, reproduce outside the test harness first** — here the app was correct and
  the harness was lying. Also learned the real gate shape: middleware redirects protected
  routes to /login (307) *before* the handler's own 401, so the test asserts 307/302/401.

- **2026-07-31 · E2E mastery-persistence flake was a write-race in the TEST, not lost
  data.** TP-05 (master a topic → reload → still mastered) failed intermittently: after
  reload the checkbox was unchecked. Screenshot showed genuinely-unmastered state, so it
  read as a real persistence bug. **Diagnosed with a probe** that logged the Supabase
  PATCH: the write returned **204 and DID persist** — the test was calling `page.goto()` to
  reload **before the async `topics` PATCH completed** (it only waited for the optimistic UI
  label, which flips instantly). Fix: `page.waitForResponse(PATCH /rest/v1/topics)` before
  reloading. Lesson: optimistic UI + a fire-and-forget client write means the *DOM updating*
  is not proof the *write landed* — E2E must wait on the network response, not the pixel.

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

- **2026-08-08 · Phase 3 honest progress dashboard — QA gate closed, verified
  end-to-end.** Vitest **77/77** (53 progress: week-elapsed flooring + cap, the pace
  denominator, the 0.8 float boundary both sides, status precedence incl. the
  fresh-vs-behind asymmetry, topic-attribution + the unattributed-hours consequence,
  count-bucketed accuracy trend, blocker generation, and purity/no-mutation) ·
  Playwright **31/31** (13 sessions: anon blocked, the full `minutes` boundary set
  incl. accepted 1 & 1440, missing-roadmapId 400, unknown-roadmap 404, the
  log→dashboard round-trip, form persistence across reload, unattributed hours,
  cross-roadmap topic rejection, User-B 404, backdating ignored, fresh-roadmap
  no-banner, accuracy empty state; 18 Phase 1–2, no regressions) · **full manual pass
  green — all 48 cases**, and the awkward ones were genuinely run, not eyeballed: the
  Supabase Table-Editor cases that move `created_at`/`logged_at` to simulate weeks
  passing (PC-01…PC-12, incl. the 6-vs-7-day week boundary and the 576-vs-570-minute
  float boundary), the two-account RLS cases (SEC-01/02), and the raw-SQL
  CHECK-constraint bypass attempt (SEC-04, rejected by Postgres). **One real bug found
  during the build** (the IEEE-754 threshold defect, logged above) — found by a unit
  test, not by a user, because the aggregation is pure with `now` injected.
  **What is now demoable:** log study time → hours/pace/bars move → edit `created_at`
  back a few weeks → the BEHIND PACE banner, the derived status chip, and concrete
  blockers all appear with real numbers → Library and Roadmap agree with Progress,
  even with deliberately-poisoned `status`/`hours_logged` columns. **The explain-cold
  claims this backs:** why pace is floored to whole weeks (a fresh roadmap can't be
  behind on day one), why status is derived on read rather than stored (nothing
  naturally writes it; it decays through time, not user action), why week attribution
  is by topic rather than calendar (it's what makes the blocker literally true), and
  why the session write is a server route (RLS can't answer "is this row coherent?").

- **2026-08-08 · Phase 2 spaced repetition — QA gate closed, verified end-to-end.**
  Vitest **24/24** (18 scheduler: ladder walk, ease stretch/compress, hard reset, the
  persisting ease penalty, clamping, purity, epoch-ms DST safety) · Playwright **18/18**
  (8 recall: anon blocked, malformed grade rejected, unknown-card 404, grade round-trip,
  miss reset, session accuracy, RLS cross-user ×2; 10 Phase 1, no regressions) · **full
  manual pass green**, including the Supabase Table-Editor cases that walk one card up
  the ladder across simulated days (SC-04) and the miss-from-deep-interval case (SC-02),
  which automation can't reach without a movable clock. **No bugs found in the manual
  pass** — the two failures during the build were both harness bugs (logged above), not
  app defects. **What is now demoable:** onboard → a seeded recall queue appears with a
  due-count badge → grade a card → the card leaves today's queue and its `due_at` moves
  by the algorithm's own number → grade everything → "Queue clear". **The explain-cold
  claims this backs:** the ladder+ease algorithm derived from scratch (Rule 14), why
  `(user_id, due_at)` in that column order beats a scan (Rule 13), and why the grade
  write is a server route while notes/mastery are client+RLS.

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
