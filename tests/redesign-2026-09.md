# QA — "study notebook" redesign (2026-09-28)

Visual-only change: tokens, type, layout. No routes, queries, or API shapes
changed. Automated: `tsc`, `next lint`, Vitest, the full Playwright suite (see the
run recorded at the bottom). This doc covers what automation can't see: **does it
look right, in both themes, at both widths.**

Precondition for every case: signed in, at least one roadmap with recall cards
due. Run each case in **dark and light** (sidebar moon/sun icon).

| ID | Area | Steps | Expected | Pri |
|---|---|---|---|---|
| RD-01 | Shell | Load any screen | Serif "Prep" wordmark, no blue "P" tile. Active nav item has a faint lifted fill, no heavy border. Footer is one row: initials · name · theme icon · sign-out icon | P0 |
| RD-02 | Shell | Toggle theme from the sidebar icon, reload | Theme switches instantly and persists; icon flips moon ↔ sun; no flash of the other theme on reload | P0 |
| RD-03 | Header | Visit Library, Roadmap, Progress, Recall, Topic | Serif page title's left edge lines up exactly with the content's left edge on every screen | P0 |
| RD-04 | Header | Scroll a long screen (Roadmap with all weeks open) | Title scrolls away with the content; one scrollbar only | P1 |
| RD-05 | Library | View with 1–3 roadmaps | Rows between hairlines (no cards); status is a coloured dot + word; hover tints the row; "New roadmap" ink button + "n / 3 used" top-right | P0 |
| RD-06 | Library | Delete a roadmap | Confirm dialog, row disappears, quota count drops | P0 |
| RD-07 | Library | At 3/3 | "Roadmap limit reached" shown in place of the button, faint and not clickable | P1 |
| RD-08 | Roadmap | Open a roadmap | Stat row of four serif figures divided by hairlines (no boxes); weeks are rows with a "Week n" gutter; kill criterion is a red-ruled serif pull-quote | P0 |
| RD-09 | Roadmap | Expand/collapse weeks; click a topic row | Chevron rotates; topic rows stay inside the list edges (nothing pokes out right); row click opens the topic | P0 |
| RD-10 | Roadmap | Content column on a topic row | Reads "No content" / "Vetted" / "AI" / "Template" in sentence case, coloured text, no dashed chip | P1 |
| RD-11 | Topic | Open a topic with no material | "← Roadmap" sits above the title and navigates back; "No study material yet." serif headline; ink "Generate with AI" button | P0 |
| RD-12 | Topic | Generate material | Mental model in large serif, no tinted box; resources and exercises as numbered hairline rows; Verified/Unverified as coloured words | P0 |
| RD-13 | Topic | Type notes | Serif text in the textarea; "saving… / saved" appears; focus ring visible when tabbing into it | P0 |
| RD-14 | Topic | Tick the kill-criterion box | Box fills green with a check, card turns green-soft, footer reads "Mastered — you can defend this." | P0 |
| RD-15 | Recall | Open with cards due | Numbered items (01, 02…), serif questions, neutral outline buttons each with a green/red dot | P0 |
| RD-16 | Recall | Grade one right, one wrong | Question dims; "Got it → next review in n days" / "Missed → reset to +1d"; Accuracy updates in the top line | P0 |
| RD-17 | Progress | Open | Stat row matches Roadmap's; charts sit under a hairline, no boxes; "logged" bars are ink-coloured; "Log study time" is a sunken panel at the bottom and still logs | P0 |
| RD-18 | Progress | A roadmap behind pace | Red left-ruled banner reading "Behind pace" (or "Stalled") with a serif sentence, not a boxed badge | P1 |
| RD-19 | Onboarding | Walk all five questions | Serif question, pill options (selected = ink fill), thin ink progress line, "Your plan, live" sunken rail | P0 |
| RD-20 | Usage | Open | Provider as dot + text; cap meter as a thin line; stat row; cost caveat in a sunken panel | P1 |
| RD-21 | Login | Sign out, view /login | Wordmark, serif "Welcome back", ink Sign-in button, no card box; sign-in works | P0 |
| RD-22 | Mobile | Resize to 390px wide on Library, Roadmap, Topic, Progress | No horizontal scroll; stat rows go 2-up then 1-up without stray dividers; week topics lose their left indent; header padding tightens | P0 |
| RD-23 | Errors | Visit `/nope` | Serif "Nothing here." with ink button | P2 |
| RD-25 | Loading | Click a roadmap row in Library | Row dims and shows "Opening…" until the roadmap page appears | P1 |
| RD-26 | Loading | On a roadmap, click a topic row; on a topic, click "← Roadmap" | Row shows "opening…" / link shows "opening…" until the page appears | P1 |
| RD-27 | Loading | Sidebar → New roadmap (throttle to Slow 4G in DevTools) | Wizard-shaped skeleton (question, pill options, side rail) instead of a frozen screen | P1 |
| RD-28 | Loading | Topic with no material → Generate with AI | Empty state is replaced by pulsing mental-model / resources / exercises placeholders plus a "usually 5–15 seconds" line; real content replaces them | P0 |
| RD-29 | Loading | Topic with material → Regenerate | Existing material dims with a "Regenerating study material…" line; comes back at full strength when done | P1 |
| RD-30 | Loading | Onboarding → Generate roadmap | "Building your roadmap…" button + a drafting placeholder with Week 1–3 rows, staying up until the roadmap page opens | P0 |
| RD-31 | Loading | OS "reduce motion" on, repeat RD-28 | Placeholders are static blocks, no pulsing | P2 |
| RD-24 | Print | Roadmap → Export / Print | Unchanged from before (not part of this redesign) | P1 |

## Automated run

Vitest 283/283 · `next lint` clean · `tsc` clean · Playwright 81/81 (2026-09-28), re-run 81/81 after the loading-state pass.
