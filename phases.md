# Phases — Prep

> Build order. Each phase ends in something demoable (Rule 24). Sequenced so the
> app is usable **before** any real AI model is chosen — the seeded content from
> `Prep.dc.html` is the fallback provider. Companion: [PRD.md](./PRD.md) ·
> [Architecture.md](./Architecture.md) · [Rules.md](./Rules.md).

---

## Phase 0 — Foundation
**Goal:** empty app that deploys, authenticates, and has the design system.
- Next.js (App Router) project, TypeScript, deploy to Vercel (hello world).
- Supabase project; email/password + Google OAuth working end-to-end.
- Lift design tokens from `Prep.dc.html` into global CSS (OKLCH light/dark, IBM
  Plex, scrollbar, theme toggle) — see [design.md](./design.md).
- App shell: sidebar nav + header from the design, `/login` + a gated `/library` stub.
- **Demo:** sign in with Google, see the empty Library shell in your theme.

## Phase 1 — Roadmaps as data (no AI yet)
**Goal:** the whole roadmap experience, driven by **seeded** content.
- Schema + RLS for `profiles`, `roadmaps`, `weeks`, `topics`, `notes` (plain SQL migrations).
- Seed the `weeksData` / `topicDetail` from `Prep.dc.html` as a static generator
  (this becomes the AI fallback later).
- Screens: **Library** (cards, empty state, 3-creation quota), **Onboarding**
  (5-Q wizard + live preview → writes a roadmap from the seed), **Roadmap**
  (stat tiles, week accordions, kill criteria), **Topic** (mental model,
  resources, exercises, kill-criterion checkbox → mastery, autosave notes).
- Quota enforced server-side.
- **Demo:** onboard → generate a (seeded) roadmap → study a topic → mark it mastered.

## Phase 2 — Spaced repetition (the real algorithm)
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
- **⟶ Open decision (brainstorm): pick the v1 model/provider per tier.** Wire the
  chosen model(s) into the config map. Candidates to evaluate: a hosted free/cheap
  tier, a local/open-weight model, or the Claude API — decide on cost, quality on
  the roadmap-JSON task, and free-tier limits. The gateway makes this a config
  change, not a rewrite.
- Wire `/api/roadmaps/generate`, `/api/topics/[id]/detail`, `/api/recall/generate`
  to the gateway; seeded generator stays as the validated-failure fallback.
- Optional cheap-tier assist on free-text recall grading (self-grade stays default).
- **Demo:** real onboarding answers → a genuinely generated, schema-valid roadmap;
  usage + cost visible in `ai_usage`; caps enforced.

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
- **[Phase 4] v1 model/provider per tier** — the AI brainstorm. Cheapest option
  that clears the roadmap-JSON quality bar; verify free-tier limits + a spend cap.
- Exact scheduling-interval tuning (validate the +1/+4/+14/+30 cadence vs pure SM-2).
- Roadmap JSON schema final shape (fields the generator must return).
- Onboarding question wording / weak-area taxonomy.
- Product name (still "Prep").
