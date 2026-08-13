# Phases — Prep

> Build order. Each phase ends in something demoable (Rule 24). Sequenced so the
> app is usable **before** any real AI model is chosen — the seeded content from
> `Prep.dc.html` is the fallback provider. Companion: [PRD.md](./PRD.md) ·
> [Architecture.md](./Architecture.md) · [Rules.md](./Rules.md).
>
> **QA gate (Rule 27):** every feature ends with a manual test-case doc in
> [tests/](./tests/) (`phase-<n>-<feature>.md`) — happy + edge/negative/security cases.
> The user runs them, reports Pass/Fail; fails are logged + fixed before the phase is
> called demoable. A phase isn't "done" until its `tests/` doc is green.

---

## Phase 0 — Foundation ✅ DONE (shipped to Vercel)
**Goal:** empty app that deploys, authenticates, and has the design system.
- Next.js (App Router) project, TypeScript, deploy to Vercel (hello world).
- Supabase project; email/password + Google OAuth working end-to-end.
- Lift design tokens from `Prep.dc.html` into global CSS (OKLCH light/dark, IBM
  Plex, scrollbar, theme toggle) — see [design.md](./design.md).
- App shell: sidebar nav + header from the design, `/login` + a gated `/library` stub.
- **Demo:** sign in with Google, see the empty Library shell in your theme.

## Phase 1 — Roadmaps as data (no AI yet) ✅ DONE (2026-07-31)
**Goal:** the whole roadmap experience, driven by **seeded** content.
**Status:** built + tested (Vitest 6/6, Playwright E2E 10/10, manual pass green — QA
gate closed, Rule 27). Migration `0003_roadmaps.sql` applied. Branch
`phase-1-roadmaps` / PR open. See [tests/phase-1-roadmaps.md](./tests/phase-1-roadmaps.md).
- Schema + RLS for `profiles`, `roadmaps`, `weeks`, `topics`, `notes` (plain SQL migrations).
- Seed the `weeksData` / `topicDetail` from `Prep.dc.html` as a static generator
  (this becomes the AI fallback later).
- Screens: **Library** (cards, empty state, 3-creation quota), **Onboarding**
  (5-Q wizard + live preview → writes a roadmap from the seed), **Roadmap**
  (stat tiles, week accordions, kill criteria), **Topic** (mental model,
  resources, exercises, kill-criterion checkbox → mastery, autosave notes).
- Quota enforced server-side.
- **Demo:** onboard → generate a (seeded) roadmap → study a topic → mark it mastered.

## Phase 2 — Spaced repetition (the real algorithm) ✅ DONE (2026-08-08)
**Goal:** the retention loop on a hand-written scheduler.
**Status:** built + tested (Vitest 24/24, Playwright E2E 18/18, full manual pass green
incl. the Table-Editor multi-interval cases — QA gate closed, Rule 27). Migration
`0004_recall.sql` applied. Branch `phase-2-recall` / PR open.
See [tests/phase-2-recall.md](./tests/phase-2-recall.md).
- Schema + RLS for `recall_cards`, `recall_reviews`; the `(user_id, due_at)` index.
- Scheduling algorithm implemented **by hand** — the design's fixed **+1/+4/+14/+30**
  ladder as the backbone **plus an SM-2 ease modifier** that stretches/compresses each
  rung (past the top rung: `prevInterval × ease`). "Right" climbs a rung; "wrong" hard-
  resets to +1d with a **persisting** ease penalty (Rule 17). A *justified variant*,
  explicitly **not** SM-2 — see Architecture §4b + memory.md for the why.
- **Recall** screen: due cards, self-grade Got it / Missed, session accuracy,
  "queue clear" state, due-count badge on the nav.
- Cards seeded per topic for now (from `recallData`).
- **Demo:** grade a card → watch its next due date move per the algorithm; due
  count updates; "reviews due today" query verified against the index.

## Phase 3 — Honest progress dashboard ✅ DONE (2026-08-08)
**Goal:** the pace-vs-plan truth-teller.
**Status:** built + tested (Vitest **77/77**, Playwright E2E **31/31**, **full manual
pass green** — all 48 cases, *including* the Table-Editor elapsed-time cases that
simulate weeks passing (PC-01…PC-12), the two-account RLS cases (SEC-01/02), and the
raw-SQL CHECK-constraint case (SEC-04) — QA gate closed, Rule 27). Migration
`0005_study_sessions.sql` applied. Branch `phase-3-progress` / PR open.
See [tests/phase-3-progress.md](./tests/phase-3-progress.md).
- `study_sessions` (log hours, stored as **minutes** + a `1..1440` CHECK); aggregates
  for hours logged vs planned, pace, recall-accuracy trend, topics mastered — all in
  `lib/progress/compute.ts` as **pure functions with `now` injected**.
