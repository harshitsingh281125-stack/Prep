# Phase 5 — Print/export + polish

Manual test matrix (Rule 27). Run these by hand and report `ID Pass` /
`ID FAIL — actual vs expected`. Fails become bug entries in
[../memory.md](../memory.md) and are fixed before the phase is marked demoable.

Companion docs: [README.md](./README.md) (harness + gotchas) ·
[phase-4-ai-gateway.md](./phase-4-ai-gateway.md) (the FALL env-injection pattern
suite ROLE below reuses).

---

## What automation already covers — and what it deliberately cannot

**Automated and green as of 2026-09-02:** Vitest **248/248**, Playwright **73/73**.

- Vitest: the print recall-schedule bucketing including every UTC day boundary
  (`tests/unit/print-schedule.test.ts`), and the whole role/track/mismatch
  decision table plus the seeded fallback's behaviour under a backend answer set
  (`tests/unit/catalog-track.test.ts`).
- Playwright: the print route's security surface end to end — owner 200,
  cross-user 404, anonymous redirect, unknown id 404 — that it renders outside
  the app shell, that the Export link round-trips, and that a backend answer set
  generates and persists its provenance (`tests/e2e/print.spec.ts`); plus the
  content marker's full round-trip (`CONTENT-01` in `study-flow.spec.ts`) —
  every topic reads NO CONTENT on a fresh roadmap, and after generating one
  topic's detail exactly one chip flips to the source the API says it saved.

**Five things automation cannot tell you, which is what this matrix is for:**

1. **What the page actually looks like on paper.** Playwright asserts that
   `.print-week` elements exist; it says nothing about whether a week card splits
   across a page break, whether the margins are right, or whether the thing is
   legible in greyscale. Suite **PRINT** is the only check on that.
2. **The template-mismatch notice in its real state.** Reaching it needs the
   seeded fallback to have actually run, which needs `AI_MOCK_MODE=error` and a
   dev-server restart — the same treatment the Phase 4 FALL cases get. Suite
   **ROLE**.
3. **Responsive + keyboard + screen-reader behaviour.** Suites **RESP** and
   **A11Y**. A CSS breakpoint that "looks right" in devtools and a real phone are
   not the same claim.
4. **Theme fidelity and feel** — the loading skeleton's timing, both themes on
   every new surface. Suite **UI**.
5. **Whether the content markers actually read at a glance.** `CONTENT-01`
   proves the right chip renders for the right row; only a person can say whether
   a wall of them is scannable or noise. Suite **MARK**.

---

## Setup — do this once before the suites

| # | Step |
|---|------|
| S1 | Migration `0012_roadmap_provenance.sql` applied (SQL Editor). Verify: `select column_name from information_schema.columns where table_name='roadmaps' and column_name='generated_from';` returns one row. |
| S2 | `.env.local` has a working `GEMINI_API_KEY` and **no** `AI_PROVIDER=mock` (except where a case says otherwise). |
| S3 | `npm run dev`, signed in, with **at least one roadmap that has logged hours and some graded recall cards** — an empty roadmap prints a page of dashes and proves little. |
| S4 | **Restart the dev server after any `.env.local` change.** Next reads env only at startup; this has cost this project a debugging cycle before (memory.md). |

---

## Suite PRINT — the export on real paper (P0)

