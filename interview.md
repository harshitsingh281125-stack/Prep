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
- Built a pace-vs-plan progress dashboard whose every figure is derived from logged
  sessions and an append-only review log at render time — no stored/denormalised status
  that can go stale — with hand-rolled SVG charts (no charting dependency).
- _[Phase 4] Ran v1 on a free-tier model (Gemini) behind a provider-agnostic gateway
  with tier-based routing, prompt caching, and per-user caps; measured token usage +
  cache hit-rate and **projected ~X% inference-cost reduction at paid-tier rates** —
  fill X in once measured. (Honest form: the free tier's real dollar cost is ~$0; the
  X% is the projected saving if/when it moves to paid.)_
- Enforced hard per-user daily AI caps and auth-gated inference routes to keep a
  usage-metered bill predictable.
- Built a layered test suite — Vitest for pure logic (77), Playwright E2E for the
  security/RLS/quota paths (31: server-enforced quota, cross-user isolation, auth
  gating, session integrity) — which caught a floating-point threshold bug that
  mislabelled on-track users as behind, and three false-alarm regressions that were
  actually test-harness bugs.

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
- **Why `(user_id, due_at)` composite index, in that column order [Phase 2 — built].**
  The query is `where user_id = $me and due_at <= now() order by due_at asc`. A B-tree
  is sorted by its **leading** column first, so putting the **equality** predicate
  (`user_id`) first lets Postgres seek straight to the contiguous block of rows for one
  user. Within that block the rows are already ordered by `due_at`, so the **range**
  predicate (`due_at <= now()`) is a walk from the start of the block until it stops
  matching — and because that walk emits rows in `due_at` order, the `ORDER BY` is
  satisfied for free (no sort node).
  - _"What if you flipped it to `(due_at, user_id)`?"_ → the index would be sorted by
    date across **all users**, so serving one user means scanning every user's due rows
    in that date range and filtering — the work grows with total traffic instead of with
    my own queue. Rule of thumb: **equality columns before range columns**, and the
    range column last so it can also serve the sort.
- **How RLS and the index interact [Phase 2 — built].** RLS isn't a post-filter — the
  policy predicate (`user_id = auth.uid()`) is injected into the query and planned like
  any other `WHERE` clause. So the policy itself is what supplies the `user_id` equality
  the index needs; RLS and the index reinforce each other rather than fighting. That's
  another payoff of denormalising `user_id` onto every table: if the policy had to join
  to a parent to find the owner, that join would run per row and the clean index seek
  would be gone.
- **"Why not compute due-ness in app code?" [Phase 2 — built].** Because it turns an
  index seek into "fetch every card and filter in JS" — O(all my cards) transferred per
  page view instead of O(cards actually due). Due-ness is a *predicate over stored data*,
  which is exactly what a database is for; the app would also have to re-derive it on
  every read and stay consistent about UTC. Keeping it in SQL means one definition of
  "due", enforced at the only layer that sees all the rows.

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

### 4b. Spaced-repetition algorithm [Phase 2 — built]

