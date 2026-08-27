# Phase 4.5 — RAG: grounding topic resources on a curated corpus

Manual test matrix (Rule 27). Run these by hand and report `ID Pass` /
`ID FAIL — actual vs expected`. Fails become bug entries in
[../memory.md](../memory.md) and are fixed before the phase is marked demoable.

Companion docs: [README.md](./README.md) (harness + gotchas) ·
[phase-4-ai-gateway.md](./phase-4-ai-gateway.md) (the gateway matrix this builds on).

---

## What automation already covers — and what it deliberately cannot

**Automated and green as of 2026-08-14:** Vitest **210/210**, Playwright **64/64**.

- Vitest: the grounding validator (every rejection path — out-of-range citation,
  duplicate citation, non-integer, unmappable kind, empty selection), the
  retrieval-query builder, the corpus-search mapping and its failure-is-empty
  contract, and `gateway.embed()`'s cap / width-check / no-retry / metering
  behaviour against a fake provider.
- Playwright: both RAG branches end to end on the **mock** provider —
  grounded (RAG-01…06) and empty-retrieval fallback (RAG-11…13) — plus the
  corpus RLS cases (RAG-07…10).

**Three things automation cannot tell you, which is what this matrix is for:**

1. **The real embedding model is never exercised.** The E2E suite runs on the
   mock provider (see README). Its embeddings are *lexical* and share no vector
   space with the corpus's real Gemini vectors, so the suite pins the pipeline's
   plumbing while running with the similarity floor forced to `-1` (hit) or `2`
   (miss). **Nothing automated proves retrieval actually retrieves the right
   documents.** Suites **LIVE** and **RANK** are the only check on that.
2. **Nothing automated judges whether a resource is *good*.** "The URL is in the
   corpus" is machine-checkable; "this is the document I'd actually send someone
   studying reconciliation" is not.
3. **Feel, theme and visual fidelity** — the VERIFIED chip in both themes, link
   affordance, layout with mixed content.

---

## Setup — do this once before the suites

| # | Step |
|---|------|
| S1 | Migrations `0007_resources.sql` … `0011_resources_backend.sql` applied (SQL Editor) — 0007 is the schema, 0008–0011 are corpus batches. |
| S2 | `.env.local` has `CORPUS_EMBED_USER_ID` = your own account's auth UID. |
| S3 | `npm run embed:corpus` reports **`0 failed`** (or `Nothing to embed` if already done) |
| S4 | `.env.local` has a working `GEMINI_API_KEY` and **no** `AI_PROVIDER=mock`. |
| S5 | **Restart the dev server** after any `.env.local` change — Next reads env only at startup. This has cost this project a debugging cycle before (memory.md). |

Verify with this in the SQL Editor — expect `202 / 202 / 26`:

```sql
select count(*) total, count(embedding) embedded, count(distinct topic_area) areas
from public.resources;
```

---

## Suite LIVE — real grounding against the real provider (P0)

> The only suite that exercises the actual Gemini embedding + the real corpus.
> If you skip it, the provider integration has been tested by nobody.

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| LIVE-01 | Grounded generation | S1–S5 done; a roadmap with a React/JS topic | Open a topic like **Reconciliation & keys** → **Generate with AI** | Detail appears. Source label reads **"grounded · vetted sources"**. Resources are **blue links** with green **VERIFIED** chips. **No** amber UNVERIFIED chip. | P0 |
| LIVE-02 | Links are real | LIVE-01 done | Click **every** resource link | Each opens a real, live page **on the topic** — no 404, no redirect to a site's home page | P0 |
| LIVE-03 | Grounding is honest | LIVE-01 done | Compare each resource title on screen against the page it opens | Titles match the real documents. **Fail if any resource names a document that isn't what opened** | P0 |
| LIVE-04 | Relevance | LIVE-01 done | Read the resource list for the topic | Documents are genuinely about that topic. **Fail in both directions**: fail if an obviously irrelevant doc is listed, *and* fail if the list is padded with weak matches instead of being short | P0 |
| LIVE-05 | The "why" line | LIVE-01 done | Read the small mono line under each title | Reads `hostname · <reason>`; the reason says something specific about *that* document, not a generic phrase repeated across rows | P1 |
| LIVE-06 | Niche topic falls back | S1–S5; a topic the corpus has nothing for (make one: a roadmap for a **Fullstack** role, then open a database/API topic) | Generate | Source is **"ai-generated"**, resources carry the amber **UNVERIFIED** chip and are **not** links. The flow still completes | P0 |
| LIVE-07 | Mental model stays generated | LIVE-01 done | Read the Mental model panel | It is written prose about the topic, not a summary of the retrieved documents. (Only the resources are grounded — by design) | P1 |
| LIVE-08 | Exercises stay generated | LIVE-01 done | Read the From-scratch list | 2–4 build/explain-from-memory exercises, unrelated to the corpus | P1 |
| LIVE-09 | Regenerate | LIVE-01 done | Press **Regenerate study material** | Completes; still grounded. Resource set may differ slightly (temperature) but every link is still a corpus link | P1 |

