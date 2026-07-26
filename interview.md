# Interview Prep — Talking About This Project

> Living doc. The goal: talk about Prep for **20+ minutes** without ever using
> "the AI built that part" as a full stop — every piece has a **why** attached.
> Audience bar: senior/staff interviewers at **Google / Meta / Netflix** who will
> push with "why not X instead?" on every decision.
>
> **Rule for this file:** only write an answer once the thing actually exists and
> I can explain it cold. A bullet I can't derive live is a red flag, not an asset.
> Updated as we build (see [phases.md](./phases.md)). Sources: [PRD.md](./PRD.md),
> [Architecture.md](./Architecture.md), [memory.md](./memory.md).

---

## 1. The 30-second pitch (say this first, every time)

> "Prep is an AI-native learning OS for technical interview prep. The problem: prepping
> with an AI chat means re-pasting context every session, no tracking of what's due to
> review, and no honest signal on whether you're actually on pace. Prep turns that into a
> real system — a structured roadmap generator, a spaced-repetition engine I implemented
> myself, and a progress dashboard that will tell you you're behind. The AI is one
> component behind a provider-agnostic gateway, not the whole product."

Why this framing lands: it names a **real problem I personally hit**, and it
positions AI as *a subsystem with engineering around it*, not a wrapper.

## 2. Headline resume bullets

> Tighten numbers once real. Each bullet must map to a defensible story below.

- Built an AI-native interview-prep platform (Next.js, Supabase/Postgres, TypeScript)
  with auth, row-level security, a hand-implemented spaced-repetition scheduler, and a
  provider-agnostic AI gateway with schema-validated generation.
- Designed a Postgres schema + RLS for per-user roadmaps, topics, and recall cards;
  optimized the "reviews due today" path with a composite `(user_id, due_at)` index.
- Implemented a spaced-repetition algorithm from scratch (not a library) driving
  a +1/+4/+14/+30-day review cadence with honest self-grading.
- _[Phase 4] Cut inference cost ~X% via prompt caching + task-based model routing_
  _behind a single gateway abstraction — fill in once measured._
- Enforced hard per-user daily AI caps and auth-gated inference routes to keep a
  usage-metered bill predictable.

## 3. Architecture story (the spine of the conversation)

**"Walk me through the architecture."**
> Next.js App Router for the frontend and a co-located server layer. Supabase for
> Postgres, Auth, and RLS. Most reads go straight from the client to Postgres under
> RLS. Anything privileged — AI calls, quota checks, usage metering — goes through
> auth-gated server routes so secrets and enforcement stay server-side. AI sits behind
> a provider-agnostic gateway: product code asks for a *tier* (reasoning vs
> classification), and a config map binds that to a concrete model.

**Why Next.js and not plain React/Vite?** → I needed a trusted server layer. The
AI provider key can't reach the browser, and per-user caps + JSON-schema validation
have to be enforced somewhere the client can't bypass. Next's route handlers give me
that co-located with the UI, one deploy on Vercel.

**Why Supabase and not raw Postgres / Firebase / an ORM?** → Wanted to write real SQL
(schema + indexes + RLS by hand — a skill I was deliberately building), but not run my
own auth and connection infra. Supabase gives managed Postgres + Auth + RLS with a
generous free tier. I avoided an ORM on purpose so the schema work stayed visible.

**Why the AI gateway abstraction?** → The model/provider choice was genuinely open, and
I didn't want a vendor SDK spread through feature code. Tiers-not-model-names means
switching providers (or A/B-ing cost vs quality) is a config change, not a refactor. It
also centralizes the three things every AI call needs: caching, schema validation, and
usage metering.

## 4. Subsystem deep-dives

> _Fill each in when the subsystem is built (phase in brackets). Until then it's a
> question I can't yet answer cold — that's the point._

### 4a. Data model + "reviews due today" [Phase 1–2]
- _Tables + relationships:_ _(schema lands Phase 1 — fill then)_
- _Why `(user_id, due_at)` composite index, in that column order:_ _(Phase 2)_
- _How RLS and the index interact / query plan:_ _(Phase 2)_
- _"Why not compute due-ness in app code?"_ _(Phase 2)_

