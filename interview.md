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
- _[Phase 4] Ran v1 on a free-tier model (Gemini) behind a provider-agnostic gateway
  with tier-based routing, prompt caching, and per-user caps; measured token usage +
  cache hit-rate and **projected ~X% inference-cost reduction at paid-tier rates** —
  fill X in once measured. (Honest form: the free tier's real dollar cost is ~$0; the
  X% is the projected saving if/when it moves to paid.)_
- Enforced hard per-user daily AI caps and auth-gated inference routes to keep a
  usage-metered bill predictable.
- Built a layered test suite — Vitest for pure logic, Playwright E2E for the
  security/RLS/quota paths (server-enforced quota, cross-user isolation, auth gating) —
  and used it to catch two false-alarm regressions that were actually test-harness bugs.

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
- **Tables + relationships [Phase 1 — built].** `roadmaps` → `weeks` → `topics` →
  `notes`, one-to-many down the tree, all `on delete cascade` from the parent. Every
  child **denormalises `user_id`** (copied from the parent, not looked up) so its RLS
  policy is a flat `user_id = auth.uid()` — no join inside the policy. `topics.detail`
  is `jsonb` (the mental model / resources / exercises — seeded now, AI-generated in
  Phase 4). `roadmaps.answers` is `jsonb` (raw onboarding answers, for audit + regen).
  - _"Why denormalise user_id instead of joining to the parent in the policy?"_ → an
    RLS predicate runs on **every row access**; a self-join to the parent per row is
    slow and easy to get subtly wrong. A copied column makes the check a single index-
    friendly comparison. Cascade FKs (not RLS) keep the tree consistent.
  - _"One `for all` policy vs four?"_ → one `using (...) with check (...)` policy covers
    select/insert/update/delete; `using` gates reads/deletes, `with check` gates writes.
    Same predicate either way, so one policy is clearer than four identical ones.
- _Why `(user_id, due_at)` composite index, in that column order:_ _(Phase 2)_
- _How RLS and the index interact / query plan:_ _(Phase 2)_
- _"Why not compute due-ness in app code?"_ _(Phase 2)_