---

## Suite RANK — retrieval quality (P0, and the one that needs judgement)

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| RANK-01 | Calibration holds | S1–S5 | `npm run probe:retrieval` | Exits 0 and prints `Floor 0.64 separates them.` Every **OFF-DOMAIN** score is below 0.64 | P0 |
| RANK-02 | In-domain ranking | RANK-01 | Read the IN-DOMAIN block | For each topic, the top document is the one you'd pick yourself. **Fail if the best document is not in the top 2** | P0 |
| RANK-03 | The floor's job | RANK-01 | Read the OFF-DOMAIN block (Rust / SwiftUI / Kubernetes / ML / Unity / firmware) | **Zero** documents pass. These score ~0.55–0.62 — well above a naive 0.5 threshold, which is why the floor is 0.64 and why it was re-raised when the corpus grew | P0 |
| RANK-04 | Short lists are allowed | RANK-01 | Look at a topic where only 2 documents pass the floor | Two is a correct answer. A list of 5 for every topic would mean the floor isn't doing anything | P1 |

---

## Suite FALL — every way retrieval can fail (P0, Rule 9)

> Each row needs an `.env.local` edit **and a dev-server restart**. Set
> `AI_PROVIDER=mock` for these so failures are injectable on demand.

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| FALL-01 | Embedding provider down | `AI_PROVIDER=mock`, `AI_MOCK_MODE=error`, restart | Generate topic detail | 200 with usable content. Source **"template"**, note explains the model is unreachable. No 5xx, no spinner that never ends | P0 |
| FALL-02 | Malformed embedding width | `AI_MOCK_MODE=malformed`, restart | Generate topic detail | Completes. Retrieval contributes nothing (the wrong-width vector is rejected) and the flow still ends with detail on screen | P0 |
| FALL-03 | Retry recovers | `AI_MOCK_MODE=malformed-once`, restart | Generate topic detail | Completes with generated content — the retry recovered and the user sees no error at all | P1 |
| FALL-04 | Empty corpus | `RAG_MIN_SIMILARITY=2`, restart (`AI_MOCK_MODE=ok`) | Generate topic detail | Source **"ai-generated"**, amber UNVERIFIED chips, no links, `retrieved: 0` | P0 |
| FALL-05 | Corpus table missing | Simulate: in SQL Editor, `alter table public.resources rename to resources_tmp;` restart **not** needed | Generate topic detail | Topic still completes on the ungrounded path. **Then rename it back**: `alter table public.resources_tmp rename to resources;` | P1 |
| FALL-06 | Cap reached mid-pipeline | `AI_DAILY_CALL_CAP=1`, restart | Generate topic detail | The embedding spends the only call; the completion is refused; you get the **template** with a "daily AI cap reached" note. Flow completes | P0 |
| FALL-07 | AI switched off entirely | Comment out `GEMINI_API_KEY`, unset `AI_PROVIDER`, restart | Generate topic detail | Template content, "AI isn't configured" note. **The whole app still works** — this is Rule 9's real test | P0 |
| FALL-08 | Unembedded corpus | In SQL Editor: `update public.resources set embedding = null;` | Generate topic detail | Falls back to ungrounded/unverified — never returns a document with no demonstrated relevance. **Then re-run `npm run embed:corpus`** | P1 |

---

## Suite SEC — the corpus is public to read, writable by nobody (P0)

