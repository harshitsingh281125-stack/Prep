# PRD — Prep (AI-Native Interview-Prep Learning OS)

> **Status:** v1 MVP definition. Product pitch, scope, and cut list are **settled**
> (see `project-context.md`) — this doc turns them into a buildable spec.
> Companion docs: [Architecture.md](./Architecture.md), [phases.md](./phases.md),
> [design.md](./design.md), [Rules.md](./Rules.md).

---

## 1. One-liner

An AI-native learning OS for technical interview prep: structured roadmaps,
persistent per-topic notes, spaced-repetition recall on a real scheduling
algorithm, and an honest progress dashboard — replacing the manual "paste a
context file into a new chat every session" workflow.

## 2. Problem

Prepping with an AI chat today means:
- Re-pasting a context file every session (no memory).
- No tracking of what's due for review.
- Notes vanish into chat scroll unless manually saved.
- No feedback loop testing whether concepts are actually retained.
- No visibility into pace vs. plan.

## 3. Target user (v1)

- **Primary:** the author — an SDE prepping for frontend/fullstack interviews.
- **Secondary:** a small cohort (friend on a parallel plan, LinkedIn network).
- Built-in distribution — no cold user-acquisition problem at MVP scale.

Not a goal for v1: "learn anything with AI." Purpose-built for **SDE interview prep** only.

## 4. Goals & non-goals

### Goals (v1)
1. Onboard a user in ~5 questions and generate a real structured roadmap.
2. Persist roadmaps, topics, notes, and recall schedule per user (no re-pasting).
3. Schedule and surface cold-recall questions on a spaced cadence (real algorithm).
4. Show an honest progress dashboard: hours logged vs. planned, recall accuracy,
   explicit "behind pace" signal. No vanity metrics.
5. Keep AI usage cost-controlled and auth-gated from day 1.

### Non-goals (v1 — explicitly cut, see §10)
- Server-side arbitrary code execution / sandboxing.
- AI-graded code submissions (depends on the sandbox).
- Teams, sharing, social features, mobile app.
- Multi-domain content (only frontend SDE prep tracks for v1).

## 5. Screens & feature scope

Screens are defined by the pasted design (`Prep.dc.html`). Each maps to a route
in [Architecture.md](./Architecture.md) and a phase in [phases.md](./phases.md).

| # | Screen | What it does | v1? |
|---|--------|--------------|-----|
| 1 | **Auth** | Email/password + Google OAuth, via Supabase Auth. Theme toggle. | ✅ |
| 2 | **Library** | Grid of roadmap cards: progress bar, mastered / recall-accuracy / due chips, status badge (behind / stalled / on-track / not-started). Empty state. Quota "N of 3 creations used". | ✅ |
| 3 | **Onboarding** | 5-question intake (role, hiring bar, timeline, hours/week, weak areas — multi-select). Live roadmap-preview panel. Quota-locked state when at limit. | ✅ |
| 4 | **Roadmap** | 4 stat tiles (timeline, hours logged/planned, mastered, due today) + week accordions. Each week: topics with status dots + a **kill criterion**. | ✅ |
| 5 | **Topic / Study** | Mental-model card, ranked resources, from-scratch exercises, kill-criterion checkbox that marks the topic mastered. Per-topic notes. | ✅ |
| 6 | **Recall** | Spaced-repetition cards on a +1/+4/+14/+30d cadence. Self-grade **Got it cold / Missed it**. Session accuracy, "queue clear" state. | ✅ |
| 7 | **Progress** | "Behind pace" banner, stat tiles, hours bar chart (logged vs planned), recall-accuracy line chart, "what's blocking you" list. | ✅ |
| 8 | **Print / export** | Paginated PDF of the roadmap (`Prep-print.dc.html`). | ✅ (light) |

## 6. Core user journeys

### J1 — First roadmap
Sign up → Onboarding (5 Q) → **AI generates** a schema-valid roadmap (weeks →
topics → kill criteria, front-loaded on weak areas) → lands on Roadmap screen.

### J2 — Daily study
Library → open roadmap → open a topic → read mental model + ranked resources →
do a from-scratch exercise → check the kill criterion to mark mastered → notes autosave.

### J3 — Recall (the retention loop)
Recall tab shows due cards → user answers cold, self-grades → **Got it** advances
the card on the schedule; **Missed** resets it to +1d. Due count drives a badge.

### J4 — Honest check-in
Progress → sees hours logged vs planned, pace, recall-accuracy trend, and an
explicit "behind pace / N days past target" banner plus concrete blockers.

