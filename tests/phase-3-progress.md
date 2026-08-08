# Test Cases — Phase 3: Honest progress dashboard

> **QA gate (Rule 27).** Manual test pass for the Phase 3 feature set: the
> `study_sessions` schema + RLS, the pure progress aggregation, the `/api/sessions`
> route, the Progress screen (banner, stat tiles, both hand-rolled charts, blockers),
> and the switch of Library/Roadmap onto **derived** status. Run each case, mark
> **Pass / Fail**, and report back. Any Fail → logged in [memory.md](../memory.md) as
> a bug and fixed before Phase 3 is called demoable.
>
> **Legend.** Priority: **P0** = blocker/security/data-integrity · **P1** = core flow ·
> **P2** = polish/UX. Report format at the bottom.
>
> **Already covered by automation — do NOT re-do by hand** (53 unit + 13 E2E, green):
> the whole pace/status/attribution/trend arithmetic incl. the 0.8 boundary and the
> week-elapsed floor (`tests/unit/progress.test.ts`); anon-blocked logging, minutes
> boundary validation (0/-30/1441/45.5/NaN/"60"/null/1/1440), missing-roadmapId 400,
> unknown-roadmap 404, the log→dashboard round-trip, the form path + reload
> persistence, unattributed-hours exclusion, cross-roadmap topic rejection, User-B
> cross-user 404, client-supplied `logged_at` ignored, fresh-roadmap-no-banner, and
> the accuracy empty state (`tests/e2e/sessions.spec.ts`).
> **This doc covers what automation can't judge:** visual fidelity to the design,
> theme legibility, chart rendering at real proportions, and — most importantly —
> the **multi-week behaviour that needs a clock you can move** (the banner, stalled
> status, and blockers only appear once time has passed).
>
> **Prereqs before you start:**
> - Migration `0005_study_sessions.sql` applied (confirmed — table, RLS policy
>   `study_sessions_all_own`, both indexes, advisors clean).
> - Dev server running (`npm run dev`, http://localhost:3001).
> - Signed in as a real user with **at least one roadmap**.
> - **DevTools → Network + Console** open for the API/security cases.
> - For the RLS case you need a second account: **User A** / **User B**.
> - **Several cases require editing `roadmaps.created_at` or `study_sessions.logged_at`
>   in the Supabase Table Editor** — this is the only way to simulate elapsed time.
>   Each such case says so explicitly and gives the value to set.

---

## Suite 1 — Logging study time (`/api/sessions` + the form)

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| LG-01 | Happy path | A roadmap exists | Open **Progress**, enter `90` minutes, leave topic as "Unattributed", click **Log time** | Button shows "Logging…", then **Hours logged** tile moves to `1.5`; no page navigation, no layout jump | P1 |
| LG-02 | Topic attribution fills a bar | LG-01 done | Log `60` minutes against a **Week 1** topic | The **W1** logged (accent) bar grows; total hours rises to `2.5` | P1 |
| LG-03 | Unattributed fills no bar | — | Log `120` minutes with topic = "Unattributed" | Total hours rises by 2h but **no** week bar changes — bars legitimately sum to less than the total | P1 |
| LG-04 | Form resets after success | LG-01 done | Observe the form after a successful log | Minutes resets to `60`, topic select resets to "Unattributed" | P2 |
| LG-05 | Client-side validation message | — | Enter `0`, then `1441`, then `12.5`; submit each | Inline red error: "Enter a whole number of minutes between 1 and 1440."; **no** network request is sent | P1 |
| LG-06 | Server failure is surfaced | — | DevTools → Offline, enter `60`, click **Log time** | Red inline error ("Could not reach the server."); the tile does **not** move; the form stays usable and retryable | P0 |
| LG-07 | Double-click guard | — | Double-click **Log time** rapidly | Button is disabled while in flight; check Network — exactly **one** POST, hours rise by one session's worth only | P0 |
| LG-08 | Topic list is scoped | Two roadmaps exist | Open the topic dropdown on Progress | Only topics from the **reported** (most recent) roadmap are listed, each prefixed `W<n> ·` | P1 |
| LG-09 | Empty state | Delete every roadmap | Open **Progress** | Dashed empty state: "No roadmap to report on yet" + working "Create a roadmap →" button; **no** charts, no banner, no crash | P1 |

---

## Suite 2 — The Progress screen: fidelity + rendering

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| PS-01 | Design fidelity — tiles | Progress open | Compare the 4 stat tiles against the design source | Mono uppercase 11px label, 24px/700 value with `-0.02em`, 12px sub; panel bg, 1px border, 10px radius; 4-across grid | P2 |
| PS-02 | Hours chart fidelity | Some hours logged | Inspect the hours chart | Title "Hours: logged vs planned"; legend "■ logged" (accent) / "■ planned" (faint); paired 13px bars per week, 3px gap, rounded tops; `W1…Wn` labels in mono | P2 |
| PS-03 | Bar scaling is proportional | Log 10h into one week | Compare that week's logged bar to its planned bar | Heights are proportional to the real numbers (a 10h/10h week shows equal-height bars); tallest bar fills the box; no bar overflows its container | P1 |
| PS-04 | Bar hover tooltips | Hours logged | Hover a logged bar, then a planned bar | Native tooltips read "<n>h logged" and "<n>h planned" with the real values | P2 |
| PS-05 | Accuracy chart empty state | A roadmap with < 3 recall reviews | Look at the accuracy panel | Dashed empty box: "Not enough reviews yet — grade a few recall cards and the trend appears here."; accuracy tile shows `—`, **not** `0%` | P1 |
| PS-06 | Accuracy chart renders | Grade **≥ 6** recall cards on `/recall` (mixed right/wrong), then open Progress | Inspect the SVG | Polyline + dots drawn; y-axis labels 100/80/60; two dashed gridlines; line colour matches the accuracy band (green ≥80, amber 60–79, red <60) | P1 |
| PS-07 | Accuracy is clipped, not clamped-off | Grade ≥6 cards nearly all **wrong** | Inspect the line | Line sits **on** the axis floor (40%) rather than disappearing below the chart | P2 |
| PS-08 | Charts are hand-rolled (Rule 22) | Progress open | View page source / DevTools Elements | The accuracy chart is a real inline `<svg>` with `<polyline>`/`<circle>`; hours bars are styled divs; **no** charting library in the bundle | P0 |
| PS-09 | No raw hex (Rule 21) | Progress open | DevTools → inspect banner, bars, line, tiles | Every colour resolves from an OKLCH `var(--…)` token; no hard-coded hex in the Progress components | P1 |
| PS-10 | Light + dark (Rule 21) | Progress open with data | Toggle theme | Both themes legible: banner red-on-red-soft, accent bars, faint planned bars, gridlines, dot colours, muted blocker text — nothing washed out or invisible | P1 |
| PS-11 | Long content doesn't break layout | A roadmap with a long title | Open Progress | Header title ellipsises; banner text wraps (`text-wrap: pretty`); tiles keep their 4-across grid; no horizontal scroll | P2 |
| PS-12 | Blockers empty state | A healthy, just-created roadmap with hours logged | Read the blockers panel | "Nothing is blocking you right now — you're N weeks in with Xh logged against Yh expected." — no invented blockers | P1 |

---

## Suite 3 — Pace, status + blockers over simulated time (Table Editor)

> These are the cases automation can't reach: they need elapsed time. For each,
> open **Supabase → Table Editor → `roadmaps`**, edit `created_at` on your test
> roadmap to the given value, save, then reload `/progress`.
> **Reset `created_at` to "now" when you're done.**

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| PC-01 | Fresh roadmap is never "behind" | New roadmap, 0 hours | Leave `created_at` = today; open Progress | **No** BEHIND PACE banner; status chip = **Not started**; Pace tile = `—` / "less than a week in"; Hours expected = 0 | P0 |
| PC-02 | Week boundary at day 7 | 0 hours logged | Set `created_at` = **6 days ago** → reload; then **7 days ago** → reload | At 6 days: still no banner. At 7 days: **BEHIND PACE** banner appears (12h expected, 0 logged) | P1 |
| PC-03 | Banner numbers are real | `created_at` = 14 days ago, log `360` min (6h) | Read the banner sentence | "You've logged **6 of 60** planned hours (10%). Current pace is **3 hrs/week** against 12 planned. At this rate you finish **~N days past** your target." — every number matches the data | P0 |
| PC-04 | On-track hides the banner | `created_at` = 7 days ago | Log enough minutes to reach **12h** total (e.g. 720) | Banner disappears; status chip = **On track**; Pace tile is not red | P1 |
| PC-05 | The 80% boundary | `created_at` = 7 days ago (12h expected) | Log exactly **576** minutes (9.6h) → reload. Then reduce to **570** min (9.5h) → reload | At 9.6h: **On track** (this is the float-boundary bug fixed on 2026-08-08 — must not read "behind"). At 9.5h: **Behind pace** | P0 |
| PC-06 | Stalled beats behind | `created_at` = 30 days ago, one session | Edit that session's `logged_at` to **15 days ago**; reload | Banner badge reads **STALLED** (not "BEHIND PACE") and adds "Nothing has been logged in 15 days."; status chip = **Stalled** | P1 |
| PC-07 | Untouched-week blocker | `created_at` = 21 days ago; hours logged **only** against Week 1 topics | Read the blockers panel | A blocker names the **heaviest untouched week** by number and title, with its planned hours and the weeks elapsed | P1 |
| PC-08 | Silence blocker | Last session ≥ 3 days ago | Read the blockers panel | "0 hours logged in the last N days." with the correct N, and a body quoting the plan's real h/week and h/day | P1 |
| PC-09 | Never-logged blocker | `created_at` = 14 days ago, **zero** sessions | Read the blockers panel | "No study hours logged at all." (distinct from the silence wording) + the expected-hours figure | P1 |
| PC-10 | Accuracy blocker | Grade ≥6 recall cards mostly **wrong** | Read the blockers panel | "Recall accuracy is flat/falling, not rising." with the real % and review count | P1 |
| PC-11 | Elapsed weeks cap | `created_at` = **1 year ago** | Open Progress | Expected hours caps at the full plan (60h), not a runaway number; the banner says you're short by a sane amount | P1 |
| PC-12 | Mastery ⇒ done (Rule 16) | Master **every** topic in a roadmap | Open Progress and Library | Status chip = **Complete** on both screens, regardless of hours logged | P1 |

---

## Suite 4 — Derived status on Library + Roadmap (the Phase 3 switch)

> Phase 3 stopped reading `roadmaps.status` / `roadmaps.hours_logged` (both are now
> vestigial and never written). These cases prove the screens agree with each other.

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| DS-01 | Library hours are real | Log 90 min on Progress | Open **Library** | The card's hours chip shows `1.5`, matching Progress — **not** `0` | P0 |
| DS-02 | Library status matches Progress | PC-03 state (behind) | Compare the Library card badge to the Progress chip | Both read **Behind pace**; the card's progress-bar fill uses the same status colour | P0 |
| DS-03 | Roadmap screen agrees | Same roadmap | Open **Roadmap** | Header status chip and the **Hours** tile match Library and Progress exactly | P0 |
| DS-04 | Stale column is ignored | — | In Table Editor set `roadmaps.status` = `'done'` and `hours_logged` = `999`; reload all three screens | All three screens **ignore** both columns and keep showing the derived values — proof the stored status can't lie | P0 |
| DS-05 | Multi-roadmap independence | Two roadmaps, hours on only one | Open Library | Each card shows its **own** hours/status; the untouched one is not credited with the other's time | P1 |

---

## Suite 5 — Security, integrity + concurrency

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| SEC-01 | RLS: cross-user read | User A has sessions | Sign in as **User B**, open Progress | B sees **only** their own data (or the empty state) — none of A's hours, bars, or blockers | P0 |
| SEC-02 | RLS: direct table read | Signed in as B | In Console: `await (await fetch('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roadmapId:'<A_ROADMAP_ID>',minutes:60})})).status` | Returns **404** — B can't even confirm A's roadmap exists | P0 |
| SEC-03 | Minutes cap can't be bypassed | Signed in | In Console, POST `{roadmapId:'<yours>', minutes: 100000}` | **400**; nothing inserted; hours unchanged | P0 |
| SEC-04 | DB constraint backstops the route | Signed in | In Supabase **SQL Editor** run: `insert into study_sessions (user_id, roadmap_id, minutes) values (auth.uid(), '<your_roadmap>', 99999);` | Fails with a **check constraint violation** — the DB refuses even when the route is bypassed | P0 |
| SEC-05 | Can't log to someone else's topic | Two of your **own** roadmaps | POST `{roadmapId:'<roadmap B>', topicId:'<a topic from roadmap A>', minutes:60}` | **404** "Topic not found in this roadmap." — cross-roadmap attribution is refused | P0 |
| SEC-06 | Backdating is refused | Signed in | POST with `logged_at:'2020-01-01T00:00:00Z'` | **201**, but the returned `loggedAt` is **now** — a user can't manufacture an on-pace history | P0 |
| SEC-07 | Deleting a topic keeps the hours | Hours logged against a topic | Delete that topic's **roadmap**… then instead: log against a topic, then delete just that topic row in Table Editor | Session row survives with `topic_id = NULL`; total hours unchanged; it simply stops filling a week bar | P1 |
| SEC-08 | Roadmap delete cascades sessions | Hours logged | Delete the roadmap from Library | Its `study_sessions` rows are gone (check Table Editor); Progress falls back to the next roadmap or the empty state | P1 |
| SEC-09 | Concurrent logging | Progress open in **two tabs** | Log 60 min in tab A, then 60 min in tab B, then reload both | Total is **2h** — both sessions landed, neither overwrote the other (append-only, no lost update) | P1 |
| SEC-10 | Unauthenticated access | Signed out | Visit `/progress` directly | Redirected to `/login`; no dashboard data flashes before the redirect | P0 |

---

## Report format

Reply with a line per case — ID + Pass/Fail, and for any Fail, what you saw:

```
LG-01 Pass
LG-02 Pass
...
PC-05 FAIL — showed "Behind pace" at exactly 9.6h
```

Or, if a whole suite passed: `Suite 1: all Pass`.

**Please also say explicitly which cases you did NOT run** (e.g. the Table-Editor
time-travel cases in Suite 3, or the two-account cases) so the status line in
`phases.md` records what was actually verified rather than implying a full pass.