**RLS foundation [Phase 0 — built + verified].** Every table enables RLS with a
`user_id = auth.uid()` predicate; `profiles` was the first (its PK *is* the
`auth.users` id, so the predicate is `id = auth.uid()`). Verified by querying with
the anon key (returns `[]`) vs a real user session (returns only that user's row).
- _"Where does the profile row come from?"_ → an `after insert on auth.users`
  trigger (`handle_new_user`, SECURITY DEFINER) creates it on signup, seeding
  display_name from OAuth `full_name` metadata. The app never inserts it.
- _"Why SECURITY DEFINER, and isn't that dangerous?"_ → it needs to write a row the
  new user can't yet (no session mid-signup), so it runs as owner past RLS — but I
  had to **revoke EXECUTE from public/anon/authenticated** so it can only fire from
  the trigger, never be called directly as an RPC. (See §7 — this was a real find.)

### 4b. Spaced-repetition algorithm [Phase 2]
- _The algorithm, derived from scratch (ease, interval, repetitions):_ ...
- _Why this cadence vs pure SM-2 (a decision we flagged as open):_ ...
- _"Why implement it yourself instead of a library?"_ → resume-defensibility +
  it's ~40 lines; a library would hide the one interesting part.
- _What a "wrong" grade does and why reset-to-+1d:_ ...

### 4c. Structured output enforcement [Phase 4]
- _How reliable JSON is guaranteed from an LLM:_ schema + validate + retry-on-malformed
  + seeded-template fallback so AI never hard-blocks a flow.
- _"What happens when the model returns garbage twice?"_ ...
- _"Why not trust the model / use function-calling only?"_ ...

### 4d. Prompt design for the roadmap generator [Phase 4]
- _What fields the schema demands and why:_ ...
- _The iteration story ("v1 generated bad plans because X, fixed by Y"):_ ...

### 4e. Cost / model routing [Phase 4]
- _Why classification-tier here, reasoning-tier there:_ ...
- _Prompt caching — what's cached and the measured saving:_ ...
- _Rate-limit / per-user cap design:_ ...

### 4f. The sandboxing trade-off [cut / v2]
- _Why server-side code execution was consciously cut for v1_ (security surface:
  container isolation, resource limits, escape risk + cost) → client-side iframe instead.
- _What it'd take to add it safely later:_ ...
- Framing: this is a *judgment call I can defend*, not a gap.

## 5. "Why not X?" rapid-fire (the ones they'll actually ask)

| They ask | Short answer |
|----------|-------------|
| Why not a vector DB / RAG? | v1 content is generated + seeded, not retrieved over a corpus. No retrieval problem yet → no vector DB. Would revisit if I add a large resource library. |
| Why not multi-provider LLM shopping? | Marginal savings at MVP scale vs. the overhead of a multi-provider layer. "Cost-aware routing + caching within one provider behind a gateway" is the cleaner story. Revisit at hundreds of users. |
| Why not a component/animation library (shadcn, Animate UI)? | Hand-rolled OKLCH design + one surgical animation dep (Framer Motion). Adding a design system I didn't need is complexity I'd have to defend. |
| Why self-graded recall, not AI-graded? | Honesty + zero-cost + always works offline. AI grading is an optional cheap-tier *assist*, never the gate. |
| Why quota of 3 roadmaps? | Cost containment on a usage-metered bill + forces focus. Enforced server-side, not just hidden in UI. |
| How do you stop a shared link spiking your bill? | No unauthenticated AI route; per-user daily caps enforced server-side before dispatch; provider spend cap. |

## 6. Honest weaknesses (say these before they find them)

Naming a limitation *first* reads as senior. Keep a real list:
- Recall content is seeded/generated, not yet validated against learning-science literature.
- Single-provider AI — no failover if that provider is down (acceptable at this scale).
- _(add real ones as they show up)_

## 7. The "one real bug I hit and fixed" story [ongoing]

> Pull the best entry from [memory.md](./memory.md)'s bug log. Needs: symptom →
> what I assumed → actual root cause → fix → what I changed to prevent the class.

**The SECURITY DEFINER RPC hole [Phase 0].**
- _Symptom:_ Right after creating the `profiles` table with an auto-profile trigger,
  Supabase's security advisors flagged that my `handle_new_user()` function was
  executable by `anon` and `authenticated` roles via `/rest/v1/rpc/handle_new_user`.
- _What I assumed:_ that a function only used by a trigger was reachable only through
  that trigger.
- _Actual root cause:_ Postgres grants EXECUTE on new functions to `public` by
  default, and because the function is SECURITY DEFINER it runs with the *owner's*
  rights — so any authenticated (or even anonymous) client could invoke the
  profile-insert routine directly, outside the signup path. Separately, a second
  function had a mutable `search_path`, meaning it resolved unqualified names against
  a caller-influenced schema.
- _Fix:_ a follow-up migration that `REVOKE EXECUTE ... FROM public, anon,
  authenticated` (the trigger still fires as owner) and pins `SET search_path =
  public` on the function.
- _What I changed to prevent the class:_ made `get_advisors` a required step after
  every DDL change, and now treat "default grants + SECURITY DEFINER" as a checklist
  item whenever I write a definer function.
- _Why it's a good story:_ it's a concrete, non-obvious security bug I found via
  tooling and reasoned about at the Postgres-permissions level — not a typo.

## 8. What's genuinely novel / worth leading with

- Provider-agnostic AI gateway with tier-based routing + centralized schema
  validation and metering (not a wrapper).
- A from-scratch spaced-repetition scheduler as a real backend subsystem.
- Product opinion as engineering: "honest metrics" (a dashboard that says *behind
  pace*) is a deliberate design stance, defensible in a product/behavioral round too.