## 7. AI in the product (integrated; model choice open for v1)

AI **is** a first-class part of v1 — not deferred. But the **specific model/provider
is an open decision** to brainstorm (cheap/free-tier options for v1). It lives
behind a **provider-agnostic gateway** so the pick can change without touching
product code. See [Architecture.md §AI Gateway](./Architecture.md).

AI-powered surfaces in v1:
1. **Roadmap generation** — onboarding answers → schema-enforced roadmap JSON
   (weeks, topics, kill criteria). Needs real reasoning → the "strong" model tier.
2. **Study-plan / topic detail** — mental model + ranked resources + exercises
   for a topic. Reasoning tier, cacheable scaffolding. **Resources are RAG-grounded**
   (Phase 4.5) against a curated, embedded corpus so links are real/vetted, not
   hallucinated; mental-model + exercises stay pure generation. See
   [Architecture.md §5b](./Architecture.md).
3. **Recall-card generation** — active-recall questions derived per topic.
   Classification tier: it's the frequent, low-value call, so it gets the cheap
   model (see the cost-routing note in [phases.md](./phases.md)). Generated on
   demand from the Topic screen; falls back to seeded questions.

   *(Originally listed here as "recall grading (assist)" — a cheap-model check on
   free-text answers. **Not built, and deliberately so.** Prep self-grades
   **binary** (Got it / Missed) by product design, so there is no free text to
   grade. More importantly, Rule 17 — "close enough is a miss" — is a rule about
   the user being honest with themselves; handing it to a model that is
   structurally inclined to be generous would undermine the one thing the recall
   loop exists to enforce.)*

**Guardrails (non-negotiable from day 1):**
- All AI calls go through **auth-gated server routes** — no public/unauthenticated AI endpoint.
- **Hard per-user daily call caps**, enforced server-side.
- **Prompt caching** on fixed system/rubric scaffolding.
- **Model routing by task** (reasoning vs classification tier).
- A spend alert/cap set in whatever provider console v1 lands on.
- Every generation is **schema-validated with a retry-on-malformed-output** path;
  on repeated failure, fall back to a seeded template so the UX never hard-blocks.

**Open for brainstorm (tracked, not decided):** which model/provider for each
tier in v1 — candidates include a hosted free/cheap tier, a local/open model, or
the Claude API. Recorded as an open question in [phases.md](./phases.md).

## 8. Data & persistence (summary)

Full schema in [Architecture.md](./Architecture.md). Entities:
`profiles`, `roadmaps`, `weeks`, `topics`, `notes`, `recall_cards`,
`recall_reviews`, `study_sessions` (hours logged), `ai_usage` (cost/cap tracking).
The gradeable DB question — "give me all reviews due today" — is served by an
index on `recall_cards (user_id, due_at)`.

## 9. Key product rules

- **Quota:** free plan = **3 roadmap creations**. Creating/regenerating disabled at limit.
- **Mastery is earned:** a topic is "mastered" only when its **kill criterion**
  is checked — a claim the user commits to being able to defend.
- **Recall honesty:** "close enough" counts as a **miss**; a miss resets the card to +1d.
- **No vanity metrics:** streaks are shown but explicitly de-emphasized
  ("13d streak · not that it matters"). The headline signal is pace-vs-plan.
- **AI never hard-blocks the app:** every AI surface has a non-AI fallback.

## 10. Cut for v1 (v2 candidates)

- Server-side code execution / sandboxing → use client-side iframe execution later.
- AI-graded code submissions → depends on sandbox.
- **Interview framing:** consciously scoping the sandbox out for security surface
  + cost is a *stronger* answer than a poorly built one.

## 11. Success metrics

- **Activation:** % of signups that generate ≥1 roadmap.
- **Retention (the real one):** recall sessions completed / week per active user.
- **Honesty signal working:** users returning after a "behind pace" banner.
- **Cost:** inference $/active-user/month kept under target (see cost strategy).

## 12. Interview-defensibility checklist (build so each is answerable cold)

1. Data model + the "reviews due today" index/query design.
2. The spaced-repetition algorithm — derivable from scratch, no notes.
3. Structured-output enforcement — schema, validation, retry-on-malformed.
4. Roadmap-generator prompt design + one iteration story.
5. Cost/model-routing decisions + rate-limit approach.
6. The sandboxing trade-off (why cut, what's needed to add safely).
7. One real bug personally hit and fixed (keep a decisions+bugs log while building).