### 4a-i. Seed generator + server-enforced quota [Phase 1 — built]
- **What the seed generator is.** Onboarding answers → a full roadmap tree, by
  **slicing + reordering a fixed catalog** (the design's 5-week frontend curriculum).
  It front-loads the catalog blocks matching the user's weak areas, slices to their
  timeline, pads longer timelines by cycling the focus blocks, and scales planned hours.
  No AI. It returns the *same shape* the Phase-4 AI generator must produce — which is the
  whole point: **it's the schema-valid fallback** when a future AI generation is
  malformed (Rule 9), so AI can never hard-block onboarding.
  - _"Why seed before AI at all?"_ → the app is fully usable and demoable before any
    model is chosen (phases are sequenced so nothing waits on the model brainstorm), and
    the fallback path is *proven working* long before the AI path exists.
- **Quota is enforced server-side, not hidden in the UI (Rule 18).** Creating a roadmap
  goes through `POST /api/roadmaps/generate`, which counts the user's existing roadmaps
  against `profiles.max_roadmaps` **before** inserting and 403s at the cap. The UI also
  disables the button, but that's cosmetic — the route is the real gate.
  - _"Why a route and not a direct client insert?"_ → a client could just call the DB
    directly and skip the count. The **gated write** (quota, and later AI) needs the
    server; **owned writes with no cross-user rule** (mastery toggle, notes autosave) go
    direct via supabase-js under RLS. That split is the architecture's rule-of-thumb made
    concrete.
  - _"What if a roadmap half-writes?"_ → the route builds roadmap→weeks→topics→notes in
    sequence and, on any failure, deletes the roadmap (cascade cleans the children) so
    there's never a half-built tree.
- **Mastery is earned (Rule 16).** A topic becomes `mastered` *only* when the
  kill-criterion checkbox is explicitly checked (writes `status` + `mastered_at`).
  Studying (first note keystroke) flips `not_started`→`in_progress`, never to mastered.
  Unchecking reverts to `in_progress` — it was clearly started.

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

### 4a-ii. Testing strategy — layered, and two tests that lied [Phase 1 — built]
- **The layering decision (lead with this — it shows judgement, not just coverage).**
  I split tests by *what actually needs a browser + DB*, not "test everything the same way":
  - **Unit (Vitest)** — the seed generator is a pure function (answers → roadmap tree), so
    its slice/reorder/pad/default logic is unit-tested directly (6 tests). Driving that
    through the UI would be slower and flakier for zero extra signal.
  - **E2E (Playwright)** — only the cases that genuinely need a real session + real
    Postgres under RLS: quota **403 at cap via direct API** (proves it's server-enforced,
    not a disabled button), unauth **blocked**, malformed-body **400s**, **cross-user RLS**
    (User B → 404 on A's roadmap; B's DELETE no-ops), mastery **earned + persisted**,
    delete **cascade**. 10 tests.
  - **Manual** — feel/timing/theme (live preview, debounce, light/dark). Automating "looks
    right in dark mode" is brittle and low-ROI; a QA-lead call, not laziness.
- _"Why not just E2E everything?"_ → cost/signal. E2E is slow, needs auth + a DB + cleanup,
  and is the flakiest layer. Push logic down to unit tests; reserve E2E for the
  integration/security behaviour a unit test can't prove.
- **The two-bug story (this is the actual asset — both were the *test* lying, not the app):**
  1. **A test reported an auth bypass; the app was fine.** An E2E said an *anonymous* POST
     created a roadmap (201) — looked like a Rule-1 security hole. Instead of patching the
     app I reproduced it **outside the harness with `curl`** → got **307 → /login**. The app's
     gate was solid; **Playwright's `request.newContext()` silently inherits the logged-in
     `storageState`** unless you pass empty cookies, so the "anonymous" request carried a
     session. Fix was in the test. *Lesson I'd say out loud:* when a test claims the system is
     broken, reproduce the claim independently before trusting it.
  2. **A "data loss" flake was an optimistic-UI race in the test.** Mastery-persistence failed
     intermittently: master a topic, reload, it's unchecked. A probe logging the network
     showed the write returned **204 and did persist** — the test reloaded **before the async
     PATCH completed**, only waiting on the optimistic label (which flips instantly). Fix:
     `waitForResponse(PATCH)` before reload. *Lesson:* the DOM updating is not proof the write
     landed; E2E on optimistic UI must wait on the response, not the pixel.
- **Node-18 pin note (infra literacy):** Playwright is pinned to **1.47.2 via `overrides`**
  because ≥1.48 requires Node 20 and this box runs 18; the caret dep deduped up to 1.62 via
  Next's transitive copy, so an exact override was needed. Same class of constraint as the
  Next-15 pin.

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
- _v1 model pick:_ **Google Gemini free tier** — Flash for `reasoning`, Flash-Lite for
  `classification`, Gemini embeddings for `embed()`. Chosen so a solo portfolio project
  runs at ~$0; the provider-agnostic gateway means moving to paid Claude/Gemini is a
  config edit, not a rewrite.
- _The counterintuitive routing decision (lead with this):_ the pricier-per-token tier
  sits on the **rare** call (roadmap gen — ≤3 per user, ever, by the quota rule), the
  cheap tier on the **frequent** one (recall grading — fires every review). **Cost
  follows call volume, not perceived importance** — so the "expensive" model is
  actually the cheap line item. That inversion is the whole story.
- _Why classification-tier for recall grading:_ it's a short, high-volume "close enough
  = miss" check — no deep reasoning needed, and self-grade is always the fallback, so a
  cheap model is the right tool and AI-off still works.
- _Prompt caching — what's cached and the honest saving:_ the fixed system/rubric
  scaffolding is cached. On the free tier the dollar saving is ~$0 (already free), so at
  v1 it's a **latency + token-efficiency** win; the dollar saving is **projected** at
  paid-tier rates via the cost readout. Don't claim a free-tier "cut cost X%" — say
  "designed + measured the controls; projected X% at paid rates."
- _Rate-limit / per-user cap design:_ hard per-user daily caps checked server-side
  against `ai_usage` *before* dispatch; provider spend cap in the console; every call
  (incl. embeddings) metered. Caps + no-unauthenticated-route are what stop a shared
  link from spiking the bill.
- _"Why a free tier — isn't that a toy?"_ → deliberate for a solo portfolio project;
  the free tier is rate-limited and its data-use terms differ from paid, which I'd flag
  before real users. The point of the gateway is exactly that this is a swap, not a
  rewrite — I optimized for $0 now with a clean paid-tier upgrade path.

### 4g. RAG — grounding resources on a curated corpus [Phase 4.5]
> _Fill when built. The spine of the answer, ready to flesh out:_
- _The failure mode it fixes:_ LLM-generated resources hallucinate URLs / cite dead
  links — the one real retrieval problem in Prep. RAG grounds the ranked-resources
  list on vetted docs so no link is invented.
- _The flow:_ embed the topic query → pgvector cosine top-k over a global `resources`
  corpus (filtered by `topic_area`) → reasoning-tier completion whose schema forbids
  URLs outside the retrieved set. _(fill exact k, index type, prompt once built)_
- _Why pgvector + HNSW, in-Postgres:_ small corpus, no new infra, joinable in SQL.
- _"Why is `resources` the one table without RLS?"_ → it's a global vetted corpus,
  not user data; reads are public-safe, writes are service-role only. Deliberate
  Rule-5 exception, not an oversight.
- _The Rule-9 fallback:_ empty retrieval → generated resources flagged `unverified`;
  RAG never hard-blocks a flow.
- _"Why not LangChain / a vector DB?"_ → see §5 rapid-fire.

### 4f. The sandboxing trade-off [cut / v2]
- _Why server-side code execution was consciously cut for v1_ (security surface:
  container isolation, resource limits, escape risk + cost) → client-side iframe instead.
- _What it'd take to add it safely later:_ ...
- Framing: this is a *judgment call I can defend*, not a gap.

## 5. "Why not X?" rapid-fire (the ones they'll actually ask)

| They ask | Short answer |
|----------|-------------|
| Why RAG here, and only here? | Exactly one surface has a real retrieval problem: **topic resources**. Generated-from-memory resources hallucinate URLs / cite dead links. So resources are RAG-grounded on a curated pgvector corpus (retrieve → ground → the model can't invent a link). Everything else (roadmap, mental model, exercises) is pure generation — no retrieval problem there, so no RAG there. RAG solves a named failure mode, it's not decoration. |
| Why not LangChain / LangGraph? | The pipeline is embed → pgvector query → grounded completion — three steps I own end-to-end behind my gateway. A framework re-introduces the vendor-SDK spread my gateway exists to prevent, and hides the one interesting part. LangGraph orchestrates agent loops; Prep has no agent loop, so there's nothing for it to run. Evaluated, chose the ~100-line typed gateway. |
| Why pgvector, not a dedicated vector DB (Pinecone/Weaviate)? | The corpus is small and already lives next to everything else in Postgres. pgvector + an HNSW index gives me similarity search with zero new infra, one backup story, and I can join resources to topics in SQL. A separate vector DB is operational overhead I'd have to justify at hundreds of docs, not dozens. |
| Why not multi-provider LLM shopping? | Marginal savings at MVP scale vs. the overhead of a multi-provider layer. "Cost-aware tier routing + caching within one provider behind a gateway" is the cleaner story — and my gateway already makes switching a config edit, so I get the option value without the runtime complexity. Revisit at hundreds of users. |
| Why a free-tier model (Gemini), not Claude? | Deliberate for a solo portfolio project — v1 runs at ~$0. Free tier is rate-limited and its data-use terms differ from paid, which I'd change before real users; the provider-agnostic gateway makes that a config swap, not a rewrite. Quality gap on structured JSON is small and my schema-validate-+-retry-+-seeded-fallback path absorbs it. |
| Why not a component/animation library (shadcn, Animate UI)? | Hand-rolled OKLCH design + one surgical animation dep (Framer Motion). Adding a design system I didn't need is complexity I'd have to defend. |
| Why self-graded recall, not AI-graded? | Honesty + zero-cost + always works offline. AI grading is an optional cheap-tier *assist*, never the gate. |
| Why quota of 3 roadmaps? | Cost containment on a usage-metered bill + forces focus. Enforced server-side, not just hidden in UI. |
| How do you stop a shared link spiking your bill? | No unauthenticated AI route; per-user daily caps enforced server-side before dispatch; provider spend cap. |

## 6. Honest weaknesses (say these before they find them)

Naming a limitation *first* reads as senior. Keep a real list:
- Recall content is seeded/generated, not yet validated against learning-science literature.
- Single-provider AI — no failover if that provider is down (acceptable at this scale).
- **v1 runs on a free tier** (Gemini) — rate-limited, and free-tier data-use terms
  differ from paid; fine for a portfolio project, but a paid tier is the pre-real-users
  step (a config swap by design, not a rewrite).
- The **"cut cost X%" number is a projection**, not a realized free-tier saving — the
  free tier already costs ~$0. I measure token usage + cache hit-rate and project the
  saving at paid rates; I say it that way rather than implying a live dollar cut.
- RAG corpus is **hand-curated and small** — good precision on covered areas, thin
  coverage on niche topics (which fall back to `unverified` generated resources). It's
  quality-over-breadth by choice, not a scraped index; scaling coverage is a v2 job.
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