- **Pace basis (settled 2026-08-08):** whole **elapsed weeks since `created_at`**,
  capped at `weeks_count`, × the plan's weekly rate. Floored deliberately so a fresh
  roadmap expects 0h and *cannot* be behind on day one. Not `target_date` (NULL on
  every roadmap onboarding creates today).
- **Progress** screen: behind-pace/stalled banner (computed, not hard-coded), 4 stat
  tiles, hand-rolled SVG hours-bar + accuracy-line charts (Rule 22), blockers list
  built from real signals, log-hours form, and an empty state.
- **Week attribution (settled):** a session fills a week's bar via its **topic**
  (`topic_id → topics.week_id`), not by calendar position — so "Week 3 hasn't started"
  is literally true. Unattributed sessions count toward hours but fill no bar.
- Roadmap `status` (fresh/ontrack/behind/stalled/done) **derived on read** by
  `deriveStatus()`; `roadmaps.status` and `roadmaps.hours_logged` are now **vestigial**
  (never written, never read). Library + Roadmap switched onto the derived values in
  the same change so the three screens can't disagree.
- **Demo:** log hours, fall behind, see the banner + blockers reflect reality.

## Phase 4 — AI Gateway + real generation ✅ DONE (2026-08-12)
**Goal:** swap the seed for real AI behind the gateway — *this is where the model
brainstorm lands.*
**Status:** built + tested (Vitest **165/165**, Playwright E2E **51/51**, **full manual
pass green — all 76 cases**, including the suites that need config changes and a
dev-server restart per case (CAP's `AI_DAILY_CALL_CAP=2`, FALL's four `AI_MOCK_MODE`
runs) and the browser-console RLS bypass attempts (SEC-03/04/05) — QA gate closed,
Rule 27). Migration `0006_ai_usage.sql` applied. Branch `phase-3-progress` / PR open.
See [tests/phase-4-ai-gateway.md](./tests/phase-4-ai-gateway.md).
**Three defects found and fixed during the phase** (all in memory.md): the E2E suite
silently spending real Gemini tokens, the generator building single-topic roadmaps,
and month-scale timelines parsing as weeks.
- `lib/ai/gateway.ts`: tiered `complete()` returning a **discriminated union rather
  than throwing** (so every call site must state its fallback), schema validation +
  one retry-on-malformed, `ai_usage` metering, the per-user daily cap, and
  dependency-injected provider/meter/counter so the cap and retry logic are
  unit-testable with no network and no DB.
- **⟶ Model/provider decision (SETTLED 2026-07-28; ids verified against the live
  `models.list` endpoint 2026-08-08):** Google **Gemini**, bound in `lib/ai/config.ts`
  — the only file in the repo naming a model:
  - `reasoning` → **`gemini-3.5-flash`** (roadmap gen + topic detail — the rare,
    high-value calls; quality matters, volume is tiny under the 3-roadmap quota).
  - `classification` → **`gemini-3.5-flash-lite`** (recall-card gen — the frequent,
    low-value call; cheapest tier wins here).
  - `embed()` → **`gemini-embedding-001`** (Phase 4.5 RAG) — keeps the whole stack on
    one provider; its output dim sets the `vector(N)` column width.
  - *The counterintuitive routing point (interview asset):* the pricier-per-token
    tier sits on the **rare** call, the cheap tier on the **frequent** one — cost
    follows call volume, not perceived importance. The provider-agnostic gateway
    means A/B-ing Gemini vs Claude later is a config edit, not a rewrite.
  - **Honesty correction from the build:** the free tier proved *unreliable*, not just
    rate-limited — it returned 429 "prepayment credits are depleted" for days on a
    zero-usage project (a Google-side incident; see memory.md). So the claim is "runs
    at ~$0 with a paid upgrade that's a config edit", not "free forever". Ironically
    this exercised Rule 9 against a real multi-day outage instead of a simulated one.
- Wired `/api/roadmaps/generate` (reasoning), `/api/topics/[id]/detail` (reasoning),
  `/api/recall/generate` (classification); the seeded generator stays as the
  validated-failure fallback, and both generation routes **check ownership before
  spending a call**.
- **The model writes content, not contract (settled 2026-08-08):** the roadmap schema
  contains no week count, hours, or week numbers — those come from the user's answers
  and are stamped on server-side. Validating them would only catch a mismatch; not
  asking makes one impossible, and it's what keeps the seeded fallback a true drop-in.
- **Topic detail is generated on demand (settled 2026-08-08):** roadmaps now ship with
  `detail: null` on every topic — on **both** paths — and the Topic screen offers an
  explicit *Generate with AI* button. Auto-generating on open would spend 15–25 calls
  just to browse a roadmap. The seeded template moved to `lib/seed/detail.ts` and
  became the Rule 9 fallback for that route.
- Topic-detail resources are **generated (unverified)** at this stage and carry an
  amber chip saying so — RAG grounding lands in 4.5.
- ~~Optional cheap-tier assist on free-text recall grading.~~ **Not built,
  deliberately.** Prep self-grades **binary**, so there is no free text to grade; and
  Rule 17 ("close enough is a miss") is about the user being honest with themselves —
  delegating it to a model inclined to be generous would undermine the retention loop.
