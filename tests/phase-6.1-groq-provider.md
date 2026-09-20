# Phase 6.1 — Second AI provider (Groq / open-weight gpt-oss)

> **Rule 27 QA gate.** Code-complete ≠ done. Run these by hand and report
> Pass/Fail per case. Fails become `memory.md` bug entries and are fixed before
> the phase is marked demoable (Rule 24).

## What shipped

A second provider behind the same gateway, in two modes:

- **Manual switch** — `AI_PROVIDER=groq` selects it outright, the way
  `AI_PROVIDER=mock` already did.
- **Automatic failover** — Gemini stays primary; when a Gemini *dispatch* fails
  (HTTP error, timeout, outage), the gateway re-dispatches once to Groq before
  the seeded fallback. A failover spends a dispatch from the same `MAX_ATTEMPTS`
  budget a malformed-retry would, so one user action can never cost more than
  `MAX_ATTEMPTS` calls of the daily cap however the failures are mixed.

Plus three things that fell out of building it:

- `Provider` split into `CompletionProvider` + `EmbeddingProvider`. Groq has no
  embeddings endpoint, so the embedding tier **always** resolves to Gemini.
- Cache metrics on `/usage` now computed over cache-capable rows only — Groq
  does no prompt caching, and mixing it in would have dragged Gemini's measured
  hit-rate down while staying arithmetically "correct".
- `AI_BILLING_MODE` config drift (see suite **BILL**).

## What automation already covers — do NOT re-test by hand

| Area | Where | Count |
|---|---|---|
| Groq schema translation (lowercase types, `additionalProperties`, `required` promotion, recursion) | `tests/unit/ai-groq.test.ts` | 5 |
| Failover routing policy (mock never fails over, `AI_FAILOVER=off`, no chaining, key-absent) | `tests/unit/ai-groq.test.ts` | 6 |
| `providerName()` precedence incl. "explicit groq without a key ⇒ none" | `tests/unit/ai-groq.test.ts` | 6 |
| Tier→model bindings, rate card, `cachesPrompts()` | `tests/unit/ai-groq.test.ts` | 6 |
| Failover walk: meters both dispatches, reports the answering model, no failover on malformed, cap boundary, budget ceiling | `tests/unit/ai-gateway.test.ts` | 8 |
| Cache-metric split with a mixed-provider window | `tests/unit/ai-cost.test.ts` | 4 |

Unit total after this phase: **283** (was 248). E2E: **81**, unchanged.

**One thing the E2E run proved implicitly and is worth recording:** the suite
loads `.env.local` into the Playwright process, so the test servers ran with a
real `GROQ_API_KEY` present *and* `AI_PROVIDER=mock`. All 81 specs stayed green,
which is the mock-never-fails-over guarantee holding under the exact condition
that would break it. It is asserted directly in the unit suite; this is
corroboration, not the primary evidence.

## Preconditions for the manual run

1. `.env.local` contains `GEMINI_API_KEY`, `GROQ_API_KEY`, and
   `AI_BILLING_MODE=paid`.
2. **Restart the dev server after every env change in this document.** Next.js
   reads env only at startup — a skipped restart silently tests the previous
   configuration and is the single most likely way to produce a false Pass here.
3. Use your own signed-in account. Have `/usage` open in a second tab.
4. Record the `/usage` "Tokens in / out" and dispatch count before you start, so
   each case's delta is readable.

---

## Suite GRQ — the manual switch (live Groq)

`AI_PROVIDER=groq` in `.env.local`, restart.

| ID | Area | Precondition | Steps | Expected | Pri |
|---|---|---|---|---|---|
| GRQ-01 | Roadmap generation | Under roadmap quota (Rule 18) | Onboard and generate a roadmap | A real, non-seeded roadmap renders. Week count matches what was asked. Kill criteria are concrete and testable, not feelings | P0 |
| GRQ-02 | Metering | GRQ-01 done | Open `/usage` | A new dispatch appears with model `openai/gpt-oss-120b`, status `ok`, non-zero input **and** output tokens | P0 |
| GRQ-03 | Classification tier | GRQ-01 done | Open a topic, generate recall cards | Cards appear; `/usage` shows a dispatch on `openai/gpt-oss-20b`, not the 120b | P0 |
| GRQ-04 | Reasoning tokens | GRQ-01 done | Compare the roadmap dispatch's output-token count against a Gemini roadmap dispatch | Groq's output tokens are *higher* than Gemini's for comparable content (invisible reasoning tokens are billed and counted). This is expected, not a bug — confirm it is visible rather than hidden | P1 |
| GRQ-05 | Latency | — | Time the roadmap generation | Completes well inside the 30s `REQUEST_TIMEOUT_MS`; ~2–4s is typical at `reasoning_effort: low` | P1 |
| GRQ-06 | Structured output | Repeat GRQ-01 three times | Generate three roadmaps (watch quota) | All three validate. Fallback rate on `/usage` does not climb. If any roadmap arrives seeded, note which and stop — that is a schema-translation failure | P0 |
| GRQ-07 | Provider badge | On `/usage` | Read the header tag | Reads `groq · paid`, not `gemini` | P2 |