- **The algorithm, derived from scratch.** Each card stores three numbers:
  `repetitions` (how many times in a row it's been recalled correctly), `interval_days`
  (the current gap), and `ease` (how easy *this* card is for *this* user — starts 2.5,
  clamped 1.3–2.8).
  - **Correct:** `repetitions` climbs one rung of a fixed ladder — **1d, 4d, 14d, 30d** —
    and the interval is `ladder[rung] × (ease / 2.5)`, so ease stretches or compresses
    the nominal gap. Past the top rung there's no ladder left, so it becomes pure
    multiplicative growth: `previous_interval × ease` (that's SM-2's steady state).
    Ease moves **+0.1**.
  - **Wrong:** hard reset — `repetitions = 0`, `interval = 1` (see it again tomorrow) —
    and ease takes a **−0.2** penalty that **persists through the reset**. That
    persistence is the whole point: the card remembers it's hard for you, so it
    re-climbs the same ladder with smaller multipliers than a fresh card would.
  - `due_at = now + interval_days`, computed **server-side in UTC** with epoch-millisecond
    arithmetic (not calendar `setDate`), so a "day" is always 24h and never drifts an
    hour across a DST boundary.
- **Why this cadence rather than pure SM-2** (the decision I flagged as open, then
  closed). Two honest reasons, and I'd lead with the second:
  1. The product's UI **advertises** `+1d +4d +14d +30d` to the user. Textbook SM-2
     produces 1, 6, then ×ease → ~15, ~38 — so shipping literal SM-2 would have meant
     either the UI lying about the cadence or redesigning a screen the design already
     settled.
  2. More fundamentally, **SM-2's ease formula is driven by a 0–5 quality grade**, and
     Prep self-grades **binary** (Got it / Missed) on purpose — a 6-point self-assessment
     is exactly the kind of false precision that makes people rate themselves generously.
     With a binary grade, SM-2's ease update collapses to two cases anyway. So "pure
     SM-2" wasn't really available in its meaningful form.
  I kept the ladder the product promises, kept the per-card adaptivity that makes SM-2
  actually work, and I describe it as **a justified variant — not as SM-2**. Claiming to
  have "implemented SM-2" when the intervals aren't SM-2's would be the kind of thing an
  interviewer catches in one follow-up question.
- **"Why not the bare fixed ladder, then?"** → it isn't adaptive: every card at the same
  rung behaves identically no matter how much *you personally* struggle with it, and it
  wastes the `ease`/`repetitions` columns. The ease modifier is what makes two users'
  schedules for the same question diverge based on their actual performance.
- **"Why implement it yourself instead of a library?"** → it's ~40 lines of arithmetic
  and it's the single most interesting piece of logic in the app; a dependency would hide
  the one part worth talking about. It's also written as a **pure function with `now`
  injected** — no clock reads, no DB — which is what makes the DST/UTC behaviour
  assertable in unit tests at all (18 of them). Purity here was a testability decision,
  not an aesthetic one.
- **What a "wrong" grade does, and why reset all the way to +1d.** It drops a card from
  a 78-day interval straight back to tomorrow. That's deliberate product honesty
  (Rule 17): **"close enough" counts as a miss**, and there is no third button. If a
  near-miss let you keep a 30-day interval, the schedule would quietly drift toward
  "cards I *think* I know", which is precisely the failure mode spaced repetition exists
  to prevent. The persisting ease penalty means repeated misses compound — the card keeps
  coming back sooner than its rung suggests.
- **Where the enforcement lives.** Grading goes through a **server route**
  (`/api/recall/[cardId]/grade`), not a client write — even though the card is the user's
  own row and RLS already protects it. RLS answers "may this user write this row?"; it
  cannot answer "is this the number the algorithm would have produced?" A client
  computing its own `due_at` could post a 10-year interval and opt out of the retention
  loop entirely. So the split isn't owned-vs-not-owned; it's **whether the value is
  derived from a rule the product must guarantee.**

### 4b-i. The honest progress dashboard [Phase 3 — built]

**The one-liner:** every number on the Progress screen is derived from rows at render
time — hours from `study_sessions`, accuracy from the append-only `recall_reviews` log,
status from a pure function — so the dashboard structurally *cannot* flatter you.

- **The design decision worth leading with: pace is measured in whole elapsed weeks,
  not a continuous fraction.** `expectedHoursByNow = min(floor((now − created_at)/7d),
  weeks_count) × (hours_planned / weeks_count)`. Two consequences fall out of that
  `floor`, and both are product decisions rather than arithmetic conveniences. **(a) A
  brand-new roadmap expects zero hours, so it cannot be "behind" on day one.** Prorating
  by the hour would put a red BEHIND PACE banner in front of someone three hours after
  they made a plan — technically defensible, useless in practice, and it would train
  people to ignore the banner. **(b) The `min` cap** means an abandoned 5-week plan is
  "19 hours short", not "500 hours short" — the number stays actionable instead of
  growing without bound. The unit is weeks because the *plan* is authored in weeks, with
  week-sized kill criteria: a person is "a week behind", never "0.42 weeks behind".
- **Status is computed on read; the `roadmaps.status` column is deliberately dead.**
  This is the part interviewers push on, because a status column is the obvious design.
  The problem: nothing naturally *writes* it. A roadmap decays into "stalled" through
  **the passage of time**, not through a user action — so a stored status would only
  refresh when you touched the roadmap, i.e. it would be stale exactly when it mattered,
  and keeping it honest would need a cron job. Deriving at render time can't go stale
  and is a pure, unit-testable function. The cost I paid explicitly: Library, Roadmap and
  Progress all have to call the same function, so I switched all three in the same change
  rather than leaving two screens rendering `'fresh'` forever while Progress told the
  truth. A test sets `status='done'`/`hours_logged=999` directly in the DB and asserts
  every screen ignores them.
- **The ordering inside `deriveStatus` is load-bearing:** done → fresh → stalled →
  behind → ontrack. The subtle branch is *fresh*: "nothing logged" is only `fresh` while
  **nothing is expected yet**. Once hours were owed and none were logged it's `behind` —
  an untouched two-week-old roadmap is failing, not new. Getting that backwards would
  make the most common failure mode invisible, which is the exact vanity-metric trap
  Rule 19 exists to prevent.
- **Week attribution is by topic, not by calendar** — a session fills a week's bar via
  `topic_id → topics.week_id`, not by when it was logged. That's what makes a "Week 3
  hasn't started" blocker *literally* true rather than merely suggestive: under calendar
  attribution a week's bar could be full while that week's topics were untouched, so the
  chart would contradict the blockers list sitting directly beneath it. **The cost I
  accept and surface rather than hide:** unattributed sessions count toward total hours
  but fill no bar, so the bars can legitimately sum to less than the headline number. I
  assert that in a test so it can't later be misread as a bug.
- **Where the enforcement lives.** Logging goes through `/api/sessions`, not a client
  write, for the §4b reason extended one step: RLS answers "may this user write this
  row?" but not "**is this row coherent?**" A direct client write could attach minutes to
  a topic from a *different* roadmap — the user's own topic, so RLS is satisfied — and
  silently corrupt the per-week bars the entire screen derives from. The route re-derives
  ownership of both the roadmap *and* the topic, validates `minutes` as an integer in
  `[1,1440]`, and a CHECK constraint backstops it at the column. `logged_at` is always
  the server's `now()`, so a client can't backdate a history that makes them look
  on-pace.
- **Charts are hand-rolled SVG** (Rule 22) — the accuracy trend is a `<polyline>` plus
  gridlines and about twenty lines of coordinate math; the hours bars are styled divs.
  No charting dependency for two rectangles and a line. The y-axis is clipped to 40–100%
  deliberately: a 0-based axis squashes real recall accuracy into the top third and hides
  exactly the movement the chart exists to show.
- **The trend is bucketed by review *count*, not by calendar day.** Study is bursty, so
  day-buckets are mostly empty gaps; "your last N reviews" is a dense series that
  actually shows whether accuracy is climbing. Below one full bucket the UI shows an
  empty state instead of a misleading two-point "trend", and a <5-point wobble is
  labelled **flat** rather than dressed up as progress.

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
| Why no charting library (Recharts, Chart.js)? | The two charts are a `<polyline>` with gridlines and a row of proportional bars — roughly twenty lines of coordinate math. A charting lib would add a dependency, a theming layer fighting my OKLCH tokens, and bundle weight, to draw two rectangles and a line. I'd reach for one at the point I need axes, zoom, or tooltips I don't want to own. |
| Why is `roadmaps.status` a dead column instead of the source of truth? | Because nothing naturally writes it. A roadmap decays into "stalled" through the *passage of time*, not a user action — so a stored status only refreshes when you touch the roadmap, meaning it's stale exactly when it matters, and keeping it honest needs a cron. Deriving on read can't go stale and is a pure unit-testable function. The cost is that three screens must call the same function, which I did in one change so they can't disagree. |
| Why measure pace in whole weeks instead of exact elapsed time? | The plan is *authored* in weeks with week-sized kill criteria, so "a week behind" is the meaningful unit. Flooring also means a fresh roadmap expects zero hours and can't be flagged behind on day one — prorating by the hour would show a red banner three hours after someone made a plan, which trains people to ignore the banner. |
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

**"Floating-point told an on-track user they were behind." [Phase 3] — the best
*correctness* story, and the one to tell if they ask about a subtle bug.**
- _Symptom:_ A unit test on the behind-pace threshold failed. A user who had logged
  **exactly** 9.6 hours against an expectation of 12 was classified **behind pace**
  instead of on track.
- _What I assumed:_ an off-by-one in the threshold — that I'd written `<=` where I
  meant `<`, or picked the wrong ratio.
- _Actual root cause:_ IEEE-754. The rule is "behind if `logged < expected × 0.8`", and
  `12 * 0.8` does not evaluate to `9.6` in binary floating point — it's
  **`9.600000000000001`**. So `9.6 < 9.600000000000001` is `true`, and the user was
  behind pace by **1.8 × 10⁻¹⁵ hours**. I'd rounded the *logged* total to one decimal
  place but compared it against a *raw* computed threshold — two values that should be
  equal, compared at different precisions.
- _Fix:_ round the threshold to the same 1dp as the value it's compared against. Not an
  epsilon nudge — that just relocates the arbitrary line somewhere less obvious, and
  you'd have to justify the epsilon. Two regression tests pin it: the exact boundary,
  plus a "still behind a hair below" case proving the fix didn't merely widen the
  threshold into meaninglessness.
- _Why it's worth telling:_ it's a **user-visible honesty bug in the one screen whose
  entire purpose is honesty** — it flips a green "On track" chip to a red BEHIND PACE
  banner for someone who did exactly what they planned, and it would have been almost
  impossible to report ("sometimes it says I'm behind when I'm not"). It was caught by a
  test only because the aggregation is a **pure function with `now` injected** — the same
  design choice made for the scheduler. Untestable clock-reading code would have shipped
  it.
- _The class-level lesson:_ **when a comparison decides something a user reads as a
  verdict, round both sides to the same precision.** A derived comparison value is as
  much a floating-point hazard as the value being compared — I'd been careful about one
  side and not the other.

**"My test said the app was insecure. The test was wrong." [Phase 2] — the best
*process* story, and the one to tell if they ask about testing or debugging.**
- _Symptom:_ A new E2E case asserted that an **unauthenticated** POST to the grading
  route is blocked. It came back **200 OK**. On its face: a Rule-1 violation, an
  unauthenticated write path into the database.
- _What I assumed — and deliberately did not act on:_ the obvious move is to "fix" the
  auth gate. I'd been burned twice before by exactly this shape (two Phase 1 failures
  that were also the harness lying), so the rule I now follow is: **when a test claims
  the app is broken, reproduce it outside the test harness before touching app code.**
