# Test Cases — Phase 1: Roadmaps as data (seeded, no AI)

> **QA gate (Rule 27).** Manual test pass for the Phase 1 feature set: schema + RLS,
> server-enforced quota, onboarding wizard, roadmap screen, topic screen (mastery +
> notes). Run each case, mark **Pass / Fail**, and report back. Any Fail → logged in
> [memory.md](../memory.md) as a bug and fixed before Phase 1 is called demoable.
>
> **Legend.** Priority: **P0** = blocker/security/data-integrity · **P1** = core flow ·
> **P2** = polish/UX. Report format at the bottom.
>
> **Prereqs before you start:**
> - Migration `0003_roadmaps.sql` applied (SQL Editor → "Success").
> - Dev server running (`npm run dev`, http://localhost:3001).
> - Signed in as a real user (email/pw or Google).
> - Have the **browser DevTools → Network + Console** open for the API/security cases.
> - For RLS cross-user cases you need **a second account** (different email). Call them
>   **User A** (main) and **User B** (second).

---

## Suite 1 — Onboarding wizard (`/onboarding`)

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| OB-01 | Happy path | Signed in, < quota | Answer all 5 Qs (single-selects auto-advance), pick ≥1 weak area, click **Generate roadmap** | Routes to `/roadmap/<id>`; roadmap reflects answers (title = role, subtitle = bar · timeline) | P1 |
| OB-02 | Auto-advance | On Q1 | Click a single-select option | Immediately advances to next question; the answered one appears in the summary list above | P1 |
| OB-03 | Live preview | Mid-wizard | Watch the right "Your plan, live" panel as you answer | Role/Bar/Timeline/Hours/Focus update live; unfilled rows show "—" in faint color | P2 |
| OB-04 | Edit a prior answer | Answered Q1–Q3 | Click **edit** on Q1 in the summary (or click an earlier progress dot) | Jumps back to Q1; changing it and re-advancing preserves later answers | P1 |
| OB-05 | Progress dots gating | On Q2, never reached Q4 | Try clicking the Q4/Q5 dot | Nothing happens — can't jump ahead past `maxStep` (only visited steps are clickable) | P2 |
| OB-06 | Weak-area is required | On Q5 with **zero** weak areas selected | Observe the CTA | Button reads "Pick at least one weak area", disabled, not clickable | P0 |
| OB-07 | Weak-area multi-select | On Q5 | Select two areas, then click one again | Toggles: first click selects (accent), second deselects; Focus preview count matches | P1 |
| OB-08 | Slice — 3 weeks | — | timeline **3 weeks**, weak = [React internals, Frontend system design] | Roadmap has **3 weeks**, W1 = React Internals, W2 = Frontend System Design (weak areas front-loaded) | P1 |
| OB-09 | Pad — 8 weeks | — | timeline **8 weeks**, weak = [Async JS] | Roadmap has **8 weeks**; W1 = Core JS & Async; weeks 6–8 repeat the focus blocks (padding), never blank | P1 |
| OB-10 | No-number answers | — | timeline **No date yet**, hours **As much as it takes** | Defaults applied: 5 weeks, 12h/week (hours_planned = 60); no crash, no NaN | P1 |
| OB-11 | Double-submit guard | On Q5, valid | Click **Generate roadmap** twice fast | Only **one** roadmap created (button shows "Building your roadmap…" and is disabled after first click) | P0 |
| OB-12 | Network failure surfaced | On Q5, valid | In DevTools, throttle/offline, click Generate | Inline error shown ("Network error…" / server error), button re-enables, **no** partial roadmap left behind | P1 |

---

## Suite 2 — Quota enforcement (Rule 18, server-side)

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| QT-01 | Create up to cap | 0 roadmaps, cap = 3 | Create 3 roadmaps via onboarding | All 3 succeed and appear in Library | P1 |
| QT-02 | UI blocks at cap | 3 roadmaps exist | Go to Library | "New roadmap" shows **"Roadmap limit reached"** (disabled); quota line reads "3 of 3 used" | P1 |
| QT-03 | Onboarding locked at cap | 3 roadmaps exist | Navigate directly to `/onboarding` | Locked state shown ("You've used all 3…"), no wizard, "Back to library" button | P1 |
| QT-04 | **Server enforces (bypass attempt)** | 3 roadmaps exist | In DevTools console, `fetch('/api/roadmaps/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'x',bar:'x',timeline:'5 weeks',hours:'12h',weak:['Async JS']})}).then(r=>r.status)` | Returns **403** (not 201); no 4th roadmap created. **This is the key security case — UI hiding is not the enforcement.** | P0 |
| QT-05 | Delete frees a slot | 3 roadmaps (at cap) | Delete one from a card | Quota returns to 2/3; "New roadmap" re-enables; can create again | P1 |
| QT-06 | Unauth cannot generate | Signed **out** | Same `fetch` to `/api/roadmaps/generate` as QT-04 | Returns **401**; nothing created | P0 |
| QT-07 | Malformed body rejected | Signed in | `fetch('/api/roadmaps/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:'not json'})` | **400**, no roadmap, no server crash | P1 |
| QT-08 | Empty/garbage weak areas | Signed in | POST with `weak: ['NotARealArea']` | **400** "Pick at least one weak area" (invalid options filtered to empty) | P1 |

---

## Suite 3 — RLS / cross-user isolation (Rule 5)

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| RLS-01 | Can't view another's roadmap | User A has roadmap `<idA>`; sign in as **User B** | User B navigates to `/roadmap/<idA>` | **404** (notFound) — never renders A's data | P0 |
| RLS-02 | Can't view another's topic | A's topic `<topicIdA>` | User B opens `/roadmap/<idA>/topic/<topicIdA>` | **404** | P0 |
| RLS-03 | Can't delete another's roadmap | Signed in as User B | `fetch('/api/roadmaps/<idA>',{method:'DELETE'}).then(r=>r.status)` | 200 **but deletes nothing** (RLS scopes to B's rows); verify A's roadmap still exists when A signs back in | P0 |
| RLS-04 | Library is per-user | Both A and B have roadmaps | Sign in as B, view Library | Only B's roadmaps shown; A's never appear | P0 |
| RLS-05 | Direct table read scoped | Signed in as B (DevTools) | Use supabase-js client to `.from('roadmaps').select('*')` | Returns only B's rows (RLS), never A's | P0 |

---

## Suite 4 — Roadmap screen (`/roadmap/[id]`)

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| RM-01 | Stat tiles correct | Fresh roadmap | Open a roadmap | Progress 0%, Hours "0 / <planned>", In progress 0, Weeks = week count; all numbers match the plan | P1 |
| RM-02 | Accordion toggle | On roadmap | Click a week header | Expands/collapses; chevron rotates; W1 open by default; **no console warning** about border/borderBottom (fixed) | P1 |
| RM-03 | Kill criterion strip | Week expanded | Look at the bottom of each week | Red target icon + "KILL CRITERION" eyebrow + the criterion text present for every week | P1 |
| RM-04 | Topic row → study | Week expanded | Click a topic row | Navigates to that topic's study page; correct topic + week label | P1 |
| RM-05 | Status dots + labels | Mixed statuses | After mastering/starting some topics | Dots/labels: green=Mastered, amber=In progress, faint=Not started; week header shows "n/total mastered" | P2 |
| RM-06 | Bad id | — | Navigate to `/roadmap/does-not-exist` | 404, not a crash | P1 |
| RM-07 | Counts reflect reality | After mastering 1 topic | Return to roadmap | Progress % and "In progress"/"mastered" counts updated (server re-fetch via router.refresh) | P1 |

---

## Suite 5 — Topic screen: mastery + notes (`/roadmap/[id]/topic/[topicId]`)

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| TP-01 | Detail renders | Topic with seeded detail (e.g. "Event loop & microtasks") | Open it | Mental model card, ranked resources (numbered + tags), from-scratch exercises all render | P1 |
| TP-02 | Fallback detail | Topic without hand-written detail (e.g. "Virtualized list") | Open it | Generic-but-coherent model + 3 resources + 2 exercises (no blank/undefined) | P1 |
| TP-03 | **Mastery is earned (Rule 16)** | not_started topic | Check the kill-criterion box | Box → green + check; card → green tint; label → "Mastered — you can defend this."; **only this explicit check confers mastery** | P0 |
| TP-04 | Unmaster reverts | Mastered topic | Uncheck the box | Reverts to in_progress (not back to not_started); card returns to neutral | P1 |
| TP-05 | Mastery persists | Just mastered | Reload the page | Still checked/green (status read from DB, not local state) | P1 |
| TP-06 | Mastery updates roadmap | Master a topic | Click "← Roadmap" | That week's mastered count + roadmap progress reflect it (router.refresh path) | P1 |
| TP-07 | Notes autosave | On a topic | Type in the notes box, wait ~1s | "saving…" → "saved"; reload page → text persisted | P1 |
| TP-08 | Notes debounce | On a topic | Type continuously | Doesn't save on every keystroke — saves ~700ms after you stop | P2 |
| TP-09 | First note starts topic | not_started topic, box unchecked | Type a note | Status flips not_started → **in_progress** (never to mastered); verify dot on roadmap | P1 |
| TP-10 | Fast-nav doesn't drop note | On a topic | Type, then immediately click "← Roadmap" before "saved" | Last edit is persisted (pending save flushed on unmount) — reopen topic to confirm | P1 |
| TP-11 | Empty note is fine | Topic with empty note | Open, leave blank, navigate | No error; no phantom in_progress flip from just opening (only a keystroke starts it) | P2 |

---

## Suite 6 — Cross-cutting (theme, empty states, integrity)

| ID | Area | Precondition | Steps | Expected | Pri |
|----|------|--------------|-------|----------|-----|
| CC-01 | Empty library | 0 roadmaps | View Library | Dashed empty state + "Create your first roadmap →" | P1 |
| CC-02 | Light + dark (Rule 21) | — | Toggle theme on each screen | All screens legible in both; no raw-hex color looks off; status colors correct in both | P1 |
| CC-03 | Delete cascade | Roadmap with weeks/topics/notes | Delete the roadmap | Gone from Library; (optional DB check) its weeks/topics/notes rows also gone (FK cascade) | P0 |
| CC-04 | Deep-link while logged out | Signed out | Open `/roadmap/<id>` directly | Redirected to `/login` (middleware auth gate) | P0 |
| CC-05 | Refresh mid-flow | Mid-onboarding | Reload the page | Wizard resets cleanly (state is client-only, expected); no crash | P2 |

---

## How to report

For each case, reply with the ID and result, e.g.:

```
OB-01 Pass
OB-11 FAIL — clicking twice created 2 roadmaps; button didn't disable fast enough
QT-04 Pass (got 403)
RLS-01 Pass (404)
TP-09 FAIL — status stayed not_started after typing
```

- **Just list the Fails in detail**; a bare "rest Pass" is fine for the ones that passed.
- Include the **actual** value where it differs from Expected (status code, count, what rendered).
- Console errors / warnings during any case → note them even if the case "worked".

I'll turn every Fail into a memory.md bug entry + fix, then we re-run only the failed cases before Phase 1 is marked demoable.