> The point of this suite is the **print preview / PDF**, not the screen. Use the
> browser's own dialog: Ctrl/Cmd+P, or the page's **Print / Save as PDF** button.

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| PRINT-01 | Happy path | S3 | Open a roadmap → **Export / Print** → click **Print / Save as PDF** → save a PDF | A clean document: header (P mark, title, track line, export/started dates), stat tiles, every week with its kill criterion, recall schedule + blockers footer | P0 |
| PRINT-02 | No app chrome | S3 | Look at the saved PDF | **No sidebar, no nav, no theme toggle, no toolbar.** The screen toolbar ("← Back", "Print / Save as PDF") must not appear on paper | P0 |
| PRINT-03 | Light-only regardless of theme | S3 | Set the app to **dark** theme, then open the print view | The print page is **light** on screen *and* on paper — white sheet, dark text. It must not inherit the dark theme | P0 |
| PRINT-04 | Week cards never split | Roadmap with ≥6 weeks | Print to PDF, inspect every page boundary | No week card is broken across two pages; no stat tile row is split | P0 |
| PRINT-05 | Margins | S3 | In the print dialog set margins to **Default**; measure the PDF | ~0.7in on all four sides; nothing clipped at the edges | P1 |
| PRINT-06 | Background graphics ON | S3 | Print with "Background graphics" **enabled** | Kill-criterion strips, the accent W-badges, mastered checkboxes and the banner all render with their fills | P0 |
| PRINT-07 | Background graphics OFF | S3 | Print with "Background graphics" **disabled** | Still legible and unambiguous: mastered topics are distinguishable (border/label), kill criteria still identifiable by their left rule + eyebrow. Nothing becomes invisible | P1 |
| PRINT-08 | Greyscale / photocopy | S3 | Print to PDF, then view in greyscale (or print B&W) | Status is still readable — mastery is not conveyed by colour alone | P1 |
| PRINT-09 | Behind-pace banner prints | Roadmap that is genuinely behind | Open its print view | Red **BEHIND PACE** banner at the top with the real hours/pace/days-late figures — the export must not quietly drop the bad news (Rule 19) | P0 |
| PRINT-10 | Numbers match the dashboard | S3 | Open `/progress` and the print view of the same roadmap side by side | Hours logged, pace, recall accuracy and topics-mastered are **identical**. Any disagreement is a P0 bug — both read the same functions | P0 |
| PRINT-11 | Recall schedule is real | Roadmap with graded cards at different intervals | Compare the four buckets against `select due_at, topic_label from recall_cards where roadmap_id='…' order by due_at;` | Counts match; topics listed heaviest-first; empty buckets still shown as `0` | P0 |
| PRINT-12 | Empty roadmap | Fresh roadmap, nothing logged, no cards | Open its print view | Renders without error: tiles show `0` / `—`, all four buckets show 0, blockers section says nothing is blocking you. No crash, no NaN, no blank page | P1 |
| PRINT-13 | Long content | Roadmap with long topic names / a 12-week plan | Print | No horizontal clipping, no text running off the sheet, page count grows sensibly | P1 |
| PRINT-14 | Filename / PDF title | S3 | Save as PDF | The suggested filename / document title contains the **roadmap title**, not "localhost" or "print" | P2 |
| PRINT-15 | Deep link | S3 | Paste `/roadmap/<id>/print` straight into a fresh tab | Loads directly (it is a real URL, bookmarkable and shareable-to-yourself) | P2 |
| PRINT-16 | Back link | S3 | From the print view click **← Back to roadmap** | Returns to `/roadmap/<id>` with the app shell restored | P2 |

---

## Suite ROLE — the backend role and the honest fallback (P0)

> **This suite is the reason the backend role is defensible.** ROLE-03 is the one
> that matters: it proves a failed generation for a backend candidate is
> *labelled*, not silently passed off as their plan.

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| ROLE-01 | Role appears | S2–S3 | Start onboarding | **SDE-2 · Backend** is offered in question 1 | P0 |
| ROLE-02 | Weak areas follow the role | S2–S3 | Pick **SDE-2 · Backend**, advance to "Where are you weakest?" | Backend options (Databases & SQL, Distributed systems & scale, Caching & messaging, DSA…). **No** React internals / Browser & rendering. Going back and switching to Frontend swaps the list and clears the picks | P0 |
| ROLE-03 | **Honest fallback** | Set `AI_PROVIDER=mock`, `AI_MOCK_MODE=error`, **restart** | Onboard as **SDE-2 · Backend** and generate | Roadmap is created (Rule 9 — no hard block) **and** carries an amber **TEMPLATE MISMATCH** notice naming your role and saying the content is the seeded frontend curriculum | P0 |
| ROLE-04 | The notice persists | After ROLE-03 | Restore `.env.local` (real provider), **restart**, reopen that same roadmap | The notice is **still there**. It is read from `roadmaps.generated_from`, not from the creation response — this is the whole point of migration 0012 | P0 |
| ROLE-05 | Notice prints | After ROLE-03 | Open that roadmap's print view | The amber template-mismatch banner appears on the printed page too | P0 |
| ROLE-06 | No false positive — AI path | S2 (real provider) | Onboard as **SDE-2 · Backend**, generate successfully | Genuinely backend content and **no** mismatch notice | P0 |
| ROLE-07 | No false positive — frontend + seed | `AI_MOCK_MODE=error`, restart | Onboard as **SDE-2 · Frontend** and generate | Seeded roadmap, and **no** mismatch notice — the frontend template *is* the right template for that role | P0 |
| ROLE-08 | Old roadmaps stay silent | S1 | Open a roadmap created before Phase 5 (`generated_from` is NULL) | **No** notice. Unknown provenance must not produce a claim in either direction | P1 |
| ROLE-09 | Backend detail is grounded | S2, ROLE-06's roadmap | Open a backend topic → **Generate with AI** | Resources are real links with green **VERIFIED** chips — the Phase 4.5 corpus carries backend/databases/distributed-systems areas | P1 |
| ROLE-10 | Backend recall cards | S2, ROLE-06's roadmap | On a backend topic, generate recall cards | Questions are about that backend topic, not frontend | P2 |

---

## Suite MARK — "what have I actually generated?" markers (P1)

