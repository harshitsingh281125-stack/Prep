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

- **2026-08-14 · Phase 4.5: the RAG similarity floor is 0.64, re-measured after the
  corpus grew — and a BROADER CORPUS SHRINKS THE SAFETY MARGIN.** The floor started
  at an intuitive 0.55 (wrong — see the bug log), was measured to 0.62 against a
  48-document frontend corpus with a margin of 0.052, and was re-measured at 202
  documents across 26 areas: the best off-domain score had risen from 0.568 to
  **0.616**, leaving 0.62 with a margin of **0.004**. **Why it moved:** the more the
  corpus covers, the more of the world is genuinely *adjacent* to something it
  holds — the 0.616 was "SwiftUI view lifecycle" against react.dev's "Lifecycle of
  Reactive Effects", which is not an absurd match at all, and that is exactly the
  problem. Raised to **0.64** (margin 0.024). **The cost was measured, not
  assumed:** across 189 real topics, 182 still ground on 2+ documents, 6 fall to
  one and 1 to none; the matches removed were fifth-place tails ("debounce /
  throttle" → AWS backoff-with-jitter at 0.630), i.e. precisely the weak links that
  would otherwise render with a green VERIFIED chip they had not earned. **The
  generalisable point: a similarity threshold is not a constant of the model, it is
  a property of the model-and-corpus pair, so growing the corpus is a change that
  requires re-calibration** — which is why `npm run probe:retrieval` is a checked-in
  script that exits non-zero rather than a number in a comment.

- **2026-08-14 · Phase 4.5: corpus coverage is a maintained property, not a
  milestone — hence `npm run probe:coverage`.** The corpus grew 48 → 83 → 118 → 202
  documents across four migrations, and every expansion was driven by *measuring
  against real generated roadmaps* rather than by intuition. The original curation
  was done against `lib/seed/catalog.ts`, i.e. the SEED topic names — but the seed
  is only the Rule 9 fallback, and the normal path is an AI-generated roadmap whose
  topics range far wider. Result: 52/64 coverage on the first real roadmap, and
  later 56 MISSING + 17 THIN out of 189 once the user's roadmaps moved into backend
  and DSA. **THIN (exactly one weak match) is tracked separately from MISSING
  because it is the more dangerous state:** a miss is labelled UNVERIFIED and is
  honest, whereas one weak match renders as a vetted link with a green VERIFIED chip
  on the wrong document ("Circuit Breaker Pattern" → *Martin Fowler: Micro
  Frontends* @ 0.622). The workflow is now: `npm run probe:coverage` → paste its
  output → curate a migration with every URL HTTP-verified → apply → `npm run
  embed:corpus` → `npm run probe:retrieval`. **Across 202 curated URLs the
  verification step caught 1 dead link, 13 silent redirects (MDN reorganised its
  entire CSS section mid-phase; the AWS Builders Library moved domain) and 2 pages
  that 403 automated clients** — every one of which would have shipped as a
  "vetted" link on the strength of my confidence alone.

- **2026-08-13 · Phase 4.5: `resources` is NOT "the table without RLS" — that plan
  was a security hole, and the corrected shape is RLS-on with a `true` read
  predicate.** Rules.md 5 and Architecture §5b both promised "the one table
  *without* RLS (reads public-safe, writes server-only)". Implementing that
  literally would have been wrong: **on Supabase every table in `public` is granted
  select/insert/update/delete to the `anon` and `authenticated` roles by default,
  and RLS is the thing that narrows those grants.** So "no RLS on a public table"
  does not mean read-only — it means **world-writable with the anon key**. Anyone
  could have POSTed a row into the vetted corpus, i.e. chosen which links Prep
  vouches for, which is the precise opposite of what the phase exists to do. **What
  shipped instead:** `enable row level security` + `for select using (true)` + **no**
  insert/update/delete policy, so RLS denies every client write; curation happens via
  migrations and the service role. Plus a redundant `revoke insert, update, delete
  … from anon, authenticated` in case a later migration copy-pastes a `for all`
  policy from a sibling table. **The exception to Rule 5 is therefore narrower than
  advertised: it is the one table with no `user_id` PREDICATE, not the one table with
  no RLS** — same two-axis shape as `ai_usage` (Phase 4), with the read scope widened
  from "own rows" to "everyone" because the data is public rather than personal.
  Pinned by E2E RAG-07…10 and manual SEC-01…05. **Generalisable lesson: "no policy"
  is not a safe default anywhere the framework grants by default — absence of a rule
  is only restrictive if the baseline is deny.**

- **2026-08-13 · Phase 4.5: the model is never asked for a URL — it cites documents
  by INDEX.** The obvious design (and what Architecture §5b originally described) was
  a schema requiring that "resources must be selected from the provided list", then
  validating that every returned URL appears in the retrieved set. What shipped is
  stronger: `GROUNDED_DETAIL_SCHEMA` has no `url`, `title` or `tag` field at all —
  the model returns `{ ref: <1-based index into the documents we supplied>, why }`,
  and the validator resolves each `ref` back to **our** row. **Why it matters:** a
  hallucinated citation is not *rejected*, it is **unrepresentable**. The only thing
  left to check is that an integer is in range. This is the same move as "the model
  writes content, not contract" from Phase 4 — *don't validate away a failure you can
  make impossible to express* — and it is the sharper version of the same idea,
  because there the model could still return a wrong number and here it cannot return
  a URL at all. The accepted cost, stated honestly rather than hidden: the model can
  no longer suggest a genuinely good resource that isn't in the corpus. For a study
  tool whose users will click the links, a short list of real documents beats a longer
  list where some fraction is fiction.

- **2026-08-13 · Phase 4.5: retrieval is gated by a similarity FLOOR, not by a
  `topic_area` filter.** Architecture §5b specced "top-k filtered by `topic_area`",
  which would have needed a keyword map from a generated topic name to a corpus tag.
  **Decision: drop the filter, keep the floor.** The floor is what actually does the
  work: a plain top-k always returns k rows however irrelevant, so without it a topic
  the corpus knows nothing about would come back with five confident links and the
  Rule 9 "empty retrieval → generated/unverified" branch would be unreachable in
  practice. Filtering by area on top would add ~30 lines of keyword classification and
  a new failure mode (a misclassified topic silently excludes the right documents) to
  solve a problem the embedding already solves — cross-domain bleed shows up as a low
  score, which is exactly what the floor rejects. `topic_area` is still stored, for
  curation and for reading the probe output; it is just not a query predicate.

- **2026-08-13 · Phase 4.5: embedding width is 1536, and the reason is pgvector, not
  quality.** The open question ("confirm the output dim from a real `embed()`
  response") was answered by probing the live endpoint: `gemini-embedding-001` returns
  **3072** dimensions natively at unit length, and honours `outputDimensionality` to
  truncate (1536 → L2 norm 0.7023; 768 → 0.5947, i.e. **truncated vectors are not
  normalised**). We use 1536 anyway because **pgvector cannot build an HNSW or IVFFlat
  index on a `vector` wider than 2000 dimensions** — at 3072 the choice would be a
  sequential scan forever or `halfvec` at half precision. 1536 is a Matryoshka (MRL)
  truncation, so the leading dimensions carry most of the signal. The backfill
  normalises the truncated vectors: under `vector_cosine_ops` this changes nothing
  (cosine divides magnitudes out, so ranking *and* the floor are scale-invariant), but
  it removes a trap for the day someone switches the opclass to inner-product or L2.
  `EMBEDDING_DIM` and the `vector(1536)` column are checked against each other at
  runtime by the gateway, so a mismatch is caught at the boundary instead of by
  Postgres rejecting an insert halfway through a backfill.

- **2026-08-13 · Phase 4.5: the corpus backfill bypasses the daily cap deliberately,
  but still meters.** `scripts/embed-corpus.ts` injects `countToday: () => 0`.
  **Why that isn't a hole:** Rule 3's cap protects a *user's* share of the provider
  quota; a corpus backfill is one bounded operator action run by whoever already holds
  the service-role key, whose size is fixed and visible in a checked-in migration (48
  embeddings). Letting a 25/day user cap govern it would mean the corpus could only
  ever be half-embedded — and half a corpus is worse than none, because retrieval
  would silently return only whatever happened to be embedded first. **Rule 11 is NOT
  bypassed:** every embedding still writes an `ai_usage` row, attributed to
  `CORPUS_EMBED_USER_ID` (it has to be a real `auth.users` id — FK), so total provider
  spend stays honest. The understood consequence: use your own admin account, not a QA
  account whose `/usage` readout you want clean.

- **2026-08-08 · Phase 4 `ai_usage` is the one user-owned table the user may NOT
  write — RLS is SELECT-only, inserts go through the service role.** Every other
  table in this schema carries the flat `for all using (user_id = auth.uid())`
  policy. `ai_usage` deliberately does not. **Why:** the hard daily cap (Rule 3) is a
  `COUNT` of these rows, so a `for all` policy would let any signed-in browser run
  `DELETE /rest/v1/ai_usage` with the **anon** key and reset its own cap to zero —
  the cap would be advisory, which is precisely what Rule 3 says it must not be. So
  the owner gets `for select` only (they need to read their own readout), and the
  gateway inserts via `lib/supabase/admin.ts`, which bypasses RLS by design. **The
  generalisation, one step past Phase 2/3's rule-of-thumb:** a row can be *about* a
  user without being *theirs to write*. Ownership decides who may READ; whether the
  value enforces a product rule decides who may WRITE. **The service-role client is
  typed against only `ai_usage`** (not `any`), so reaching for it to dodge an
  inconvenient RLS check on another table is a compile error rather than a
  code-review catch, and `import "server-only"` makes leaking it into a client
  bundle a build failure. Pinned by E2E AI-17/18/19/20 and manual SEC-03/04/05.

- **2026-08-08 · Phase 4: the model writes CONTENT, not CONTRACT.** The roadmap
  generator is never asked for `weeks_count`, hours-per-week, or week numbers — the
  JSON schema doesn't contain those fields at all. They're computed server-side from
  the user's onboarding answers (`planContract()`) and stamped onto the validated
  result; week numbers come from array position. **Why:** "8 weeks at 10h" is a
  promise the user made to themselves, and the entire Phase 3 pace dashboard divides
  by exactly those numbers — if the model returned 6 weeks because it felt tidier,
  every pace figure downstream would silently be measuring against a plan the user
  never chose. **Validating** the numbers would only *catch* that; **not asking** for
  them makes it impossible. Cheap side benefit: fewer output tokens. It is also what
  makes the seeded fallback a genuine drop-in — both paths produce a plan with the
  same contract, so falling back can't change the shape of the user's plan.

- **2026-08-08 · Phase 4: topic detail is generated on demand, and roadmaps ship
  with NO seeded detail.** Phase 1 pre-filled every topic's `detail` from the
  catalog at creation time. Phase 4 sets it to `null` on **both** the AI and the
  seed path; the Topic screen shows an empty state with an explicit **Generate with
  AI** button. **Why not auto-generate on first open:** a roadmap has 15–25 topics,
  so browsing one would spend 15–25 calls and exhaust the 25/day cap before the user
  studied anything — and it would put an AI call inside a server-component render.
  **Why not keep the seeded detail as a starting point:** then the AI path and the
  fallback would produce visibly different trees (pre-filled vs empty), the fallback
  would stop being a drop-in, and there'd be no way to see what generation actually
  added. The seeded template didn't disappear — it moved to `lib/seed/detail.ts` and
  became the Rule 9 fallback for `/api/topics/[id]/detail`, which is a more useful
  job than being a default nobody asked for.

- **2026-08-08 · Phase 4: one `ai_usage` row per provider DISPATCH, not per user
  action — and failures are metered too.** A generation that came back malformed,
  was retried, and then fell back to the seed writes **two** rows (`status`
  `invalid` then `ok`/`invalid`, `attempts` 1 then 2). **Why per dispatch:** the cap
  exists to protect the provider's quota, and the provider counts requests, not
  intentions. **Why meter failures:** metering only successes would make the cap
  under-count *exactly when a broken model is burning the most quota* — the moment
  it matters most. It also makes the fallback rate a visible number on /usage rather
  than an invisible degradation. Consequence handled deliberately: the cap is
  re-checked **before the retry**, so a user sitting on the boundary can't step over
  it by way of a malformed first response (unit-tested).

- **2026-08-08 · Phase 4: `cost_usd` stores what was ACTUALLY charged; the paid-tier
  figure is derived at read time and never stored.** On the free tier that column is
  `0` on every row. The "$/roadmap" and "projected cost" numbers on /usage are
  computed in `lib/ai/cost.ts` from the token columns × a rate card, at render time.
  **Why:** same reasoning as Phase 3 deriving roadmap status — a stored projection
  goes stale the instant the rate card or the model binding changes, and a column
  named `cost_usd` holding a number nobody was charged is a fiction waiting to be
  quoted in an interview. The readout shows both side by side and says in prose that
  the charged column is $0.00. **This is the honest form of the "cut inference cost
  X%" bullet:** a projection computed from real token counts, never a claimed
  free-tier saving. (`AI_BILLING_MODE=paid` switches `cost_usd` to the computed cost
  once billing is real.)

- **2026-08-08 · Phase 4: the mock provider is a first-class adapter, and the E2E
  suite runs against it.** `AI_PROVIDER=mock` selects a deterministic adapter with
  injectable failure modes (`AI_MOCK_MODE=ok|malformed|malformed-once|error`).
  **Why it isn't a test hack:** (1) Architecture §5 always planned a local-dev
  provider so the app is exercisable with AI off; (2) the retry and fallback paths
  are otherwise only reachable by getting lucky with a bad generation, so the QA
  matrix could assert they *exist* but never that they *work*; (3) a suite that goes
  red because a third party is down teaches you nothing — which stopped being
  hypothetical on day one of this phase (see the bug log). The mock still goes
  through the entire gateway, so caps/validation/retry/metering are all genuinely
  under test; only the vendor wire format isn't, and that's what manual suite LIVE
  is for. It reports estimated token counts for text it really handled and is priced
  at $0, so it can never invent spend in the readout.
  **Related:** `AI_DAILY_CALL_CAP` was made env-overridable (default 25) because a
  full E2E run makes well over 25 dispatches and would otherwise exhaust its own cap
  partway through, turning every later spec red for a reason unrelated to what it
  tests. The cap's *logic* stays exactly covered by unit tests; its *live* behaviour
  is manual suite CAP.

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
  *(Historical record of the decision as taken. **Refined by the 2026-08-08/08-12
  entries above** — the concrete ids are `gemini-3.5-flash` / `gemini-3.5-flash-lite`
  / `gemini-embedding-001`; "recall grading" below never shipped as an AI call, the
  frequent classification-tier call is recall-CARD generation; and the free tier
  proved unreliable, not merely rate-limited. Read this entry as "what we decided
  then", not as current state.)*
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
  *(Historical. **Closed 2026-07-28** — Gemini; built and live in Phase 4.)*
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

- **2026-08-27 · Print/export is `window.print()` on a dedicated route, not a
  generated PDF file.** (Phase 5.) `/roadmap/[id]/print` renders a light-only,
  print-optimised document; a button calls `window.print()`. The browser's own
  pipeline already does pagination, page size, margins, headers and Save-as-PDF on
  every platform. The alternatives both cost more than they return: headless
  Chromium does not fit a Vercel serverless function, and a PDF library means
  re-implementing layout by hand. **What we give up, stated plainly:** we cannot
  hand the user a file directly — they go through the print dialog — and we do not
  control the final pagination, only influence it with `break-inside: avoid`.

- **2026-08-27 · The print view lives in a SIBLING route group, `(print)`, not
  inside `(app)` with print-CSS hiding the chrome.** (Phase 5.) Two reasons, both
  structural rather than aesthetic: `(app)/layout.tsx` sets
  `height:100vh; overflow:hidden`, which clips a multi-page document to one
  screenful; and the on-screen preview would render in the user's dark theme, so
  what you saw would not be what you got. Route groups contribute no URL segment,
  so `/roadmap/[id]/print` — the path Architecture has specified since Phase 0 —
  is unchanged. Documented in nextjs-tutorial §20.

- **2026-08-27 · The print view recomputes nothing.** (Phase 5.) It imports the
  same `lib/progress/compute.ts` functions the dashboard uses. A second
  implementation of "hours logged" would eventually disagree with the first, and
  the print-out is the copy that gets carried into a room and quoted — so it is the
  worst possible place for a divergent number. The only new logic is
  `lib/print/schedule.ts` (bucketing recall cards by **UTC calendar day**, Rule 15,
  pure with `now` injected).

- **2026-08-27 · Raw hex in the print stylesheet, and a STYLESHEET at all.**
  (Phase 5.) Rule 21's single stated exception, used for the first time. Print
  colour management is not the screen pipeline, `print-color-adjust` support is
  uneven, and paper has exactly one theme — a page inheriting `--bg` prints the
  dark theme as a black rectangle. Separately, this is the app's only
  class-and-stylesheet surface rather than inline styles, because `@page` margins
  and `break-inside` **have no inline form at all**.

- **2026-08-27 · Mobile: CSS-only, sidebar → top bar. No drawer.** (Phase 5.)
  Under 860px the shell stacks and the 244px sidebar becomes a horizontal top bar;
  the 4-up stat grids collapse to 2-up then 1-up. An off-canvas drawer would add a
  JS state machine plus focus trapping, escape handling, `aria-expanded` and scroll
  locking — a real accessibility surface — to hide **four links that fit on one
  row**. The `height:100vh; overflow:hidden` frame is also dropped at that
  breakpoint: on a phone the app must scroll as one document, or the inner scroll
  area fights the browser's URL-bar collapse and you get two nested scrollbars.
  This also forced the app's first class-based CSS: an inline `style` attribute
  cannot express a media query, a pseudo-class, or a print rule.

- **2026-08-27 · The 404 never says "forbidden".** (Phase 5, `app/not-found.tsx`.)
  Two different things land there: a URL matching no route, and an RLS-scoped query
  that returned nothing — which in Prep almost always means *"that row exists but
  is not yours"*. The copy deliberately does not distinguish them, because saying
  "you don't have access" would confirm to a stranger that a given roadmap id is
  real. RLS already collapses "not yours" into "no rows"; the UI must not
  un-collapse it. An indistinguishable 404 is a security property here, not tidy
  copy.

- **2026-09-02 · The Roadmap screen's content markers read `detail->>source`, not
  `detail`.** (Phase 5 follow-up.) Each topic row shows whether its study material
  exists and how grounded it is (VETTED / AI / TEMPLATE / NO CONTENT), plus an
  `n/total studied` count per week, so "what have I actually generated?" is
  answerable without opening every topic.
  **The non-obvious part is the query.** `topics.detail` is a jsonb blob holding a
  mental model, 2–5 resources and 2 exercises; selecting it for 25 topics to
  answer a one-word question would ship tens of KB per roadmap render. PostgREST
  can extract a single key server-side — `detailSource:detail->>source` — so the
  wire carries one short string per topic. Verified the syntax against the live
  API before trusting it, with a deliberately malformed select as a control to
  prove a 400 would have been visible.
  **Why `source` is a safe proxy for "has content":** all three write paths stamp
  it (`validate.ts` → 'rag' and 'ai', `seed/detail.ts` → 'seed'), so a null means
  "no detail yet" rather than "detail without a source". The column is not
  constrained to those values, though, so the UI narrows the string and treats
  anything unexpected as NO CONTENT — an unknown provenance is not a claim we can
  make about content. Same rule as `generated_from`'s NULL handling.
  **The ungenerated state is drawn, not omitted** (dashed, faint). An absent chip
  is invisible when you are scanning 25 rows for the topics that still need work,
  which is the entire question the marker exists to answer.

## Open questions (decide deliberately)

- ~~**[Phase 4] v1 model/provider per tier**~~ — **SETTLED 2026-07-28, CONFIRMED
  AGAINST THE LIVE API 2026-08-08.** `reasoning` = `gemini-3.5-flash`,
  `classification` = `gemini-3.5-flash-lite` (both verified present via
  `models.list` before a line of adapter code was written). Bound in
  `lib/ai/config.ts`, the only file naming a model. **Two things learned during the
  build that change the framing:** (a) the free tier is *unreliable*, not just
  rate-limited — see the outage in the infra log — so the honest claim is "runs at
  ~$0 with a paid-tier upgrade that's a config edit", not "free forever"; (b) if
  billing is enabled, Google's docs say paid-tier prompts/responses are **not** used
  to improve their products, which removes one of the two honesty caveats this
  decision originally carried.
- ~~**Scheduling algorithm cadence**~~ — **SETTLED 2026-08-06:** the design's fixed
  +1/+4/+14/+30 ladder as the backbone **plus** an SM-2 ease factor that stretches or
  compresses each rung (past the top rung it becomes pure `prevInterval × ease`). A miss
  hard-resets to +1d but the ease penalty persists. Chosen because textbook SM-2's
  intervals contradict the cadence the UI advertises, and because Prep's binary
  self-grade collapses SM-2's 0–5 ease formula anyway. See the settled-decisions entry
  above + `lib/recall/scheduler.ts`.
- ~~Roadmap JSON schema final shape (fields the generator must return).~~ —
  **SETTLED 2026-08-08:** `{ title, subtitle, weeks: [{ title, killCriterion,
  topics: string[] }] }` — and, more importantly, what it *deliberately omits*: no
  week numbers, no hours, no week count. Those are the user's contract, computed
  server-side. See `ROADMAP_SCHEMA` + `validateRoadmap` in `lib/ai/validate.ts` and
  the "content, not contract" decision above.
- ~~**Onboarding question wording / weak-area taxonomy / role scope**~~ —
  **SETTLED 2026-08-27 (Phase 5).** Shipped **`SDE-2 · Backend`** with backend weak
  areas, plus a durable **TEMPLATE MISMATCH** label for the case the seeded frontend
  catalog serves a backend candidate. The 2026-08-12 deferral said the three moves
  were coupled and the only options were "role-dependent options + honest labelling"
  or "author real per-role catalogs"; the first of those is exactly what was built.
  Weak areas were already role-dependent since Phase 4. **What is still NOT done:**
  there is no backend curriculum — the seeded fallback for a backend user is
  frontend content, correctly labelled rather than fixed. Authoring real per-role
  catalogs remains open and is still a phase of its own. See the reversal entry at
  the end of this file and Architecture §5c.

- Product name (still "Prep", a placeholder).
- When to revisit the v2 code-sandbox cut.
- ~~**[Phase 4.5] RAG corpus taxonomy + seed contents**~~ — **SETTLED 2026-08-13.**
  Seven `topic_area` tags, mirroring the catalog blocks and the role weak-area lists:
  `js-async`, `browser-rendering`, `react`, `frontend-system-design`, `performance`,
  `coding-craft`, `behavioral`. **48 entries** (5–8 per area), weighted to primary
  sources — MDN, the WHATWG HTML standard, react.dev, RFC 9111, web.dev — in
  `0008_resources_seed.sql`. Every URL was **fetched and confirmed 200** before being
  written into the migration, which caught one 404 and one redirect onto a URL already
  in the list. `topic_area` is a **curation/inspection tag only**; it is not a query
  predicate (see the floor-vs-filter decision above).
- ~~**[Phase 4.5] embedding output dim**~~ — **SETTLED 2026-08-13** from a live probe:
  `vector(1536)`, forced by pgvector's 2000-dim index ceiling. See the decision above.

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

- **2026-08-27 · Adding `loading.tsx` silently downgraded a 404 to a 200 — the
  cross-user security case went red for a reason that had nothing to do with
  security.** *(Phase 5. Caught by the automated suite, not by eye.)*
  **Symptom:** after adding `app/(app)/loading.tsx`, `rls.spec.ts` RLS-01 failed
  with `Expected: 404, Received: 200` — user B requesting user A's roadmap. Two
  other cases failed the same way (`CC-03`, deleting a roadmap then re-fetching it).
  A security test flipping to 200 reads like a breach.
  **What I assumed:** that I'd broken the RLS-scoped query by adding `answers` and
  `generated_from` to its `select`.
  **Actual root cause:** `loading.tsx` wraps its segment in a Suspense boundary,
  which makes the route **stream**. A streamed response has already flushed its
  HTTP headers — status **200** — by the time the async server component beneath it
  resolves and calls `notFound()`. So the 404 *page* rendered correctly and the
  *status code* was already committed. Nothing to do with RLS at all.
  **How it was established, not guessed:** bisected — moved `loading.tsx` aside and
  re-ran `rls.spec.ts` (3 passed); restored it (1 failed). The `(print)` route,
  which also calls `notFound()` and has **no** `loading.tsx`, passed its own 404
  cases throughout, which corroborated it from the other direction.
  **Was anything leaked? No — and I checked rather than reasoned.** I added body
  assertions to the failing test and re-ran: user B saw the "Nothing here." 404 page
  and none of A's content. So this was a wrong status code over a correct page — a
  real bug, but a cosmetic one, and it matters to say which.
  **Fix:** `loading.tsx` is no longer at the `(app)` group root. It sits on the four
  routes that can never 404 (`/library`, `/progress`, `/recall`, `/usage`), each
  re-exporting `components/shell/ContentSkeleton`. `/roadmap/[id]` and the topic
  route render blocking so `notFound()` can still set the status. **The rule, now
  written at every copy of the file: a route that can call `notFound()` must not
  have a `loading.tsx`.**
  **What I changed to prevent the class:** RLS-01 now asserts the **body before the
  status**. A status-only assertion cannot tell "wrong status code, correct empty
  page" from "user B is reading user A's roadmap" — a cosmetic bug and a
  catastrophe — and the weaker assertion was aborting the test before the stronger
  one ran. The important assertion should never sit behind the flaky one.
  **The honest cost:** the two slowest, heaviest routes are the ones that no longer
  get a skeleton. That is the trade — a correct 404 on a security surface beats a
  loading state — and it is worth stating rather than hiding.

- **2026-08-27 · A correct accessibility fix broke a passing test by making a
  selector ambiguous — and the test still "passed" its guard assertion first.**
  *(Phase 5.)*
  **Symptom:** `study-flow.spec.ts` TP-03/05/06 timed out after 60s waiting for a
  `PATCH /rest/v1/topics` that never arrived.
  **Root cause:** the test located the kill-criterion checkbox as
  `page.locator("button[aria-pressed]").first()`, which was only ever correct
  because it happened to be the **only** `aria-pressed` button in the document. I
  then gave the sidebar's theme toggle a correct `aria-pressed` (it is a toggle
  button; that is the right markup). The sidebar renders first, so `.first()`
  started matching the theme toggle.
  **The nasty part:** the test's own guard,
  `expect(killCheckbox).toHaveAttribute("aria-pressed", "false")`, **passed** — in
  the dark theme the theme toggle's `aria-pressed` is also `"false"`. So the guard
  designed to catch exactly this waved it through, and the test proceeded to click
  the theme toggle and wait forever for a database write.
  **Fix:** `data-testid="kill-criterion"` (plus an `aria-label`) on the checkbox,
  and the spec uses `getByTestId`.
  **Lesson:** a structural selector that depends on being unique in the whole
  document is a trap — it encodes an invariant nobody declared and nothing
  enforces, and it fails *later*, in an unrelated test, when someone adds correct
  markup elsewhere. This is the fourth instance in this project of the same shape
  as tests/README gotchas 1/4/6: **never identify a thing by a property that is
  only incidentally unique.**

- **2026-09-02 · `/usage` overflowed sideways on a phone, and three other screens
  were one CSS class short of the same bug — found by automating a manual case the
  owner had skipped.** *(Phase 5 QA gate.)*
  **How it surfaced:** the owner reported the manual matrix passed but, when asked
  case by case, said the RESP (mobile) suite had been skipped/glanced at. Rather
  than record "mobile unverified", the mechanically-decidable half was automated —
  did the shell stack, and does `document.scrollWidth > clientWidth` — and
  `RESP-C` immediately failed with `/usage overflows horizontally`.
  **Root cause:** the Phase 5 responsive pass added `.grid-4` / `.grid-2` hooks and
  applied them to the Progress and Roadmap screens **only**. A grep for
  `gridTemplateColumns` found four more that never got one: `/usage`'s 4-up stat
  grid and 3-up cost grid, Library's 2-up card grid, and — the two that actually
  overflow rather than merely crowd — the `1fr 300px` two-pane layouts on the
  Topic and Onboarding screens, whose 300px rail does not shrink.
  **Fix:** `.grid-3` and `.grid-side` added to the ≤860px block, and the class
  applied to all five. The rail stacks *under* the content on purpose: on Topic it
  holds resources and exercises, which are secondary to the mental model and the
  notes you came to write.
  **The lesson, which is about process not CSS:** a manual matrix is only worth the
  cases that actually get run, and the ones needing a second device are the ones
  that don't. Anything in a manual suite that a browser can decide *mechanically*
  ("does the page overflow") should be automated, leaving the matrix for what
  genuinely needs judgement (is it pleasant to use, are tap targets comfortable).
  Applying a CSS hook screen-by-screen also invites exactly this: the grep that
  found the gap should have been part of writing the feature, not of testing it.

## Deploy / infra facts

- **2026-08-08 · Gemini's free tier returned 429 "prepayment credits are depleted"
  for the whole first half of Phase 4 — a Google-side incident, not our config.**
  Every model (2.0 through 3.6, and embeddings) returned the same 429
  `RESOURCE_EXHAUSTED` on a project with **no billing attached and zero usage**.
  `models.list` returned 200, so the key was valid — only *billed* operations were
  blocked, which is what identified it as a billing-state problem rather than a code
  or auth one. Google's own forums carried multiple reports of the same thing on
  confirmed free-tier projects dated 2026-08-03…08-07, including one user who added
  a payment method and still saw it; no staff response, no workaround. It cleared on
  its own partway through the build (verified by re-probing: HTTP 200). **What we
  did with the time rather than waiting:** built the whole gateway provider-agnostic
  as planned, and added the mock adapter — so ~85% of the phase was unaffected. **The
  interview value is real and unplanned:** Rule 9 ("AI must never hard-block a flow")
  stopped being a design principle and got exercised against an actual multi-day
  provider outage, and the E2E suite was deliberately built so that *not one
  assertion depends on the provider being up*. **Practical lesson: verify a
  provider's health with a real call before building against it — a dashboard that
  says "Free" is a claim, a 200 is evidence.**

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

- **2026-08-14 · Phase 4.5 (harness): leftover rows from an ABORTED run presented as
  "the app got six times slower".** Symptom at the close of the phase: a suite that
  had been running 64/64 in 3.5 minutes took **20.5 minutes and failed 7 tests**
  across three spec files, every failure a 44s–1.1m timeout, and a *different* set of
  tests each run. That reads like a performance regression from the RAG work — an
  extra embedding plus a pgvector round trip on every topic-detail call. **Measured
  instead of assumed:** `/recall` rendered in 0.5s warm, memory and CPU had headroom
  (7.3 GB free, load 2.9 on 12 cores), and the app logged no errors. Running the
  failing specs alone then printed the real cause from the fixture's own message —
  **`Roadmap generation failed with 403`**. An earlier interrupted run had left three
  roadmaps behind, putting the test user at the 3-roadmap quota (Rule 18), so every
  `generateRoadmap()` 403'd and the specs sat waiting for cards and dashboard rows
  that were never created. Deleting the leftovers restored 64/64 in 4.8 minutes.
  **Why it was worth more than a cleanup:** `afterEach` cleanup is correct for runs
  that *finish*, and this project has now been bitten three times by runs that don't
  (Phase 2, and twice here). So the fix is structural, not another manual delete: the
  `setup` project now clears each QA user's roadmaps after login, through PostgREST
  under that user's own session so RLS scopes it to them. Verified by deliberately
  planting three leftovers and watching the suite self-heal (`[setup] cleared 3
  leftover roadmap(s) for user A`, then 64/64). **Lesson: per-test cleanup guarantees
  nothing about the run that crashed before it; a shared-DB suite needs a
  precondition it establishes, not one it inherits — and quota exhaustion is
  especially nasty because it surfaces as a timeout somewhere else entirely.**

- **2026-08-14 · Phase 4.5: my own calibration probe raised a false alarm, because
  its fixture went stale when the corpus grew.** After migration 0011 widened the
  corpus into backend/DSA/distributed systems, `npm run probe:retrieval` failed with
  *"FLOOR IS TOO LOW: raise it above 0.744"*. The 0.744 was
  `"Postgres query planner internals"` matching **PostgreSQL: Using EXPLAIN** — a
  perfect result. The probe's hard-coded `OFF_DOMAIN` list still contained Postgres
  and Kafka topics, which were genuinely off-domain against the original
  frontend-only corpus and had just been deliberately brought *in* scope. **The
  floor was fine; the test's definition of "outside the corpus" was a year out of
  date by the standards of a corpus that changes weekly.** Fixed by moving those
  entries to `IN_DOMAIN` and rewriting `OFF_DOMAIN` as topics from adjacent
  engineering disciplines the corpus has no business covering (Rust lifetimes,
  SwiftUI, Kubernetes CRDs, backpropagation, Unity shaders, embedded ISRs) — chosen
  so a future expansion is unlikely to invalidate them again. **Lesson: a
  calibration harness encodes an assumption about scope, so it is part of the thing
  being changed, not a neutral observer of it. When you widen what a system covers,
  the tests that assert what it does NOT cover are the first things to go stale.**

- **2026-08-13 · Phase 4.5: RAG was 100% broken against the real provider while both
  test suites were green — because my fixtures didn't look like real model output.**
  Symptom, reported by the user on the first real run: *every* resource showed the
  amber UNVERIFIED chip and no links, on a frontend roadmap the corpus covers well.
  **Diagnosed by reproducing the pipeline stage by stage rather than guessing**
  (the standing discipline): retrieval was fine — 18 of the user's 20 real topics
  cleared the 0.62 floor, and the RPC returned the *right* documents ("Event loop and
  task queues" → the MDN execution-model page, Jake Archibald's talk, the HTML spec).
  So the failure was downstream. Printing the raw grounded completion showed it
  immediately:

  ```
  ref=2  whyLen=223   ref=4  whyLen=212   ref=5  whyLen=206
  GROUNDED_LIMITS.whyMax = 90     -> validateGroundedDetail returns null
  ```

  **Root cause: a made-up constant.** I capped the resource caption at 90 characters
  because that felt like a caption length. Real `gemini-3.5-flash` writes 200–220.
  So every grounded generation failed validation, was retried (failing identically),
  and fell through to the ungrounded path — which is *exactly* the Rule 9 behaviour
  we designed, working perfectly, to hide a total feature failure. No error, no 5xx,
  no red test: the fallback made the bug invisible.

  **Why neither suite caught it — the part worth remembering.** The mock provider
  returned `why: "the primary reference"` (21 chars) and my unit fixtures used short
  strings I had written myself. **Both suites were testing my assumption about the
  output, not the output.** This is the same class as the Phase 4 single-topic-roadmap
  bug ("an acceptance test written from the same assumption as the code will happily
  ratify the bug"), and it is worse here because a *graceful* fallback swallowed the
  evidence. **A degradation path you cannot distinguish from success is a place bugs
  go to hide** — that is the general lesson, and it argues for the `source` label
  being visible in the UI, which is how the user spotted it at all.

  **Fix, in three parts, because raising the number alone would repeat the mistake:**
  (1) the right **failure semantics** — reject what is load-bearing (a `ref` outside
  the supplied range means the WRONG LINK), *normalise* what is cosmetic: `whyMax`
  becomes a generous 400 (a caption that long means the model answered a different
  question), and `condenseWhy()` trims to 110 chars on a word boundary for display.
  Throwing away a vetted link because its decoration was 30 characters too long is a
  terrible trade. (2) The prompt now demands **"AT MOST 12 WORDS"** — models follow
  explicit word counts far better than "short". (3) **The mock provider now emits
  ~200-character captions**, so a regression of this class goes red; plus three unit
  tests pinning the *verbatim* strings from the live response. Verified by re-running
  the real provider end to end: `ACCEPTED`.

- **2026-08-13 · Phase 4.5: the similarity floor I picked by intuition would have
  grounded backend topics on React documentation.** The RAG threshold started at
  `0.55` — a number that *sounds* strict for a cosine similarity, and is the value
  most tutorials use. Before trusting it I probed the real corpus with real Gemini
  embeddings (`scripts/probe-retrieval.ts`) using deliberately **off-domain** queries.
  Result:

  ```
  in-domain   "Reconciliation & keys"            0.761 … 0.642   (correct docs)
              "Event loop & microtasks"          0.749 … 0.688
  OFF-domain  "Postgres query planner internals" 0.568 … 0.562   ← ABOVE 0.55
              "Kafka consumer group rebalancing" 0.560 … 0.544
              "Kubernetes pod autoscaling"       0.555 … 0.534
  ```

  **Gemini's embeddings are not zero-centred:** two texts with nothing whatsoever in
  common still score ~0.55, so "similarity above a half" carries no information here.
  At 0.55 a Postgres topic would have retrieved five frontend documents, grounded on
  them, and rendered every one with a green **VERIFIED** chip — reintroducing exactly
  the failure the phase exists to remove, wearing the badge that says it was fixed.
  Nothing would have errored, no test would have gone red, and the corpus links would
  all have been real; they'd just have had nothing to do with the topic. **Fix:**
  floor raised to **0.62**, which sits above every off-domain score observed (max
  0.568) and below every genuinely relevant document (min 0.642) — margin 0.052 — and
  the probe is now a checked-in script that **exits non-zero if any off-domain query
  clears the floor**, so the calibration is re-checkable after any model or corpus
  change rather than being a number in a comment. **Lesson: a threshold on embedding
  similarity is a property of the model-and-corpus pair, not a universal constant.
  Calibrate it against queries you KNOW should fail — measuring only the cases you
  expect to pass tells you nothing about where the line goes.**

- **2026-08-13 · Phase 4.5: a security test had been passing by talking to the wrong
  server for two phases.** `quota.spec.ts` QT-06 ("an unauthenticated create is
  blocked") built its URL as `http://localhost:${process.env.PW_PORT ?? "3001"}` —
  but **3001 is the dev port**; Playwright's own test port has been **3101** since
  the Phase 4 fix. With `PW_PORT` unset (the normal case), the "anonymous request"
  test was therefore posting at whatever was listening on 3001 — i.e. it passed by
  testing *the developer's* dev server, and only surfaced now because I ran the suite
  with no dev server up, where it failed with `ECONNREFUSED`. **Fix:** take the URL
  from Playwright's `baseURL` fixture instead of rebuilding it; a request context can
  be given `baseURL` directly. **Why it's worth logging:** this is the *third* time in
  this project that a test aimed at the wrong server (the `newContext()` inheriting
  ambient auth in Phase 1, the suite spending 26 real Gemini calls in Phase 4), and
  the same root shape every time — the harness reconstructing something it was already
  given. It also passed for two phases while proving nothing about the server under
  test, which puts it in the same family as the `test.skip()` hole from Phase 4: green
  is not evidence that the assertion ran against the right thing. **Lesson: never
  rebuild a URL, port or session the test runner already owns — derive it.**

- **2026-08-13 · Phase 4.5 (harness, not app): `dotenv/config` reads `.env`, and this
  project has no `.env`.** The corpus backfill script used the convenient
  `import "dotenv/config"` and then failed with "CORPUS_EMBED_USER_ID is not set" —
  for a variable that was sitting in `.env.local` where every other tool in the repo
  reads it. The bare import only loads `.env`; loading anything else needs an explicit
  path, which is why `playwright.config.ts` had always spelled it out. Cost was small
  because the script's own precondition check named the missing variable, which is the
  reusable part: **the failure was a clear sentence instead of a `TypeError` deep
  inside the Supabase client**, which is what it would have been had the env check not
  come first. Second, related runtime bug in the same script: `supabase-js` eagerly
  constructs a realtime client that needs a global `WebSocket`, which Node 18 lacks
  and Next's server runtime polyfills — so `lib/supabase/admin.ts` works in the app
  and throws in a bare script. Fixed **in the script** (polyfill from `undici`) rather
  than in the shared module: product code shouldn't carry a workaround for a script's
  runtime. Same Node-18 family as the Next-15 and Playwright-1.47 pins.

- **2026-08-08 · Phase 4: the Recall screen congratulated users on an empty deck —
  a vanity metric introduced by accident.** Symptom: after Phase 4, six Phase 2 E2E
  tests failed waiting for recall cards that never rendered. **Reproduced before
  touching app code** (the standing discipline): probed the Gemini endpoint directly
  and got **HTTP 200** — the provider had recovered mid-build, so roadmaps were now
  *genuinely AI-generated*, with the model's own topic names. `RECALL_SEED` is keyed
  by **catalog** topic name, so nothing matched and the roadmap correctly started
  with an empty deck (intended — generating cards for 15–25 topics at onboarding
  would blow the daily cap). So the test failures were the *documented consequence*,
  not a defect. **But probing what a user would actually see exposed a real one:**
  with zero cards, `/recall` rendered *"Queue clear. Nothing is due right now. Don't
  cram ahead — the spacing is the point."* — telling someone they were **caught up
  on a retention loop they had never started**. Before Phase 4 that state was
  unreachable (onboarding always seeded a queue), so the copy had never been wrong.
  Fix: the page now counts total cards, not just due ones, and renders a distinct
  **"No recall cards yet"** empty state pointing at the Generate button; "Queue
  clear" is reserved for `totalCards > 0`. **Why it matters beyond the copy:** Rule
  19 bans vanity metrics, and this was one — a green "you're done" for an empty
  deck — created not by adding a metric but by an existing message quietly becoming
  reachable in a new state. **Lesson: when a feature makes a previously-impossible
  state possible, audit the messages that assumed it couldn't happen.** Fixture also
  hardened (`generateCardsForFirstTopic` throws a self-describing error) so an empty
  queue can never again masquerade as a rendering failure.

- **2026-08-08 · Phase 4: four security tests passed by never running — reading the
  session from the wrong store.** The `ai_usage` RLS cases (can a user delete/forge
  their own usage rows and reset the cap?) fetched the Supabase access token from
  **`localStorage`**, found nothing, and `test.skip`'d. The suite reported **"41
  passed, 4 skipped"** — green. Root cause: this app uses **`@supabase/ssr`** (chosen
  in Phase 0 over the deprecated auth-helpers) whose entire point is a **cookie**-based
  session the server can read; there was never anything in localStorage to find. Fix:
  read the `sb-<ref>-auth-token` cookie, rejoin its `.0`/`.1` **chunks** in name
  order, strip the `base64-` prefix and decode. **Why it's worth logging:** a skip is
  a far more dangerous failure than a red test — the four cases guarding the one
  table whose writability decides whether the daily cap is real at all were silently
  not running, and nothing in the summary line said so. **Lesson: a conditional
  `skip()` in a security test is a hole with a green tick on it — assert the
  precondition instead, or make the skip loud.**

- **2026-08-12 · Phase 4: the E2E suite silently spent 26 real Gemini calls while
  reporting green.** `playwright.config.ts` sets `AI_PROVIDER=mock` on its
  `webServer.env` — but it also had `reuseExistingServer: true` and defaulted to the
  **dev port, 3001**. So whenever a `npm run dev` was already running (i.e. normal
  working conditions), Playwright reused *that* server, which carries the real
  `GEMINI_API_KEY`, and the mock env was never applied. Found only because the user
  noticed token usage; confirmed by grouping `ai_usage` by model — **24
  `gemini-3.5-flash` + 2 `gemini-3.5-flash-lite`** on the day of the first run.
  **Fix, in three parts, because one wasn't enough:** (1) the suite now runs on a
  **dedicated port (3101)**, so the test server can never be the dev server;
  (2) `reuseExistingServer: false` — the saved startup seconds were worth far less
  than knowing which env the server under test has; (3) an `assertMockProvider()`
  guard in `beforeAll` of every spec that generates, which reads `/api/usage` and
  **refuses to run** if `provider !== "mock"`. Verified after: a full run is 43 mock
  dispatches and **zero** Gemini. **Why it's worth logging beyond the money:** this
  is a failure mode with no red test and no error — the suite was *more* green for
  being misconfigured, because a real provider answers just as well as a fake one.
  **Lesson: a test that costs money when it's misconfigured has to fail loudly on
  the misconfiguration; correctness of the result is not evidence of correctness of
  the setup.** Related: `reuseExistingServer` had already burned a debugging cycle
  the same week (below) — it's now off for good.

- **2026-08-12 · Phase 4: month-scale timelines would have silently built plans a
  quarter the requested length.** Adding "4 months" / "6 months" to the timeline
  options exposed that both generators parsed the answer with a **first-integer-wins**
  regex (`String(v).match(/\d+/)`) — so `"6 months"` became a **6-week** plan. Nothing
  would have errored: the user gets a plan, and the Phase 3 dashboard then measures
  them against it forever, reporting them wildly ahead of a schedule they never
  chose. Fixed by parsing the **unit** (`parseTimelineWeeks`, months × 4). **Two
  structural fixes came with it:** (1) the parser was **duplicated** in
  `lib/seed/generate.ts` and `lib/ai/validate.ts`, kept in step only by a unit test
  asserting they agreed — both now call one function in `lib/seed/answers.ts`, since
  one implementation beats a test that catches two from drifting; (2) added a
  **`MAX_WEEKS = 26` clamp**, because `timeline` arrives in the POST body and the
  route validates its *shape*, not its membership in the option list — `"9999 weeks"`
  would otherwise have asked the model for 9999 weeks and inserted 9999 weeks of rows
  in one request. **Lesson: when an enum of options grows a new UNIT, the parser is
  the thing to check first — "first number in the string" is correct right up until
  it silently isn't.**

- **2026-08-12 · Phase 4: weak-area options now follow the role, and "Not sure" is a
  first-class answer.** The step-5 options were one fixed frontend list regardless of
  the role picked in step 1, so a fullstack candidate chose between six frontend
  topics. Now `weakAreasForRole()` returns a per-role list (unknown role → the
  frontend default). **Deliberately NOT done:** adding roles the seeded catalog can't
  serve — see the open-questions entry; the fullstack list does name a couple of areas
  (databases, APIs) the catalog has no block for, which degrades gracefully because
  `orderBlocks()` simply matches nothing and falls back to natural order.
  **"Not sure" added** as an always-last, **mutually exclusive** option: not knowing
  where you're weak is a normal starting state, and forcing a guess would front-load
  the whole plan around that guess. It's stripped by `declaredWeakAreas()` before
  either generator sees it, so it means the same thing everywhere — "nothing to
  front-load, produce a balanced plan". **The non-obvious consequence, handled:**
  changing the role after picking weak areas leaves a selection that is no longer a
  valid option, and the server would reject it with a baffling "Pick at least one weak
  area" — so the wizard clears the picks when the role changes.

- **2026-08-12 · Phase 4: the generator built single-topic roadmaps — my prompt, not
  the model.** The user reported that whatever weak areas they picked, the roadmap
  covered *only* those. Cause was one line in `SYSTEM_ROADMAP`: *"Front-load the
  candidate's weak areas into the earliest weeks. **That is the single most important
  property of a good plan here.**"* The model did exactly as told and filled every
  week with the declared weak areas. **Why it's a real defect, not a preference:** a
  prep plan that drills one area and ignores the rest gets you rejected on the parts
  it skipped — the plan is actively worse than a balanced one, so "it followed the
  prompt" is no defence. **Fix:** weak areas are now stated as a **weighting, not the
  syllabus** — an explicit "cover the whole role" rule, plus concrete proportions the
  model can follow (4+ weeks: at most half dominated by weak areas; ≤3 weeks: at
  least one week outside them). **Two things this exposed beyond the prompt:**
  (a) the onboarding copy *"Where are you weakest? Pick all that apply."* promised
  exactly the behaviour that turned out to be wrong, so the question was corrected
  and given a hint line ("You'll still get a full plan — these just get more time,
  earlier") — a question that misdescribes what it controls is a product bug, not a
  wording nit; (b) **my own QA case reinforced the defect** — LIVE-03 originally read
  "the earliest weeks are visibly about system design, fail if not", which a
  single-topic roadmap passes. It now fails in *both* directions. **Lesson: an
  acceptance test written from the same assumption as the code will happily ratify
  the bug** — and prompt regressions are invisible to type checkers, unit tests and
  E2E alike, so they need a human-read case with a failure condition on each side.
  *(Note the seed fallback never had this bug: `orderBlocks()` front-loads matching
  blocks and then appends the rest, so it always covered the catalog.)*

- **2026-08-08 · Phase 4 (harness, not app): a stale dev server made two config
  fixes look like they did nothing.** After making `AI_DAILY_CALL_CAP` env-overridable
  and raising it for the test server, the suite *still* failed with `reason: cap`.
  Cause: `playwright.config.ts` sets `reuseExistingServer: true`, and a `next-server`
  from the first run was still listening on 3001 — so every subsequent run reused a
  process started **before** `AI_PROVIDER`/`AI_DAILY_CALL_CAP` existed, and neither
  env var was ever read. Next.js only reads env at startup, so no amount of config
  editing could have helped. Fix: kill the orphan, re-run, 51/51 green. **Lesson:
  with `reuseExistingServer`, a config change that has "no effect" is more likely to
  be a process you didn't restart than a config that doesn't work** — check what's
  actually listening on the port before editing anything else. Documented in
  playwright.config.ts and tests/README.md.

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

- **2026-08-14 · Phase 4.5 RAG — grounding topic resources on a curated corpus.**
  Vitest **210/210** (29 RAG: the grounding validator's every rejection path plus the
  real-length regression cases, the retrieval-query builder, the corpus-search
  failure-is-empty contract; 16 embed: cap/width/no-retry/metering; plus 165 from
  Phases 1–4, no regressions) · Playwright **64/64** (13 RAG: both branches on two
  test servers that differ only in the similarity floor, and the four corpus-RLS
  cases) · migrations `0007`–`0011` applied, corpus **202/202 embedded across 26
  areas**, floor calibration exits 0 at margin 0.024.
  **On the manual pass, recorded precisely:** the owner reported running the 45-case
  matrix with no failures, but **no per-case Pass/Fail ledger was kept**, so this
  phase — unlike Phases 3 and 4 — has no case-level evidence of which awkward-setup
  rows were exercised versus eyeballed. What I re-verified independently at close:
  corpus counts and zero duplicate URLs, anon INSERT and DELETE on `resources` both
  401 with all 202 rows intact, and build/tsc/lint clean.
  **Five real defects found during the phase, and the pattern matters more than the
  count: THREE were found by the owner using the real app while both automated suites
  were green.** (1) A 90-character cap on the resource caption rejected *every*
  grounded generation — real Gemini writes 200–220 — so the feature was 100% broken
  behind a Rule 9 fallback that made it invisible; the mock provider's short fixture
  strings hid it. (2) The validator rejected an empty selection, punishing the model
  for the selectivity the prompt explicitly demanded. (3) The corpus was curated
  against the seed catalog rather than against real generated roadmaps, so most of a
  plan fell back to unverified. (4) `/usage` labelled a 500-row window as all-time.
  (5) The calibration probe could report PASS having measured nothing.
  **What is now demoable:** open a topic → press Generate → resources are real,
  clickable, hand-vetted links carrying a green VERIFIED chip and a source label
  reading "grounded · vetted sources"; open a topic the corpus has nothing for →
  the same flow completes with amber UNVERIFIED resources whose titles link to a
  search rather than to any URL a model produced; `/usage` shows two metered calls
  per grounded topic, so the price of grounding is a number rather than a claim.
  **The explain-cold claims this backs:** why the model is never asked for a URL and
  cites documents by index instead (a hallucinated citation is unrepresentable, not
  merely rejected); why `resources` is the one table with no `user_id` *predicate*
  rather than the one table with no RLS (on Supabase, "no RLS" on a public table
  means world-writable); why the embedding width is 1536 (pgvector cannot index above
  2000 dims) rather than the model's native 3072; why the similarity floor is
  measured against queries you know should fail, and why it had to be *raised* as the
  corpus grew (a broader corpus makes more of the world genuinely adjacent); and why
  the E2E suite runs two servers differing in exactly one environment variable.

- **2026-08-12 · Phase 4 AI Gateway + real generation — QA gate closed, verified
  end-to-end.** Vitest **165/165** (25 schema validation incl. the "model writes
  content not contract" assertions; 18 cost/projection incl. cached-tokens-as-subset
  and $/roadmap charging retries to the roadmap; 20 gateway incl. cap-before-dispatch,
  the retry that must not cross the cap, fail-closed on an unreadable usage table, and
  provider errors deliberately not retried; 19 answer parsing incl. months→weeks and
  the MAX_WEEKS clamp; 6 seed-detail fallback; plus 77 Phase 1–3, no regressions) ·
  Playwright **51/51** (20 AI: all four routes anon-blocked, ownership 404 before any
  spend, cross-user generation blocked, the Rule 9 flow-completes guarantee, detail
  persistence, card idempotency, `/api/usage` coherence, and the four `ai_usage` RLS
  cases) · **full manual pass green — all 76 cases**, and the awkward ones were
  genuinely run rather than eyeballed: the cap suite (set to 2, restart, watch a real
  generation get refused *and still return content*), all four `AI_MOCK_MODE` failure
  injections including `malformed-once` proving the retry recovers invisibly, and the
  browser-console attempts to DELETE/INSERT one's own `ai_usage` rows.
  **Three real bugs found during the build** (all logged above): the E2E suite quietly
  spending 26 real Gemini calls while reporting green, the generator building
  single-topic roadmaps because my prompt told it to, and month-scale timelines
  parsing as weeks.
  **What is now demoable:** onboard with real answers → a genuinely generated,
  schema-valid roadmap of exactly the length and budget you chose → open a topic,
  press Generate → real study material with unverified-flagged resources → generate
  its recall cards on the cheap tier → `/usage` shows tokens, cache hit-rate,
  fallback rate and $/roadmap with charged-vs-projected side by side → then comment
  out the API key, restart, and watch every single flow still work on seeded content.
  **The explain-cold claims this backs:** why `ai_usage` is the one user-owned table
  the user may not write (the cap is a COUNT of those rows, so a `for all` policy
  makes it self-resettable) and the sharpened rule it produced — *ownership decides
  who may READ; whether the value enforces a product rule decides who may WRITE*; why
  the model is never asked for the plan's contract; why the retry is
  retry-on-malformed only and is re-checked against the cap; why the cost readout
  separates charged from projected; and why the E2E suite runs against a mock
  provider on its own port.

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

- **2026-08-27 · Generator provenance: reported-only → PERSISTED.** *(Phase 5,
  migration 0012.)*
  **What Phase 4 decided (2026-08-08):** `/api/roadmaps/generate` returns
  `{ id, source }` and does **not** store which generator ran. The reasoning was
  sound at the time — `source` was a fact about one request, and `/usage` was the
  durable audit trail of every dispatch and how it ended.
  **What changed:** Phase 5 added **`SDE-2 · Backend`**, a role the seeded
  `CATALOG` (a frontend curriculum) cannot serve. That flipped the category of the
  fact. "The model was down so this is the frontend template" stopped being a
  property of an HTTP request and became a property of **the plan the user will be
  held to for the next eight weeks**. A transient response field cannot label a row
  somebody opens three weeks later, and the toast that announced it is long gone.
  **Now:** `roadmaps.generated_from text check (… in ('ai','seed'))`, nullable.
  `/usage` is unchanged and still the audit trail; this is the row's own label.
  **The NULL rule, which is the interesting half:** every roadmap created before
  0012 has unknown provenance, and NULL is read as *unknown*, never as `'ai'`.
  Guessing `'ai'` would silently un-label exactly the rows we cannot vouch for;
  guessing `'seed'` would put a false warning on every old generated roadmap.
  Silence is the only honest read of a fact we never recorded.

- **2026-08-27 · Role scope: "no backend role" → backend role + a loud fallback.**
  *(Phase 5. Supersedes the 2026-08-12 deferral in the open-questions list.)*
  **What was decided before:** keep the role list frontend-only, because the seeded
  fallback catalog IS a frontend curriculum, so adding "Backend" would mean an AI
  failure hands that user a frontend plan — **Rule 9 breaking quietly**, which is
  the only way Rule 9 can meaningfully break.
  **Why it changed:** the premise was right but the conclusion was one option too
  narrow. There were three ways out, not two: (a) don't ship the role, (b) author a
  real backend catalog (weeks of curriculum content — a phase of its own), or
  (c) **ship the role and make the fallback impossible to miss**. (c) was invisible
  in the original framing because the failure mode was described as "quietly", and
  the fix for *quietly* is not *don't ship* — it is *loudly*.
  **What shipped:** the role, backend weak areas chosen to line up with real
  `topic_area` tags already in the Phase 4.5 corpus (so backend topic detail is
  genuinely grounded, not recalled), `templateMismatch()`, and an amber
  **TEMPLATE MISMATCH** notice on both the Roadmap screen and the print-out.
  **Fullstack is deliberately NOT flagged.** The catalog serves it in part, and a
  warning that fires on a mostly-correct plan is a warning people learn to ignore.