## Suite EMB — the capability split (Groq cannot embed)

Still `AI_PROVIDER=groq`.

| ID | Area | Precondition | Steps | Expected | Pri |
|---|---|---|---|---|---|
| EMB-01 | RAG degrades, never blocks | A roadmap exists | Open a topic that normally grounds on the corpus | Topic detail still renders in full — mental model, resources, exercises. **Nothing is blocked** (Rule 9) | P0 |
| EMB-02 | Honest labelling | EMB-01 | Inspect the resource list | Resources are marked `unverified` and carry **no links** — they came from the model's memory, not the corpus. A green VERIFIED chip here is a P0 failure | P0 |
| EMB-03 | No phantom embedding spend | EMB-01 | Check `/usage` | **No** `embedding`-tier dispatch was written for that topic. Nothing was dispatched, so nothing should be metered | P1 |
| EMB-04 | Gemini restores grounding | Set `AI_PROVIDER=gemini`, restart | Re-open the same topic (force a fresh generation) | Resources come back grounded, verified, with working links | P0 |

## Suite FO — automatic failover

Restore `AI_PROVIDER=gemini` (or remove the line). Simulate a Gemini outage by
corrupting only the Gemini key: set `GEMINI_API_KEY=invalid-key-for-qa`,
keep a valid `GROQ_API_KEY`, restart.

| ID | Area | Precondition | Steps | Expected | Pri |
|---|---|---|---|---|---|
| FO-01 | Failover happens | Gemini key invalid, Groq valid | Generate a roadmap | A **real generated** roadmap appears — not the seeded fallback | P0 |
| FO-02 | Both dispatches metered | FO-01 | Open `/usage` | **Two** new rows: a Gemini-model row with status `error`, then an `openai/gpt-oss-120b` row with status `ok`. A failover that meters only the success would under-count the cap | P0 |
| FO-03 | Failover is visible, not silent | FO-01 | Inspect the `ok` row's model on `/usage` | The model column names the model that actually answered. The user-facing screens need not shout, but the record must not claim Gemini produced it | P0 |
| FO-04 | Recall tier fails over too | Gemini key still invalid | Generate recall cards for a topic | Cards generate; `/usage` shows an errored Gemini row then an `openai/gpt-oss-20b` row | P1 |
| FO-05 | Failover disabled | Set `AI_FAILOVER=off`, restart | Generate a roadmap | **Seeded fallback**, exactly as before this phase. One errored Gemini row only, no Groq row | P0 |
| FO-06 | No Groq key = no failover | `AI_FAILOVER` removed; comment out `GROQ_API_KEY`; restart | Generate a roadmap | Seeded fallback. One errored Gemini row. No crash, no attempt to dispatch to a provider with no key | P0 |
| FO-07 | Embedding does not fail over | Gemini key invalid, Groq valid | Open a topic requiring retrieval | Retrieval fails and the topic degrades to ungrounded/unverified — it does **not** try Groq for the embedding, and does **not** error the page | P0 |
| FO-08 | Cap boundary | Set `AI_DAILY_CALL_CAP=1`, restart; Gemini key still invalid | Generate a roadmap | Seeded fallback with **one** errored row. The failover is refused because the second dispatch would breach the cap — Rule 3 outranks resilience | P0 |
| FO-09 | Cap arithmetic | Set `AI_DAILY_CALL_CAP=2`, restart | Generate one roadmap | Exactly 2 dispatches are recorded and the cap is now spent. A single user action never exceeds `MAX_ATTEMPTS` | P0 |

**Restore `GEMINI_API_KEY` to the real value and remove `AI_DAILY_CALL_CAP` /
`AI_FAILOVER` overrides before continuing.**

## Suite MET — the cost readout stays honest