- _How I diagnosed it:_ `curl`, no cookies, against a clean dev server on a free port →
  **307 redirect to `/login`**. The gate was working perfectly. So the bug had to be in
  the test.
- _Actual root cause:_ two independent Playwright footguns stacked. (1) `request.newContext()`
  **inherits the project's saved session**, so an "anonymous" request isn't anonymous
  unless you pass an empty `storageState` — I'd handled that one. (2) The one I missed:
  Playwright **follows redirects by default**, so it chased the 307 to `/login`, which
  renders fine and returns **200**. The "success" I was seeing was the login page's HTML.
  Fix: `maxRedirects: 0`, and assert on the 307 + its `Location` header.
- _The second failure in the same run, different cause:_ five other tests timed out with
  "no cards found". I probed the DB (zero cards), the seed function in isolation (correct,
  13 cards), then the real route end-to-end (**201, 13 cards rendered**) — so generation
  was fine. The actual cause was **two roadmaps left over from a previous run** pushing
  the test user to the 3-roadmap quota, so every generate call returned **403**, and an
  empty queue *looked* like a rendering bug.
- _What I changed to prevent the class:_ (a) test fixtures now **assert their own
  preconditions** — the seeding helper requires a `201` and fails with an explicit
  "quota full — leftover roadmaps from a previous run" message, so that failure can never
  again be misread as a failure of the thing under test; (b) both Playwright gotchas are
  written into the spec's header comment and the bug log so the next person (me, in three
  months) doesn't rediscover them.
- _Why it's a good story:_ the headline isn't "I fixed a bug" — it's **"I correctly
  concluded there was no bug."** It shows I can tell a broken system from a broken
  measurement, which is the more valuable instinct, and that a misleading test failure is
  itself a defect worth fixing (an unreliable signal is worse than no signal).

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
