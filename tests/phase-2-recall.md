# Test Cases — Phase 2: Spaced repetition (the real algorithm)

> **QA gate (Rule 27).** Manual test pass for the Phase 2 feature set: the recall
> schema + RLS, the hand-written scheduler, the Recall screen, and the nav due-count
> badge. Run each case, mark **Pass / Fail**, and report back. Any Fail → logged in
> [memory.md](../memory.md) as a bug and fixed before Phase 2 is called demoable.
>
> **Legend.** Priority: **P0** = blocker/security/data-integrity · **P1** = core flow ·
> **P2** = polish/UX. Report format at the bottom.
>
> **Already covered by automation — do NOT re-do by hand** (18 unit + 8 E2E, green):
> the ladder/ease math, the +1d miss reset, ease clamping, DST-safe date math
> (`tests/unit/scheduler.test.ts`); anon-blocked grading, malformed grades, unknown
> card 404, the grade round-trip, session accuracy, and RLS cross-user isolation
> (`tests/e2e/recall.spec.ts`). **This doc covers what automation can't judge:**
> feel, timing, theme legibility, visual fidelity to the design, and multi-day
> scheduling behaviour that needs a clock you can move.
>
> **Prereqs before you start:**
> - Migration `0004_recall.sql` applied (already verified live — tables, columns,
>   RLS and `recall_due_idx` all present).
> - Dev server running (`npm run dev`, http://localhost:3001).
> - Signed in as a real user; **at least one roadmap created after this phase**
>   (roadmaps made before Phase 2 have **no** cards — that's expected, see EG-05).
> - **DevTools → Network + Console** open for the API/security cases.
> - For the RLS case you need a second account: **User A** / **User B**.
> - For SC-04/SC-05 you'll edit a `due_at` directly in the Supabase **Table Editor**.

---

## Suite 1 — Seeding the queue (`/api/roadmaps/generate`)

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| SD-01 | Cards are seeded on create | 0 roadmaps | Complete onboarding (timeline **3 weeks**, weak = React internals) | After landing on the roadmap, open **Recall** — queue is non-empty (13 cards for these answers) | P1 |
| SD-02 | Questions match their topic | SD-01 done | Read each card's uppercase topic label vs its question | Every question is genuinely about that topic (no mismatched pairs) | P1 |
| SD-03 | No duplicate cards on a padded roadmap | — | Create a roadmap with timeline **8 weeks**, weak = [Async JS] (this repeats catalog blocks) | The recall queue contains **no duplicated questions** — repeated weeks must not re-seed the same card | P0 |
| SD-04 | Rollback leaves no orphans | — | In DevTools, go offline mid-generate (or throttle to fail) | No roadmap **and** no stray recall cards left behind; Recall queue unchanged | P1 |
| SD-05 | Delete cascades cards away | A roadmap with cards | Delete that roadmap from Library, then open Recall | Its cards are gone from the queue; other roadmaps' cards remain | P0 |

---

## Suite 2 — The Recall screen (`/recall`)

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| RS-01 | Design fidelity — header | Cards due | Compare against the design source | Left: "Spaced recall. Grade yourself honestly — a 'close enough' is a miss." Right: `SCHEDULE` + chips **+1d +4d +14d +30d** | P2 |
| RS-02 | Card layout | Cards due | Inspect one card | Mono uppercase topic label (left) + `+Nd` chip (right); question at 15.5px/500; two full-width buttons **Missed it** (red) / **Got it cold** (green) | P2 |
| RS-03 | Grading feel | Cards due | Click **Got it cold** | Buttons are replaced by "✓ Got it" + "→ next review in N days"; card border turns green and dims slightly (opacity ~0.82) — feels immediate, no layout jump | P1 |
| RS-04 | Miss styling | Cards due | Click **Missed it** on another card | "✗ Missed" + "→ reset to +1d (missed)"; border turns red | P1 |
| RS-05 | Accuracy is honest | Fresh page | Grade 1 right → check; grade 1 wrong → check; grade a 3rd right → check | Accuracy reads **100%** → **50%** → **67%**; counter reads "N of M graded" and matches | P1 |
| RS-06 | Accuracy colour thresholds | — | Reach ≥70%, then 50–69%, then <50% | Green at ≥70%, amber 50–69%, red <50% (colours from tokens, correct in both themes) | P2 |
| RS-07 | Queue clear state | Cards due | Grade **every** card | "Queue clear." + "That's every card due today. Don't cram ahead — the spacing is the point." | P1 |
| RS-08 | Empty queue (nothing due) | No cards due at all | Open `/recall` | "Queue clear." + "Nothing is due right now…"; header subtitle reads "Nothing due right now"; **no** empty card frames | P1 |
| RS-09 | Double-click guard | Cards due | Double-click **Got it cold** fast | Only **one** grade is sent (check Network: exactly one POST); no double-advance of the schedule | P0 |
| RS-10 | Graded cards don't re-grade | A graded card on screen | Try clicking where the buttons were | Buttons are gone; the card cannot be re-graded without a reload | P1 |
| RS-11 | Grade failure surfaced | Cards due | DevTools → offline, then click a grade button | Red inline error ("Couldn't save that grade…"); the card stays **ungraded** and retryable — no false "Got it" | P0 |
| RS-12 | Light + dark (Rule 21) | Cards due, some graded | Toggle theme on `/recall` | Both themes legible: green/red borders, accuracy colour, chips, muted text all readable; nothing washed out | P1 |

---

## Suite 3 — The scheduler, observed end-to-end (Rules 14, 15, 17)

> The math is unit-tested; these cases confirm the **stored** result matches, and
> cover the multi-day behaviour tests can't wait for.

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| SC-01 | First correct = +1d | A never-reviewed card | Grade it **Got it cold**; in Supabase → `recall_cards`, find the row | `interval_days` = 1, `repetitions` = 1, `ease` = 2.6, `due_at` ≈ now + 1 day, `last_reviewed_at` set | P1 |
| SC-02 | A miss resets hard (Rule 17) | A card with `repetitions` ≥ 2 (grade it right twice over two days, or edit the row) | Grade it **Missed it**; check the row | `interval_days` = **1**, `repetitions` = **0**, `ease` **dropped by 0.2** (floor 1.3) | P0 |
| SC-03 | Review log is append-only | Any graded card | Open `recall_reviews` in Supabase | One row per grade you gave, with `grade`, `interval_after`, `ease_after`, `reviewed_at`; **grading again adds a row, never edits one** | P1 |
| SC-04 | Climbing the ladder | A card graded right once (`due_at` tomorrow) | In Table Editor set its `due_at` to **now**, reload `/recall`, grade right again. Repeat to walk it up | Intervals climb roughly **1 → 4 → 14 → 30** (each slightly stretched by rising ease); the `+Nd` chip previews the next gap and **matches** what you get | P1 |
| SC-05 | Not-yet-due cards are hidden | A card with `due_at` in the future | Open `/recall` | That card is **absent** from the queue (this is the Rule-13 `due_at <= now()` filter doing its job) | P0 |
| SC-06 | Chip preview matches the result | Any due card | Note the `+Nd` chip, then grade **Got it cold** | The resulting "next review in N days" **equals** the chip's number | P2 |
| SC-07 | Server owns the schedule | Any due card | In DevTools console: `fetch('/api/recall/<cardId>/grade',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grade:'right',intervalDays:9999,dueAt:'2099-01-01'})}).then(r=>r.json()).then(console.log)` | Response ignores the injected fields — `intervalDays` is the algorithm's own value (1 for a fresh card), **not** 9999. Client cannot choose its own schedule | P0 |
| SC-08 | Timezone honesty (Rule 15) | A card graded right | Compare `due_at` in Supabase (UTC) with the app's behaviour near local midnight | `due_at` is stored UTC and is exactly 24h × interval after the grade; no off-by-one-day at midnight | P1 |

---

## Suite 4 — Due-count badge (sidebar nav)

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| BG-01 | Badge shows due count | Cards due | Look at the **Recall** nav item on any screen | Accent pill with the number of due cards, matching the count on `/recall` | P1 |
| BG-02 | Badge updates after grading | Cards due | Grade some cards, then navigate to Library (or reload) | Badge count has dropped by the number graded | P1 |
| BG-03 | Badge hidden at zero | All cards graded / none due | Look at the nav | **No** badge at all (not a "0" pill) | P2 |
| BG-04 | Badge is per-user | User A has due cards | Sign in as **User B** (no roadmaps) | B sees no badge and an empty queue — never A's count | P0 |

---

## Suite 5 — Security / cross-cutting

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| XS-01 | Signed-out cannot reach Recall | Signed **out** | Open `/recall` directly | Redirected to `/login` (middleware gate); no queue content flashes first | P0 |
| XS-02 | Signed-out cannot grade | Signed **out**, a known card id | `fetch('/api/recall/<cardId>/grade',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grade:'right'})})` | Redirect to `/login` (307) or **401** — never 200, and the card's `due_at` is unchanged | P0 |
| XS-03 | Cannot grade another user's card | A's card id, signed in as **User B** | Same `fetch` as XS-02 with A's card id | **404** (RLS makes the row invisible); A's card unchanged when A reloads | P0 |
| XS-04 | "Close enough" is not a grade (Rule 17) | Signed in, own card | POST with `{"grade":"close enough"}`, then `{"grade":"RIGHT"}` | Both **400**; no row updated. The product refuses a middle option by design | P0 |
| XS-05 | Malformed body | Signed in | POST body `not json` | **400**, no crash, no write | P1 |

---

## Suite 6 — Edge cases

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| EG-01 | Long question text | — | Find the longest question in the queue | Wraps cleanly (`text-wrap: pretty`), no overflow, no horizontal scroll | P2 |
| EG-02 | Many cards | 2–3 roadmaps of cards due | Open `/recall` | All render; page scrolls smoothly; content stays in the 740px column | P2 |
| EG-03 | Concurrent grading in two tabs | Same card open in tab A and tab B | Grade it right in tab A, then right in tab B | Second grade applies to the **already-advanced** card (it schedules further out) or 404s if refiltered — but **never** corrupts the row or throws a 500 | P1 |
| EG-04 | Reload mid-session | Some cards graded | Reload `/recall` | Graded cards are gone (their `due_at` moved); session accuracy resets to "—" — expected, accuracy is per-session | P1 |
| EG-05 | Pre-Phase-2 roadmap | A roadmap created **before** this phase | Open `/recall` | It contributes **no** cards (cards are only seeded at creation). Not a bug — note it if it confuses the demo | P2 |
| EG-06 | Topic deleted, card survives | A card whose topic row is deleted directly in Supabase | Open `/recall` | The card still shows with its stored `topic_label` (that's why the label is denormalised and `topic_id` is `on delete set null`) | P2 |

---

## How to report

For each case, reply with the ID and result, e.g.:

```
SD-01 Pass
RS-09 FAIL — double-click sent 2 POSTs; card advanced twice
SC-07 Pass (returned intervalDays: 1, ignored 9999)
XS-03 Pass (404)
BG-03 FAIL — badge showed "0" instead of hiding
```

- **Just list the Fails in detail**; a bare "rest Pass" is fine for the ones that passed.
- Include the **actual** value where it differs from Expected (status code, count, what rendered).
- Console errors / warnings during any case → note them even if the case "worked".

I'll turn every Fail into a memory.md bug entry + fix, then we re-run only the failed
cases before Phase 2 is marked demoable.