| ID | Area | Precondition | Steps | Expected | Pri |
|---|---|---|---|---|---|
| MET-01 | Mixed-provider cache metric | Both Gemini and Groq rows exist in the window | Open `/usage`, read the "Cache hit-rate" tile | Caption reads `over N of M cache-capable dispatches` (N < M). The percentage reflects Gemini rows only and has **not** dropped because Groq rows exist | P0 |
| MET-02 | Groq-only window | A window containing only Groq/mock rows | Open `/usage` | Hit-rate shows `—` with `no cache-capable calls yet`. It must **not** read `0%` — that would claim caching was tried and failed | P1 |
| MET-03 | Open weights are not free | Groq rows exist | Read "Projected (paid tier)" | Non-zero. A missing rate-card entry would show `$0.00` and make a real charge read as free | P0 |
| MET-04 | $/roadmap | Roadmaps generated on both providers | Read the `$ / roadmap` tile | A plausible non-zero figure. Groq-generated roadmaps should pull it **down** (15x cheaper output) | P1 |
| MET-05 | Fallback rate unmoved | After suites GRQ + FO | Read the fallback-rate tile | Reflects genuine malformed/errored dispatches. FO's deliberate Gemini errors will raise it — confirm the number matches what you actually caused | P2 |

## Suite BILL — the config drift found during this phase

| ID | Area | Precondition | Steps | Expected | Pri |
|---|---|---|---|---|---|
| BILL-01 | Paid billing records real cost | `AI_BILLING_MODE=paid`, restart | Generate anything, then open `/usage` | "Actually charged" is **non-zero** and the note reads `billed at the rate card` | P0 |
| BILL-02 | Historical rows unchanged | — | Look at the window total | Rows written before the flag was set still carry `cost_usd = 0`. This is expected — no backfill was done, and the projection recomputes the true figure from the token columns | P1 |
| BILL-03 | Free mode still honest | Set `AI_BILLING_MODE=free`, restart, generate once | Read "Actually charged" | `$0.00` with `free tier — nothing was billed`. Restore to `paid` afterwards | P2 |
| BILL-04 | Ground truth | — | Compare the `/usage` projected total against the Gemini console's reported spend for the same window | Same order of magnitude. A large divergence means the rate card is stale — raise it as a bug rather than adjusting the number to match | P1 |

## Suite SEC — security invariants (Rules 1, 2)

| ID | Area | Precondition | Steps | Expected | Pri |
|---|---|---|---|---|---|
| SEC-01 | Key never reaches the browser | App running on Groq | DevTools → Sources/Network; search all JS and payloads for `gsk_` | Zero hits. The Groq key is server-only, like the Gemini one | P0 |
| SEC-02 | No unauthenticated AI route | Logged out / private window | `curl -X POST` the generate route with no session | 401/redirect. No dispatch appears in `ai_usage` | P0 |
| SEC-03 | Key not in the bundle | — | `grep -r "gsk_" .next/static` | No matches | P0 |
| SEC-04 | Cross-user metering | Two accounts | Generate on account A, open `/usage` as B | B sees only B's rows (RLS, Rule 5) | P0 |
| SEC-05 | No secrets staged | — | `git status` + `git diff --cached` before committing | No `.env*`, no key strings anywhere in tracked files | P0 |

## Suite CFG — configuration edge cases

| ID | Area | Precondition | Steps | Expected | Pri |
|---|---|---|---|---|---|
| CFG-01 | Explicit groq, no key | `AI_PROVIDER=groq`, `GROQ_API_KEY` commented out, restart | Generate a roadmap | Seeded fallback and the `/usage` badge reads `AI OFF`. It must **not** silently serve Gemini — that would make an A/B comparison compare a model against itself | P0 |
| CFG-02 | Groq-only deployment | Remove `GEMINI_API_KEY`, keep `GROQ_API_KEY`, no `AI_PROVIDER`, restart | Generate a roadmap, then open a topic | Roadmap generates on Groq. Topic detail renders ungrounded/unverified. Nothing crashes | P1 |
| CFG-03 | Mock unaffected | `AI_PROVIDER=mock` with a valid `GROQ_API_KEY` present, restart | Generate a roadmap | Mock content. **No** Groq dispatch in `ai_usage` — the determinism guarantee | P0 |
| CFG-04 | Mock outage does not recover | `AI_PROVIDER=mock`, `AI_MOCK_MODE=error`, `GROQ_API_KEY` present, restart | Generate a roadmap | **Seeded fallback.** If a real generated roadmap appears, the mock failed over and every Rule 9 E2E spec is now untrustworthy — P0 stop-the-line | P0 |
| CFG-05 | All AI off | Comment out both keys, no `AI_PROVIDER`, restart | Use the app end to end | Fully usable on seeded content throughout (Rule 9). Badge reads `AI OFF` | P0 |

