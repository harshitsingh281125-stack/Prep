# Test Cases — Phase 4: AI Gateway + real generation

> **QA gate (Rule 27).** Manual test pass for the Phase 4 feature set: the
> `ai_usage` schema + its deliberately non-standard RLS, the AI Gateway
> (`lib/ai/gateway.ts`) with schema validation / retry-on-malformed / metering /
> per-user daily cap, the three wired generation routes, the on-demand Topic
> generation UI, and the `/usage` cost readout. Run each case, mark
> **Pass / Fail**, and report back. Any Fail → logged in [memory.md](../memory.md)
> as a bug and fixed before Phase 4 is called demoable.
>
> **Legend.** Priority: **P0** = blocker/security/data-integrity · **P1** = core flow ·
> **P2** = polish/UX. Report format at the bottom.

---

## What automation already covers — do NOT re-do by hand

**88 AI-specific unit tests + 20 E2E, green as of 2026-08-12** (out of 165 unit / 51 E2E across the whole suite).

- **`tests/unit/ai-validate.test.ts` (25)** — every schema-validation branch: wrong
  week count both directions, model-supplied `n`/`hours` ignored, short kill
  criteria, topic-count bounds, duplicate topics, bad resource tags, short mental
  models, duplicate/short recall questions, and the `planContract` defaults
  matching the seed generator's.
- **`tests/unit/ai-cost.test.ts` (18)** — the rate-card maths: cached tokens as a
  subset (not an addition), unknown models priced at zero, cache hit-rate over
  input tokens only, $/roadmap charging retries and failures to the roadmap they
  were spent on, and actual-vs-projected staying separate.
- **`tests/unit/ai-gateway.test.ts` (20)** — cap before dispatch, the cap boundary,
  **the retry that must not step over the cap**, fail-closed when usage can't be
  read, retry-on-malformed succeeding and giving up, provider errors *not* being
  retried, the nudge going in the input while the system prompt stays byte-identical,
  metering failures not breaking the request, and `extractJson` on fenced/prose input.
- **`tests/unit/seed-detail.test.ts` (6)** — the Rule 9 fallback can't itself fail.
- **`tests/e2e/ai.spec.ts` (20)** — anon blocked on all four routes; unknown-topic
  404s before any spend; `topicId` validation; User B blocked from generating
  against User A's topic; the Rule 9 flow-completes guarantee; detail persistence
  across reload; card-generation idempotency; `/api/usage` coherence; and the four
  `ai_usage` RLS cases (owner can read; **cannot** delete; **cannot** insert; B
  can't see A's spend).

**What this doc covers instead:** everything that needs a human — real generated
*content quality*, the live Gemini adapter (wire format, token accounting, cache
hits), visual/theme fidelity, and the failure modes that need config you have to
change by hand (cap exhaustion, malformed responses, a dead provider).

> **The E2E suite runs against the MOCK provider** (`AI_PROVIDER=mock` in
> `playwright.config.ts`) so it never depends on Google's uptime or eats your daily
> cap. **That means nothing automated has ever touched the real Gemini API.**
> Suite LIVE below is the only thing that verifies the real adapter — do not skip it.

---

## Prereqs before you start

1. Migration **`0006_ai_usage.sql`** applied (confirmed — table exists, RLS enabled,
   exactly one `SELECT`-only policy `ai_usage_select_own`, advisors clean).