> Added 2026-09-02. The chips answer, from the Roadmap screen alone, which topics
> already have study material and how trustworthy it is. `CONTENT-01` in
> `study-flow.spec.ts` (the automated case — different ID space on purpose)
> covers the data round-trip; these cover what it looks like
> and whether it reads correctly at a glance.

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| MARK-01 | Fresh roadmap | New roadmap, nothing generated | Open it, expand every week | Every topic row shows a dashed, faint **NO CONTENT** chip; every week header reads `0/N studied` | P1 |
| MARK-02 | Grounded topic | S2 (real provider), corpus-covered topic | Generate detail on it, return to the roadmap | That row's chip is a green **VETTED**; the week count increments by one | P0 |
| MARK-03 | Ungrounded topic | Niche topic with no corpus hit | Generate detail, return to the roadmap | Amber **AI** chip — it must not claim VETTED for model-recalled resources | P0 |
| MARK-04 | Template fallback | `AI_MOCK_MODE=error`, restart | Generate detail on a fresh topic, return | Muted **TEMPLATE** chip | P1 |
| MARK-05 | Chip matches the topic screen | After MARK-02/03 | Open that topic and read its own source line | The chip's grading and the Topic screen's provenance line agree. A disagreement is a P0 — they read the same field | P0 |
| MARK-06 | Scannable at a glance | Roadmap with a mix of generated and not | Expand a week and look for two seconds | You can tell which rows still need generating without reading each label. If the dashed chip is too quiet or too loud, say so — this is a judgement call and the reason it's a manual case | P1 |
| MARK-07 | Doesn't crowd the row | Long topic name, narrow window | Look at a topic row at ~900px | Chip, status label and "study →" don't collide or wrap. Below 860px it stays legible | P2 |
| MARK-08 | Both themes | S3 | View the four chip states in light and dark | All four readable; NO CONTENT stays clearly secondary to the three real states | P2 |
| MARK-09 | Tooltip explains | S3 | Hover a chip and a week count | A sentence explaining what the state means / how many topics have material | P2 |
| MARK-10 | Week count agrees with rows | Mixed roadmap | Count generated rows in a week, compare with its header | Identical. The header is a summary of the rows, not a second source of truth | P1 |

---

## Suite RESP — mobile-reasonable layout (P1)