## Suite UI — presentation (what automation deliberately skips)

| ID | Area | Precondition | Steps | Expected | Pri |
|---|---|---|---|---|---|
| UI-01 | Light + dark | Groq rows on `/usage` | Toggle both themes | Cache tile caption legible in both; no raw-hex regression (Rule 21) | P1 |
| UI-02 | Long caption | Mixed-provider window | Narrow the viewport to mobile | `over N of M cache-capable dispatches` does not overflow or clip its tile | P2 |
| UI-03 | Model id overflow | Groq rows on `/usage` | Inspect the per-route/model display | `openai/gpt-oss-120b` is longer than any Gemini id — confirm it does not break the layout | P2 |

---

## Report format

Copy this back filled in. **Do not mark a case Pass you did not actually run** —
write `SKIPPED` and why. A status line is read back months later as fact.

```
Phase 6.1 manual QA — <date>
GRQ:  01 __  02 __  03 __  04 __  05 __  06 __  07 __
EMB:  01 __  02 __  03 __  04 __
FO:   01 __  02 __  03 __  04 __  05 __  06 __  07 __  08 __  09 __
MET:  01 __  02 __  03 __  04 __  05 __
BILL: 01 __  02 __  03 __  04 __
SEC:  01 __  02 __  03 __  04 __  05 __
CFG:  01 __  02 __  03 __  04 __  05 __
UI:   01 __  02 __  03 __

Fails / notes:
Skipped (and why):
```

---

## Manual pass — ledger (2026-09-20)

Recorded per-suite rather than as a total, because "42/42" over an assumption is
the thing Phase 4.5 got wrong and Phase 5 fixed.

**Preconditions confirmed by the owner:** `AI_BILLING_MODE=paid` set and the dev
server restarted. Groq console reports **free tier** — which is why the measured
`x-ratelimit-limit-tokens: 8000` (tokens per *minute*) is the real ceiling on the
failover path, not the 1,000 requests/day.

| Suite | Cases | Status |
|---|---|---|
| GRQ | 7 | **Pass** — run case-by-case by the owner |
| EMB | 4 | **Pass** — run case-by-case by the owner |
| FO | 9 | **Pass** — run case-by-case by the owner |
| MET | 5 | **Pass** — run case-by-case by the owner |
| UI | 3 | **Pass** — run case-by-case by the owner |
| SEC | 5 | **Covered, not hand-run** — see below |
| BILL | 4 | **NOT RUN** |
| CFG | 5 | **NOT RUN** |

### SEC — resolved without a manual pass, and how

Not written off; each case has evidence:

- **SEC-01 / SEC-03** (key never reaches the browser) — verified this session:
  `grep -rlE 'gsk_[A-Za-z0-9]{10}|AIza[A-Za-z0-9]{10}' .next/static` is clean
  against a fresh production build. SEC-01's DevTools walk and SEC-03's grep rest
  on the same evidence; the grep is the stronger form.
- **SEC-02** (no unauthenticated AI route) — automated: E2E `ai.spec.ts` suite
  **AI-A**, four route assertions, green in the 81/81 run.
- **SEC-04** (cross-user `ai_usage`) — automated: E2E **AI-20**, "User B cannot
  read User A's `ai_usage` rows", green in the same run.
- **SEC-05** (nothing secret staged) — verified: no `.env*` file is tracked, and
  the pre-commit scan of staged content matched only the literal `"gsk_test"`
  fixtures in `tests/unit/ai-groq.test.ts`.

### Still outstanding — 9 cases, of which 2 actually matter

**BILL-01 and CFG-04 cannot be inferred from anything else and are ~2 minutes each.**

- **BILL-01** — `AI_BILLING_MODE=paid` was set *in response to this phase* and
  nothing has confirmed it took effect. Until a dispatch is checked, "the billing
  column is honest again" is an intention, not a fact. (Attempted via Supabase MCP
  this session: unauthorized in that shell, so it needs a human on `/usage`.)
- **CFG-04** — the stop-the-line case. If the mock provider *does* recover via
  Groq under `AI_MOCK_MODE=error`, then every Rule 9 E2E spec is green for the
  wrong reason and the 81/81 figure above stops meaning what it says.

The other seven are lower-stakes: **BILL-02/03/04** are reporting nuances, and
**CFG-01/02/03/05** are env permutations whose *policy* is exhaustively unit-tested
(12 cases in `ai-groq.test.ts` covering `providerName()` precedence and
`failoverFor()`), leaving only the integration unproven.