- **`ai_usage` is the one table users may read but not write** — SELECT-only RLS,
  service-role inserts. The daily cap is a `COUNT` of those rows, so the usual
  `for all` policy would have let any browser `DELETE` its way to an uncapped
  endpoint. See Architecture §4.
- **Cost showcase (the résumé asset):** `/usage` screen — calls vs cap, $/roadmap,
  tokens per call, cache hit-rate, fallback rate, per-route breakdown. It reports
  **what was actually charged ($0.00 on the free tier) next to a projection at
  paid-tier rates**, computed at read time from real token counts and never stored.
  That separation is the honest form of the "cut inference cost ~X%" bullet.
- **Demo:** real onboarding answers → a genuinely generated, schema-valid roadmap;
  generate a topic's study material and its recall cards on demand; usage + cost
  visible on `/usage`; caps enforced; kill the key and watch every flow still work.

## Phase 4.5 — RAG: ground topic resources on a curated corpus
**Goal:** kill hallucinated/dead resource links by retrieving over vetted docs —
the *only* genuine retrieval problem in Prep, so the only place RAG earns its keep.
- Enable `pgvector`; add the **global `resources`** table (topic_area, title, url,
  kind, summary, `embedding vector`) with an HNSW cosine index. This is the one
  table *without* RLS (shared vetted refs, server-only writes) — the deliberate
  exception to Rule 5, be ready to defend it.
- Add `embed()` to the AI Gateway (provider-agnostic + metered like `complete()`).
- **Seed** a hand-curated corpus (MDN/spec/article/talk entries per weak-area) via a
  SQL migration; a one-off script computes embeddings through `gateway.embed()`.
- Rewire `/api/topics/[id]/detail`: embed the topic query → `pgvector` top-k search
  (filtered by `topic_area`) → reasoning-tier completion **grounded** on the
  retrieved docs (schema forbids URLs not in the retrieved set). Empty retrieval →
  fall back to generated `unverified` resources (Rule 9: RAG never hard-blocks).
- **Demo:** open a topic → its resources are real, vetted links from the corpus;
  a niche topic with no corpus hit gracefully shows generated resources marked
  *unverified*. `ai_usage` shows the embedding call metered alongside the completion.

## Phase 5 — Print/export + polish
**Goal:** shippable v1.
- Roadmap PDF/print view (`Prep-print.dc.html` as reference).
- Empty/error/loading states, accessibility pass, mobile-reasonable layout.
- README with the "why" behind each subsystem (interview-defensibility).
- **Demo:** export a roadmap to PDF; end-to-end run-through clean.

## Phase 6 (v2 backlog — not now)
- Client-side iframe code execution → later server-side sandbox.
- AI-graded code submissions (depends on sandbox).
- Multi-domain tracks, sharing/cohort features.

---

## Open questions to resolve during the phases
- ~~**[Phase 4] v1 model/provider per tier**~~ — **SETTLED 2026-07-28; ids confirmed
  against the live API 2026-08-08:** `gemini-3.5-flash` (reasoning) /
  `gemini-3.5-flash-lite` (classification) / `gemini-embedding-001` (`embed()`);
  provider-agnostic gateway keeps it swappable. The three "still to confirm" items
  resolved as: **rate limits** — not published statically, visible per-key in AI
  Studio, and the in-app cap (25/day, env-overridable) sits well under them;
  **data-use terms** — free-tier content *is* used to improve Google products, paid
  tier is not, so enabling billing removes that caveat entirely; **embedding output
  dim** — still open, and only matters when Phase 4.5 writes the `vector(N)` column.
- ~~Exact scheduling-interval tuning (validate the +1/+4/+14/+30 cadence vs pure SM-2).~~
  — **SETTLED 2026-08-06:** fixed ladder + SM-2 ease modifier. See Phase 2 + memory.md.
- ~~Roadmap JSON schema final shape (fields the generator must return).~~ —
  **SETTLED 2026-08-08:** `{ title, subtitle, weeks: [{ title, killCriterion,
  topics: string[] }] }`, and what it deliberately **omits** matters more than what
  it contains — no week numbers, no hours, no week count. See `lib/ai/validate.ts`.
- **[Phase 4.5] embedding output dim** — sets the `vector(N)` column width. Confirm
  from a real `embed()` response before writing that migration.
- **Onboarding wording / weak-area taxonomy / role scope** — deferred past Phase 4
  on purpose (2026-08-12). Roles and weak-area options are frontend-specific because
  **the seeded fallback catalog is a frontend curriculum**; adding "Backend" would
  mean an AI failure hands that user a frontend plan (Rule 9 breaks quietly). Opening
  it up needs either role-dependent options + honest fallback labelling, or real
  per-role catalogs. Revisit in Phase 5. See memory.md.
- Product name (still "Prep").