> Use a real phone if you can; otherwise devtools device emulation at 390×844
> **and** a narrowed desktop window (they differ — emulation doesn't reproduce
> the mobile URL bar's viewport changes).

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| RESP-01 | Sidebar becomes a top bar | S3 | Narrow the window below ~860px | Sidebar reflows to a horizontal bar at the top: brand + theme + user on one row, nav links on the next. No 244px column eating the screen | P0 |
| RESP-02 | One scroll context | S3, narrow | Scroll the Library and the Roadmap screens | The page scrolls as **one** document. No nested/double scrollbars, no content trapped behind a fixed-height frame | P0 |
| RESP-03 | Stat tiles collapse | S3, narrow | Open `/progress` at 700px, then at 400px | 4-up → 2-up → 1-up. Values are never truncated mid-number | P1 |
| RESP-04 | Charts don't blow out the page | S3, narrow | `/progress` at 390px | Charts stack vertically; **nothing causes horizontal page scroll** | P0 |
| RESP-05 | Nav is reachable | S3, narrow | Tap each nav item | All four reachable (horizontal scroll within the nav strip is acceptable); the recall due badge is still visible | P1 |
| RESP-06 | Recall is usable on a phone | Cards due, narrow | Grade a card | Question readable, Got it / Missed both tappable and not overlapping | P1 |
| RESP-07 | Onboarding on a phone | narrow | Run the 5-question wizard | Options are tappable, the live preview doesn't overflow, the CTA is reachable without zooming | P1 |
| RESP-08 | Topic screen on a phone | narrow | Open a topic, edit notes | Notes editor usable; the resources panel is below the content rather than a squashed column | P2 |
| RESP-09 | Desktop is unchanged | S3 | Open every screen at 1440px | Pixel-identical to before Phase 5 — the breakpoint must not have leaked upward | P0 |

---

## Suite A11Y — accessibility pass (P1)

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| A11Y-01 | Skip link | S3 | Load any screen, press **Tab** once | A visible "Skip to content" button appears at the top-left; Enter jumps focus past the sidebar into the main content | P0 |
| A11Y-02 | Focus is always visible | S3 | Tab through the whole sidebar, then a Roadmap screen, in **both** themes | Every focused control has a clear accent ring. Nothing is focusable-but-invisible | P0 |
| A11Y-03 | Mouse doesn't show rings | S3 | Click buttons with the mouse | No focus ring on click (`:focus-visible`, not `:focus`) | P2 |
| A11Y-04 | Current page is announced | S3 | With a screen reader (VoiceOver/NVDA) move through the nav | The active item is announced as the current page (`aria-current`), not just coloured differently | P1 |
| A11Y-05 | Theme toggle | S3 | Focus the theme toggle with a screen reader | Announced as an action ("Switch to light theme") with its pressed state, not just "☾ Dark" | P1 |
| A11Y-06 | Due badge has meaning | Cards due | Screen-read the Recall nav item | Announces the number **and** what it counts ("3 cards due"), not a bare number | P2 |
| A11Y-07 | Keyboard-only recall session | Cards due | Grade three cards using only the keyboard | Fully possible; focus never gets lost after a grade | P1 |
| A11Y-08 | Keyboard-only mastery | S3 | Reach and toggle a kill-criterion checkbox by keyboard | Togglable with Space/Enter; state change is perceivable without colour alone | P1 |
| A11Y-09 | Reduced motion | S3 | Enable OS "Reduce motion", reload, navigate | The skeleton doesn't pulse; transitions are instant. Nothing strobes | P1 |
| A11Y-10 | Contrast | S3 | Check muted/faint text and the status chips in **both** themes (devtools contrast or a checker) | Body and muted text meet AA (4.5:1); chips/eyebrows meet at least 3:1. Note anything that fails rather than skipping | P1 |
| A11Y-11 | Zoom to 200% | S3 | Browser zoom 200% on Progress and Roadmap | Content reflows and stays usable; no clipped or overlapping text | P2 |
| A11Y-12 | Page titles | S3 | Check the browser tab on the print view | Tab shows the **roadmap's title**, not a generic app title | P2 |

---

## Suite STATE — empty / loading / error states (P1)

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| STATE-01 | Loading skeleton | S3 | Hard-navigate between Library → Progress → Roadmap (throttle to Slow 3G to see it) | A skeleton fills the content area while the server component fetches; **the sidebar never flickers** (it lives in the layout) | P1 |
| STATE-02 | Skeleton doesn't jump | S3, throttled | Watch a screen finish loading | Layout doesn't shift dramatically when content replaces the skeleton | P2 |
| STATE-03 | Error boundary | S3 | Break it deliberately: stop your network / point `NEXT_PUBLIC_SUPABASE_URL` at a dead host, restart, load `/progress` | The red "This screen didn't load" panel with **Try again** and **My roadmaps** — not a raw stack trace, not an infinite spinner | P0 |
| STATE-04 | Try again recovers | After STATE-03 | Restore the env, restart, click **Try again** | The screen renders normally without a full page reload | P1 |
| STATE-05 | 404 for a bad URL | S3 | Visit `/roadmap/00000000-0000-0000-0000-000000000000` | The styled 404 ("Nothing here"), with a link back to Library | P1 |
| STATE-06 | 404 doesn't confirm existence | Two accounts | As user B open user A's real roadmap URL | The **same** 404 as a made-up id — never "you don't have access", which would confirm the id is real | P0 |
| STATE-07 | 404 on a nonsense path | — | Visit `/does-not-exist` | The same styled 404 | P2 |
| STATE-08 | Empty states survive | New account | Visit Library, Progress and Recall with no data | Each shows its own empty state with a next action — no blank panels, no zeros presented as achievements | P1 |

---

## Suite UI — theme and visual fidelity (P2)

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| UI-01 | Both themes, new surfaces | S3 | View the 404, the error panel, the loading skeleton and the mismatch notice in **light and dark** | All correct in both. No raw-hex leakage (the print view is the allowed exception) | P1 |
| UI-02 | Mismatch notice reads as a warning, not a failure | ROLE-03's roadmap | Look at it | Amber, not red; copy makes clear the plan is usable but off-track for the role | P2 |
| UI-03 | Export link fits the header | S3 | Open a roadmap with a long title | The Export / Print link and the status chip don't collide or wrap awkwardly | P2 |
| UI-04 | No console noise | S3 | Open devtools, visit every screen | No React hydration warnings, no key warnings, no 404s on assets | P1 |

---

## Report format

Reply with one line per case:

```
PRINT-01 Pass
PRINT-04 FAIL — week 5 card split across pages 2/3
ROLE-03 Pass
A11Y-10 FAIL — --text-faint on --bg-sunken is 3.1:1 in light theme
...
```

**Say explicitly which cases you skipped.** Several here need awkward setup —
an `.env.local` edit plus a restart (ROLE-03/04/05/07, MARK-04, STATE-03/04), a
second account (STATE-06), a screen reader (A11Y-04/05/06), a real phone (RESP-*), a
roadmap that is genuinely behind pace (PRINT-09). **A skipped case reported as a
pass becomes a false claim in `phases.md` that gets read back months later as
fact**, so "skipped" is a perfectly good answer, and "eyeballed it" is worth
saying too.