> `resources` is the deliberate Rule 5 exception. These cases prove the exception
> is *scoped*, not a hole. Run them in the **browser console** while signed in
> (that is the attacker's actual position — a real session and the anon key).

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| SEC-01 | Public read works | Signed in, on any app page | Console: `await (await fetch('/api/usage')).json()` to confirm session, then fetch the corpus via PostgREST with the anon key | Rows come back. (If this fails, SEC-02/03 would pass for the wrong reason) | P0 |
| SEC-02 | Insert denied | As above | POST a row to `/rest/v1/resources` with the anon key and your access token | **Rejected** (4xx). Nothing is added — re-count and confirm still 48 | P0 |
| SEC-03 | Delete denied | As above | DELETE `/rest/v1/resources?id=not.is.null` | Corpus **still has 48 rows** afterwards. (A silent 200 no-op is acceptable; rows disappearing is not) | P0 |
| SEC-04 | Update denied | As above | PATCH a row's `url` to something else | The URL is unchanged | P0 |
| SEC-05 | Signed-out read | Sign out | Fetch the corpus with only the anon key | Rows come back — this is shared public reference data, and that is intended | P1 |
| SEC-06 | Ownership before spend | Two accounts | As User B, POST `/api/topics/<A's topic id>/detail` | **404**, and **no** new `ai_usage` row for B — ownership is checked *before* the embedding is dispatched | P0 |
| SEC-07 | Anonymous blocked | Signed out | POST `/api/topics/<id>/detail` with no session | Blocked (307 → /login or 401). Never a generation | P0 |

Handy console snippet for SEC-02/03/04 (fill in your project ref):

```js
const url = '<NEXT_PUBLIC_SUPABASE_URL>', key = '<NEXT_PUBLIC_SUPABASE_ANON_KEY>';
const tok = JSON.parse(atob(decodeURIComponent(
  document.cookie.split('; ').filter(c=>/^sb-.+-auth-token/.test(c))
    .sort().map(c=>c.split('=').slice(1).join('=')).join('')
).replace(/^base64-/,''))).access_token;
const h = {apikey:key, Authorization:`Bearer ${tok}`, 'Content-Type':'application/json'};
// count
(await (await fetch(`${url}/rest/v1/resources?select=id`, {headers:h})).json()).length
```

---

## Suite COST — the price of grounding is visible (P1)

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| COST-01 | Two calls per topic | Real provider, fresh topic | Note `/usage` "used today", generate detail, reload `/usage` | Increases by **2** — one embedding + one completion. Grounding is not free and the readout says so | P0 |
| COST-02 | Embedding tier is labelled | COST-01 done | Look at the per-route breakdown for `/api/topics/detail` | Shows the calls; the embedding model appears in the model list | P1 |
| COST-03 | Backfill isn't in your product numbers | S3 done as your own account | Open `/usage` as **qa-a** | The corpus embeddings do **not** appear — they were metered against `CORPUS_EMBED_USER_ID` | P1 |
| COST-04 | $/roadmap unaffected | Any | `/usage` | The $/roadmap figure still divides roadmap-route spend by roadmaps — topic-detail embeddings do not leak into it | P1 |

---

## Suite UI — visual + theme fidelity (P1, both themes)

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| UI-01 | VERIFIED chip, dark | Grounded topic, dark theme | Look at the resource rows | Green chip, legible against the panel, same size/shape as the amber UNVERIFIED chip | P1 |
| UI-02 | VERIFIED chip, light | Toggle to light | Same | Legible in light too; no raw-hex mismatch (Rule 21 — all colors are OKLCH tokens) | P1 |
| UI-03 | Link affordance | Grounded topic | Look at, then hover, a resource title | Reads as a link (accent color) and is obviously clickable | P1 |
| UI-04 | Opens in a new tab | Grounded topic | Click a link | Opens in a new tab and **your study page is still there** behind it | P1 |
| UI-05 | Long titles | Grounded topic with a long doc title | Look at the row | Wraps or truncates cleanly; the chips stay on one line and don't overlap | P2 |
| UI-06 | Mixed states never co-occur | Compare a grounded topic and a fallback topic | Look at both | A row is *either* linked+VERIFIED *or* plain+UNVERIFIED. **Fail if any row is both or neither** | P0 |
| UI-07 | Source label | Both kinds of topic | Read the label top-right of the Mental model panel | `grounded · vetted sources` / `ai-generated` / `template` — and it matches what the resources below actually are | P0 |
| UI-08 | Print view | Grounded topic | Print preview the roadmap | Nothing from this phase breaks the print layout | P2 |

---

## Suite DATA — corpus integrity (P1)

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| DATA-01 | Every link resolves | S1–S3 | Spot-check 10 URLs from `select url from public.resources;` | All 200. (All 202 were HTTP-verified when their migration was written — this checks for rot) | P0 |
| DATA-02 | No duplicates | S1 | `select url, count(*) from public.resources group by url having count(*) > 1;` | Zero rows — the `unique` constraint holds | P1 |
| DATA-03 | Re-runnable seed | S1–S2 | Run `0008_resources_seed.sql` a second time | Succeeds, row count unchanged (`on conflict do nothing`) | P1 |
| DATA-04 | Re-embedding is safe | S3 | `npm run embed:corpus` again | Reports **nothing to embed**. Then `npm run embed:corpus -- --all` re-embeds everything | P1 |
| DATA-05 | Areas are balanced | S1 | `select topic_area, count(*) from public.resources group by 1 order by 2 desc;` | 26 areas; no area is empty | P2 |

---

## Report format

Reply with one line per case:

```
LIVE-01 Pass
LIVE-04 FAIL — "Optimize long tasks" listed for "Reconciliation & keys"; expected React docs only
RANK-03 Pass
...
```

**Say explicitly which cases you skipped.** Several here need awkward setup — an
`.env.local` edit plus a restart (FALL-*), a second account (SEC-06), a SQL edit
you must undo (FALL-05, FALL-08). A skipped case reported as a pass becomes a
false claim in `phases.md` that gets read back months later as fact, so "skipped"
is a perfectly good answer and "eyeballed it" is worth saying too.
