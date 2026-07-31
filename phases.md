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

## Phase 2 — Spaced repetition (the real algorithm) ⟵ NEXT
**Goal:** the retention loop on a hand-written scheduler.
- Schema + RLS for `recall_cards`, `recall_reviews`; the `(user_id, due_at)` index.
- Implement the scheduling algorithm **by hand** (SM-2 or a justified variant):
  ease, interval, repetitions; "right" advances, "wrong" resets to +1d.
- **Recall** screen: due cards, self-grade Got it / Missed, session accuracy,
  "queue clear" state, due-count badge on the nav.
- Cards seeded per topic for now (from `recallData`).
- **Demo:** grade a card → watch its next due date move per the algorithm; due
  count updates; "reviews due today" query verified against the index.

## Phase 3 — Honest progress dashboard
**Goal:** the pace-vs-plan truth-teller.
- `study_sessions` (log hours); aggregates for hours logged vs planned, pace,
  recall-accuracy trend, topics mastered.
- **Progress** screen: behind-pace banner (computed, not hard-coded), stat tiles,
  hand-rolled SVG hours-bar + accuracy-line charts, blockers list.
- Roadmap `status` (fresh/ontrack/behind/stalled) derived from real data.
- **Demo:** log hours, fall behind, see the banner + blockers reflect reality.

## Phase 4 — AI Gateway + real generation
**Goal:** swap the seed for real AI behind the gateway — *this is where the model
brainstorm lands.*
- Build `lib/ai/gateway.ts`: tiered `complete()`, schema validation +
  retry-on-malformed, `ai_usage` metering, per-user daily caps, prompt caching.
- **⟶ Model/provider decision (SETTLED — 2026-07-28):** v1 uses **Google Gemini's
  free tier** across all bindings, chosen so a solo portfolio project runs at ~$0
  while the gateway keeps the pick swappable:
  - `reasoning` → **Gemini Flash** (roadmap gen + topic detail — the rare, high-value
    calls; quality matters, volume is tiny under the 3-roadmap quota).
  - `classification` → **Gemini Flash-Lite** (recall grading + recall-card gen — the
    frequent, low-value calls; cheapest tier wins here).
  - `embed()` → **Gemini's free embedding model** (Phase 4.5 RAG) — keeps the whole
    stack on one free provider; its output dim sets the `vector(N)` column width.
  - *The counterintuitive routing point (interview asset):* the pricier-per-token
    tier sits on the **rare** call, the cheap tier on the **frequent** one — cost
    follows call volume, not perceived importance. The provider-agnostic gateway
    means A/B-ing Gemini vs Claude later is a config edit, not a rewrite.
- Wire `/api/roadmaps/generate`, `/api/topics/[id]/detail`, `/api/recall/generate`
  to the gateway; seeded generator stays as the validated-failure fallback.
- Topic-detail resources are **generated (unverified)** at this stage — RAG grounding
  lands in 4.5. Flag them so the UI can mark them until the corpus exists.
- Optional cheap-tier assist on free-text recall grading (self-grade stays default).
- **Cost showcase (the résumé asset):** on top of the required metering + caps +
  provider spend cap, build a small internal **cost readout** — $/roadmap, token
  usage per call, cache hit-rate, before/after prompt-caching — computed from
  `ai_usage`. On the free tier the *dollar* saving is ~$0, so caching is framed as a
  **latency + token-efficiency** win at v1; the readout also **projects** the saving
  at paid-tier rates, which is the honest form of the "cut inference cost ~X%" bullet.
- **Demo:** real onboarding answers → a genuinely generated, schema-valid roadmap;
  usage + cost visible in `ai_usage`; caps enforced; cost readout shows $/roadmap
  and cache hit-rate.

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
- ~~**[Phase 4] v1 model/provider per tier**~~ — **SETTLED 2026-07-28:** Gemini free
  tier (Flash = reasoning, Flash-Lite = classification, Gemini embeddings = `embed()`);
  provider-agnostic gateway keeps it swappable. See Phase 4 above + memory.md. Still
  to confirm during the build: Gemini's exact free-tier rate limits, whether the free
  tier's data-use terms are acceptable for this project, and the embedding model's
  output dim (sets the `vector(N)` width in Phase 4.5).
- Exact scheduling-interval tuning (validate the +1/+4/+14/+30 cadence vs pure SM-2).
- Roadmap JSON schema final shape (fields the generator must return).
- Onboarding question wording / weak-area taxonomy.
- Product name (still "Prep").