2. `.env.local` has a working **`GEMINI_API_KEY`**.
3. **Stop any running dev server**, then start a fresh one: `npm run dev`
   (http://localhost:3001). *Next.js only reads `.env.local` at startup, and several
   cases below work by changing it — you must restart for each change.*
4. **DevTools → Network + Console** open for the API/security cases.
5. A second account (**User B**) for the cross-user cases.
6. Know where the kill switch is: to make the app behave as if AI never existed,
   comment out `GEMINI_API_KEY` and restart.

> **Before you start, note your starting AI usage:** open **/usage** and write down
> "N / 25 today". Several cases spend calls; the cap is 25/day and resets midnight
> **UTC** (not local midnight).

---

## Suite LIVE — the real Gemini adapter (P0, nothing automated covers this)

> These are the only cases that exercise `lib/ai/providers/gemini.ts` against the
> real API. Run them with `AI_PROVIDER` **unset** (or removed) in `.env.local`.

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| LIVE-01 | Real roadmap generation | Fresh dev server, real key, under quota | Onboarding → answer all 5 (pick **3 weeks**, **12h**, weak area **React internals**) → **Generate roadmap** | Lands on the roadmap. **Exactly 3 weeks**, each with a real title, a *testable* kill criterion, and 2–6 topics. Content is clearly about React internals in the early weeks — not generic filler | P0 |
| LIVE-02 | The contract is the user's, not the model's | LIVE-01 done | Check the roadmap header + week hours | `hours_planned` = 3 × 12 = **36h**; every week says 12h; weeks numbered 1,2,3 — regardless of what the model wrote | P0 |
| LIVE-03 | Weak areas are a weighting, not the syllabus | Generate **5 weeks** with weak = **Frontend system design** only | Read all 5 week titles/topics | Week 1 (and probably 2) are visibly about system design — **and the remaining weeks cover other core areas** (JS/async, rendering, React, live coding). **Fail this in either direction:** if the weak area doesn't come first the weighting is broken; if *every* week is system design the plan is drilling one topic and would get you rejected on everything it skipped | P0 |
| LIVE-03b | Short plan still gets breadth | Generate **3 weeks** with weak = **React internals** only | Read the 3 weeks | At least **one** of the three covers something outside React internals | P1 |
| LIVE-03c | No weak areas declared | Generate **5 weeks**, picking… you can't — the CTA is gated on ≥1 pick | Confirm the gate | The "Generate roadmap" button stays disabled with "Pick at least one weak area" (server also 400s). *Recorded so the gate is a deliberate choice, not an untested path* | P2 |
| LIVE-04 | Real topic detail | Open any topic from LIVE-01 | Click **Generate with AI**, wait | Mental model reads like a real explanation of *that* topic (mechanism first, not a dictionary definition); 2–5 resources; 2–4 exercises that are **build/explain**, not "read about X" | P0 |
| LIVE-05 | Source label is honest | LIVE-04 done | Look at the top-right of the Mental model panel | Reads **`ai-generated`** (not `template`) | P0 |
| LIVE-06 | Unverified chips | LIVE-04 done | Look at each resource row | Every resource has an amber **UNVERIFIED** chip; hovering shows the tooltip explaining Phase 4.5 will ground them | P1 |
| LIVE-07 | Real recall cards | Same topic | Click **Generate recall cards** | Note says "Added N cards…"; **/recall** now shows them, each a real question about that topic that does **not** contain its own answer | P0 |
| LIVE-08 | Token accounting is real | After LIVE-01/04/07 | Open **/usage** | Tokens in/out are non-zero and plausible; per-route rows for `/api/roadmaps/generate`, `/api/topics/detail`, `/api/recall/generate`; **fallback rate 0%** | P0 |
| LIVE-09 | Tier routing is real | Same | On **/usage**, compare the route rows | Roadmap + topic-detail rows are the **reasoning** model; the recall row is the **classification** model. (Cross-check `models` in `/api/usage` JSON) | P1 |
| LIVE-10 | Prompt caching | Generate detail for **3 different topics** in a row | Open **/usage** → cache hit-rate | Hit-rate is **> 0%** by the 2nd/3rd call. **If it stays 0%, that is a real finding, not a pass** — record the number and report it either way; implicit caching may need a longer system prefix than ours | P1 |
| LIVE-11 | Latency is bearable | LIVE-01 | Time the roadmap generation | Completes in < 30s (the gateway's timeout); the wizard shows "Building your roadmap…" the whole time and never looks frozen | P1 |

---

## Suite ONB — onboarding answers actually shape the plan

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| ONB-01 | Month-scale timelines | — | Onboard with **6 months** / 12h | The roadmap has **24 weeks** (not 6!) and `hours_planned` = 288. *A first-integer parser would have built a 6-week plan here — that's the bug this option was added around* | P0 |
| ONB-02 | 4 months | — | Onboard with **4 months** | **16 weeks** | P1 |
| ONB-03 | Long plans still generate | — | Do ONB-01 with the real provider | Either a genuinely generated 24-week plan, **or** a clean seeded fallback (source `seed`) — never an error, never a plan of the wrong length. Note which you got: long plans are the most likely to fail the exact-week-count validation and fall back | P1 |
| ONB-04 | Weak areas follow the role | — | Step 1 → **SDE-2 · Fullstack**, advance to step 5 | Options include **Databases & SQL** / **APIs & backend fundamentals** — not the frontend-only list | P1 |
| ONB-05 | Staff role options | — | Step 1 → **Staff · Frontend**, advance to step 5 | Options include **Cross-team influence**, **Technical strategy & roadmapping**, **Architecture & trade-offs** | P1 |
| ONB-06 | Changing role clears stale picks | — | Pick **SDE-2 · Fullstack** → step 5 → select **Databases & SQL** → click back to step 1 → pick **Staff · Frontend** → return to step 5 | Selection is **cleared**; the Staff options are shown; the CTA is disabled until you pick again. *(Without this you'd carry an option that no longer exists and the server would reject it with a confusing "Pick at least one weak area")* | P1 |
| ONB-07 | "Not sure" is exclusive | — | On step 5 select **Async JS**, then select **Not sure** | **Not sure** becomes the only selection; picking any other area then de-selects **Not sure** | P1 |
| ONB-08 | "Not sure" → balanced plan | — | Generate with only **Not sure** selected | A full plan with **nothing front-loaded** — it should read as a sensible general curriculum, not as a plan built around one area | P0 |
| ONB-09 | Weak areas are a weighting | — | Generate **5 weeks**, weak = **React internals** only | React internals leads, **and** later weeks cover other areas. *Same check as LIVE-03 — the single most important behavioural fix in this round* | P0 |
| ONB-10 | Absurd timeline is clamped | — | `POST /api/roadmaps/generate` directly with `"timeline": "9999 weeks"` | 201 with a plan of **at most 26 weeks** — not 9999 rows inserted. *The option list can't produce this; a hand-rolled request can* | P0 |
| ONB-11 | Server rejects an off-list weak area | — | POST directly with `"weak": ["Rocket surgery"]` | **400** "Pick at least one weak area." | P0 |
| ONB-12 | Hint text is visible | — | Reach step 5 | Sub-line reads "You'll still get a full plan — these just get more time, earlier." | P2 |

---

## Suite CAP — the daily cap is hard (Rule 3)

> **Setup:** add `AI_DAILY_CALL_CAP=2` to `.env.local` and **restart the dev server**.
> **Teardown:** remove that line and restart when the suite is done.

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| CAP-01 | Meter reflects the new cap | Cap set to 2, restarted | Open **/usage** | Cap meter reads `N / 2`. If N ≥ 2 you're already capped — that's fine, go to CAP-03 | P1 |
| CAP-02 | Calls count up | Under the cap | Generate topic detail once | Meter goes up by exactly **1** (or 2 if it retried — the sub-line says dispatches are counted) | P1 |
| CAP-03 | Cap blocks generation but NOT the flow | At the cap | Open a fresh topic → **Generate with AI** | **You still get study material.** Source label reads `template`, and the amber note says *"Daily AI cap reached — this is the study template. Resets at midnight UTC."* — **no error page, no spinner stuck, no 500** | P0 |
| CAP-04 | Cap blocks roadmap generation but not onboarding | At the cap | Onboard a new roadmap | A complete, usable roadmap is still created (seeded), matching your chosen weeks/hours. The flow never fails | P0 |
| CAP-05 | Capped calls are not metered | At the cap | Note the meter, do CAP-03 again, re-check | The number does **not** rise. Nothing was dispatched, so nothing was billed — the check happens *before* the provider call | P0 |
| CAP-06 | Cap meter turns red | At the cap | Look at **/usage** | Cap panel border + bar are red; copy explains generation falls back to seeded content until midnight UTC | P2 |
| CAP-07 | Cap is per user, not global | User A at the cap | Sign in as **User B** → /usage | B's meter shows B's own (low) count and B can still generate | P0 |

---

## Suite FALL — Rule 9: AI never hard-blocks a flow

> **Setup:** set `AI_PROVIDER=mock` in `.env.local` plus the `AI_MOCK_MODE` given per
> case, and **restart** each time. **Teardown:** remove both lines and restart.

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| FALL-01 | Provider outage | `AI_MOCK_MODE=error` | Open a fresh topic → **Generate with AI** | Study material still appears; source `template`; note reads *"The model is unreachable right now…"*. No crash, no infinite spinner | P0 |
| FALL-02 | Outage is metered as an error | FALL-01 done | Open **/usage** | Call count rose; **Fallback rate** is non-zero; the "failed" count in the fallback tile went up. *A failed dispatch still costs the provider a request, so it must still be counted* | P0 |
| FALL-03 | Outage never retried | FALL-01 done | Check `/api/usage` JSON → `allTime.retries` | Did **not** increase. Rule 9's retry is retry-on-**malformed**; re-dispatching into an outage would just burn a second call to fail identically | P1 |
| FALL-04 | Malformed twice → seeded fallback | `AI_MOCK_MODE=malformed` | Generate detail on a fresh topic | Material appears; source `template`; note reads *"The model returned something unusable twice…"* | P0 |
| FALL-05 | Malformed is metered | FALL-04 done | Open **/usage** | **Two** dispatches were added for that one press (the original + the retry), and the "malformed" count rose by 2 | P0 |
| FALL-06 | The retry actually recovers | `AI_MOCK_MODE=malformed-once` | Generate detail on a fresh topic | Source reads **`ai-generated`**, no amber note. `/usage` shows 2 dispatches and `retries` +1 — the first was junk, the retry succeeded, and the user never saw a failure | P0 |
| FALL-07 | AI switched off entirely | Comment out `GEMINI_API_KEY`, no `AI_PROVIDER` | Onboard a roadmap, then generate detail | Everything works, all seeded. `/usage` header chip reads **AI OFF** (amber). **Nothing is metered** — no provider, no dispatch | P0 |
| FALL-08 | The app is fully usable with AI off | Still off | Do a full loop: roadmap → topic → notes → master → recall → log hours → progress | Every Phase 1–3 feature behaves exactly as before. AI being absent degrades content, never function | P0 |
| FALL-09 | Roadmap fallback matches the contract | AI off, onboard **8 weeks / 20h** | Check the roadmap | 8 weeks, 160h planned — the seed path honours the same contract the AI path would have | P1 |

---

## Suite GEN — the on-demand generation UI

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| GEN-01 | Topics start empty | A newly generated roadmap | Open any topic | Dashed **"No study material yet"** panel naming the topic + a **Generate with AI** button. **No** mental model, resources or exercises are pre-filled | P1 |
| GEN-02 | Nothing generates on its own | GEN-01, Network tab open | Open 3 different topics without clicking anything | **Zero** POSTs to `/detail`. Browsing a roadmap must never spend the cap | P0 |
| GEN-03 | Button busy state | A topic with no detail | Click **Generate with AI** | Button reads "Generating…", is disabled, cursor is `wait`; clicking again does nothing (check Network — one POST) | P1 |
| GEN-04 | Content replaces the empty state | GEN-03 finished | Observe | Empty panel disappears; mental model, ranked resources and exercises render in the design's layout | P1 |
| GEN-05 | Persistence | GEN-04 done | Reload the page | Content is still there and **no** new POST fires — it was saved to `topics.detail`, not held in memory | P0 |
| GEN-06 | Regenerate | GEN-04 done | Sidebar → **Regenerate study material** | New content replaces the old; usage rises by 1 | P2 |
| GEN-07 | Cards land in the queue | Any topic | **Generate recall cards** → then open **/recall** | Note says "Added N cards…"; the queue shows them; the sidebar **Recall** badge count went up | P1 |
| GEN-08 | Repeat press doesn't duplicate | GEN-07 done | Press **Generate recall cards** again | Either "No new cards…" or only genuinely new ones. **No duplicate question text in the queue** — re-reading a question you just saw is a false recall signal | P0 |
| GEN-09 | Empty recall state is honest | A brand-new roadmap, no cards generated | Open **/recall** | Dashed **"No recall cards yet"** panel telling you to generate them. It must **NOT** say "Queue clear" — that would congratulate you for keeping up with a deck you never made | P0 |
| GEN-10 | Cleared vs empty are different | Generate cards, then grade them all | Observe /recall | Now it says **"Queue clear."** — the caught-up state, distinct from GEN-09 | P1 |
| GEN-11 | Cap link | Any topic | Read the Generate panel footer | "Each press spends one call from your daily cap." + a working **See usage** link | P2 |

---

## Suite COST — the readout tells the truth

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| COST-01 | Empty state | A user with no AI calls (User B) | Open **/usage** | Dashed "No AI calls yet" + a working "Generate a roadmap →" button; cap meter still renders | P1 |
| COST-02 | Actual vs projected | Some real calls made, free tier | Read the **Cost** panel | **Actually charged $0.00** with "free tier — nothing was billed"; **Projected (paid tier)** is > $0.00. The two are side by side and clearly different things | P0 |
| COST-03 | The honesty paragraph | Same | Read the note under the Cost panel | It states plainly that the charged column is $0.00, that the projection uses real token counts at published rates, and that it is never stored | P0 |
| COST-04 | $/roadmap | ≥ 1 roadmap generated by AI | Read the tile | A plausible small number (fractions of a cent at flash rates), labelled "projected, incl. retries" | P1 |
| COST-05 | Fallback rate | After running suite FALL | Read the tile | Matches what you did: `N malformed · M failed` and a sensible % | P1 |
| COST-06 | Per-route table | Several kinds of call made | Read **By route** | One row per route, busiest first, with calls/tokens/projected. Numbers add up to the totals above | P1 |
| COST-07 | Cost figures are readable | Any | Look at the dollar values | Sub-cent values show 5dp (e.g. `$0.00042`), not a misleading `$0.00` | P2 |
| COST-08 | Provider chip | Any | Header tag on /usage | Shows `gemini · free` (or `mock · free`, or amber `AI OFF`) matching your actual config | P1 |

---

## Suite SEC — security (P0 throughout)

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| SEC-01 | The key never reaches the browser | Any page | DevTools → Sources/Network, search all JS + all responses for `AIza` and for your key | **Zero** matches anywhere client-side (Rule 2) | P0 |
| SEC-02 | No model names in client code | Any page | Search the client bundle for `gemini-3.5` | No matches on any *page* bundle. Model ids live only in server code (Rule 8) | P0 |
| SEC-03 | ai_usage is not client-writable | Signed in, /usage open | In the console, use the app's Supabase client to `.from('ai_usage').delete().neq('id','00000000-0000-0000-0000-000000000000')` | Denied (error) or 0 rows affected. Reload /usage — **the count is unchanged**. *This is what stops the cap being self-resettable* | P0 |
| SEC-04 | ai_usage is not client-forgeable | Same | Try `.from('ai_usage').insert({...})` from the console | Denied. No new row on /usage | P0 |
| SEC-05 | ai_usage IS readable by its owner | Same | `.from('ai_usage').select('*').limit(5)` | Returns your own rows only — read access is intentional, it's what feeds the readout | P0 |
| SEC-06 | Cross-user spend isolation | User A has usage | Sign in as **User B** → /usage | B sees only B's own numbers; none of A's spend, routes or tokens appear | P0 |
| SEC-07 | Service role stays server-side | — | Search the whole client bundle for the service-role key and for `SUPABASE_SERVICE_ROLE_KEY` | No matches (Rule 6; `import "server-only"` makes this a build error, but verify) | P0 |
| SEC-08 | Generation on someone else's topic | User A's topic id in hand | As **User B**, POST `/api/topics/<A's topic id>/detail` | **404**, and User B's usage does **not** increase — ownership is checked *before* any provider call is spent | P0 |
| SEC-09 | Quota still precedes AI | User A at 3 roadmaps | Try to onboard a 4th | **403** roadmap-limit error, and **no** AI call is made (check /usage). A user at their roadmap cap must not burn an AI call to find out | P0 |

---

## Suite UI — fidelity, theme, states

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| UI-01 | /usage in both themes | — | Toggle light/dark on /usage | All text legible; cap bar, amber fallback tile, green cache-saving figure all readable in both. No raw hex anywhere (Rule 21) | P1 |
| UI-02 | Unverified chip in both themes | Generated detail | Toggle theme | Amber chip readable on both backgrounds; doesn't fight the tag chip beside it | P2 |
| UI-03 | Nav entry | — | Look at the sidebar | **AI usage** sits under Progress with its own icon; active state matches the others (elevated bg + border + 600 weight) | P2 |
| UI-04 | Empty-state panel fidelity | A topic with no detail | Compare to the other dashed empty states (Library, Progress) | Same dashed border, radius, padding rhythm and button styling | P2 |
| UI-05 | Long generated content | A topic whose model text is long | Read the panel | Wraps cleanly, no overflow, no horizontal scroll; the source label stays put | P2 |
| UI-06 | Per-route table on a narrow window | /usage, window ~900px | Resize | The table scrolls inside its own container; the page itself never scrolls sideways | P2 |
| UI-07 | Onboarding wait | Real provider | Generate a roadmap | Button is disabled and reads "Building your roadmap…" for the whole wait; no double-submit possible | P1 |

---

## Report format

Reply with one line per case:

```
LIVE-01 Pass
LIVE-10 FAIL — cache hit-rate stayed 0% after 4 consecutive generations
CAP-03 Pass
```

For any **FAIL**, include what you actually saw vs what was expected. Fails become
bug entries in [memory.md](../memory.md) (Rule 23) and are fixed before Phase 4 is
marked demoable (Rule 24/27).

**If you skip a case, say so explicitly rather than leaving it out** — a phase status
line that says "full manual pass" is read back months later as fact, and a silent
gap becomes a false claim.

**Highest value if you're short on time:** the whole **LIVE** suite (nothing
automated has touched the real API), **ONB-01/08/09**, **CAP-03/04/05**,
**FALL-01/04/06/07**, **GEN-02/05/09**, **SEC-01/03/09**.
