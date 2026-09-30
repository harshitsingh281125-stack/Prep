# Design — Prep

> The visual system. This is the UI source of truth (Rule 20). Companion:
> [PRD.md](./PRD.md) · [Architecture.md](./Architecture.md).
>
> **Redesign (2026-09-28).** Phases 0–6.1 matched the pasted source
> (`Prep - Interview Prep OS.html`) verbatim. That source read as generated: indigo
> accent on blue-grey, IBM Plex with mono UPPERCASE eyebrows on every label, every
> element in its own bordered card, soft-tinted status chips everywhere, and a page
> title stranded at the far left of a centred column. The owner asked for a look a
> human designer would sign, so this file now describes the redesign and **no
> longer points at the pasted source**. The file is kept in the repo as history.
> Direction in one line: **a study notebook, not a SaaS dashboard.**
>
> (Older provenance note, still true: `Prep-print.dc.html` never existed in the
> repo, so §8 has always been a written spec, not an extract.)

---

## 1. Typography

Three families, each with one job. Components reference them through tokens
(`--font-sans`, `--font-serif`, `--font-mono`), never by name.

- **Serif — `Newsreader` 400/500/600 (optical sizes).** Page titles, the big
  figures in stat rows, recall questions, the mental model, kill criteria, notes,
  empty-state headlines. The "reading" voice of a study tool.
- **Sans — `Instrument Sans` 400/500/600/700.** All UI text: nav, labels, buttons,
  meta lines.
- **Mono — `JetBrains Mono` 400/500.** Genuine data only: recall intervals
  (`+4d`), card numbers, route names, error refs. **Never** labels or eyebrows.
- Base `14px` / `1.5`, `tabular-nums` everywhere so figures align.
- **No uppercase eyebrows.** Labels are sentence case, sans, `13px`, weight 500–600,
  `--text-muted`. Hierarchy comes from size and the serif/sans contrast, not caps
  and letter-spacing.

Scale in use: page title 32px serif · section headline 20–24px serif · stat
figure 30–34px serif · recall question 20px serif · body 14–15px sans · meta
12.5–13px sans.

## 2. Color tokens (OKLCH, dark + light)

Warm neutrals (hue ~75–85, near-zero chroma): **paper** in light, **charcoal** in
dark — not the blue-grey of the original. Every color goes through a token
(Rule 21); the live values are in `app/globals.css`.

- `--bg`, `--bg-sunken`, `--bg-elevated`, `--panel` — surfaces.
- `--border`, `--border-strong` — hairlines and input/button outlines.
- `--text`, `--text-muted`, `--text-faint` — three-level text hierarchy.
- **`--ink` / `--on-ink`** — primary actions. The text colour, inverted: near-black
  buttons on paper, near-white on charcoal. **Primary buttons are ink, not accent.**
- `--accent` (+ `-soft`, `-line`) — a quiet blue kept for links, the Recall due
  count, "all generated", and the focus ring. It no longer paints buttons or panels.
- `--green` / `--amber` / `--red` (+ `-soft`) — semantics unchanged:
  mastered/on-track · in-progress/warning · behind/stalled/kill criterion/missed.

## 3. Shape, spacing, elevation

- **Hairlines over boxes.** Lists (roadmaps, weeks, topics, resources, exercises,
  recall cards, answered onboarding steps) are rows separated by `1px var(--border)`
  rules, not stacks of bordered cards.
- **A box has to earn it.** The only bordered/filled surfaces left: the Topic
  kill-criterion card (the one interactive commitment on the screen), inputs, the
  notes textarea, and `--bg-sunken` fills for secondary panels (onboarding's live
  plan, the log-time form, the cost caveat, empty chart areas).
- **Alerts are a left rule, not a box:** `2px` coloured left border on its `-soft`
  fill (pace banner, template mismatch, error screen). Kill criteria use the same
  left rule as a pull-quote.
- **Status is a dot + word** (`7px` circle + sentence-case label in the status
  colour) — not a bordered chip.
- Radii: buttons/inputs `8px`, panels `10–12px`, pill-shaped option chips in
  onboarding and resource tags `999px`.
- Generous vertical rhythm: `44–48px` between sections, `22–26px` row padding.
- No dashed borders anywhere.

## 4. Layout

- Full-height app: `height: 100vh; overflow: hidden`. **`<main>` is the scroll
  container**, so the page header scrolls away with the content.
- **Sidebar:** fixed `244px`, `--bg-sunken`, right hairline. Serif wordmark
  "Prep" + "interview notebook" → nav → "New roadmap" as a quiet nav row → spacer →
  one user row (initials, name, track, theme icon, sign-out icon).
- **Page header (`<Header>`):** serif title + muted subtitle, optional `eyebrow`
  (Topic uses it for "← Roadmap") and right-aligned `tag`. It takes the same
  `maxWidth` as the `<ContentArea>` below it, so the title sits on the content's
  left edge. No bottom border.
- **Content max-widths:** Library `920px`, Onboarding/Topic `940px`, Roadmap/
  Progress/Usage `1000px`, Recall `740px`, centred.
- Two-pane screens (Topic, Onboarding): `minmax(0,1fr) 280px`, `56px` gap, the
  rail sticky at `top: 24px`.

## 5. Component patterns

- **Nav item:** icon + label; active = `--text`, weight 600, `--bg` fill with a
  1px ring; inactive = `--text-muted`, brightens on hover (`.nav-link`).
- **Stat row** (Roadmap, Progress, Usage): four cells between top and bottom
  hairlines, divided by vertical hairlines; sans label, serif figure, faint sub-line.
  Class `stat-row` drops the dividers when the grid wraps on mobile.
- **Roadmap row (Library):** serif title, subtitle, dot+word status, a `3px`
  progress hairline with the percentage, then plain-text figures and a Delete link.
- **Week (Roadmap):** "Week n" gutter label, serif week title, plain-text meta
  (mastered · studied · hours), chevron. Expanded: topic rows indented under the
  title (dot · name · content source · status · "study →"), then the kill
  criterion as a red-ruled pull-quote.
- **Recall item:** mono index (`01`), topic + projected interval, serif question,
  then two neutral outline buttons each carrying a green/red dot. Graded: question
  dims, a dot + verdict + "next review in n days" line replaces the buttons.
- **Buttons:** primary = `--ink` bg / `--on-ink` text, hover opacity (`.btn-ink`);
  secondary = transparent with `--border-strong` outline.
- **Kill-criterion checkbox (Topic):** `26px` rounded square; unchecked = faint
  outline; checked = `--green` fill + check → card flips to `--green-soft`.
- **Loading.** Route skeletons (`components/shell/ContentSkeleton.tsx`, variants
  `dashboard` and `wizard`) and AI-generation placeholders all use the global
  `.skel` pulse, which reduced-motion freezes. Every placeholder that stands in for
  AI work has a one-line status saying what is happening and roughly how long it
  takes. Routes that can 404 (roadmap, topic) have no skeleton; the clicked row or
  link shows the pending state instead (`.is-navigating`, "opening…").
- **Hover** on rows and outline buttons uses `.hover-row` (`--bg-sunken` fill) —
  one of the few class hooks in `globals.css`, because inline styles cannot
  express `:hover`.

## 6. Charts (hand-rolled SVG — no library, Rule 22)

- **Hours bars:** per-week paired bars — logged (`--ink`) vs planned
  (`--border-strong`), `13px` wide, heights scaled to a `120px` max.
- **Accuracy line:** `viewBox="0 0 320 150"`, axis + dashed gridlines in
  `--border`, `--amber` polyline + dot markers; y-axis 100/80/60 labels in mono.

## 7. "Honest" tone in the UI (product voice)

The copy is deliberately blunt — carry it through:
- "No fluff. Five questions, then a roadmap you'll actually be held to."
- Kill criterion: "a claim you can defend on the spot."
- Recall: "Grade yourself honestly — a 'close enough' is a miss."
- Streak shown as "13d streak · not that it matters."
- Progress banner: "BEHIND PACE … you finish ~18 days past your target date."

## 8. Print / export view

**No design-source file exists for this view** (see the correction at the top).
The list below is the spec, and it is what Phase 5 implemented.
- Light-only, **hex** tokens (the one place raw hex is allowed), IBM Plex.
  *(Not restyled in the 2026-09-28 redesign — paper output has its own spec and
  its own E2E coverage; bringing it onto Newsreader/Instrument is a separate change.)*
- `0.7in` margins, `break-inside: avoid` on week cards + stat grid (`.kx`).
- Layout: header (logo + title + track line) → behind-pace banner → 4 stat tiles
  → week-by-week cards with kill criteria → recall schedule + blockers footer.

**As built (Phase 5)** — `app/(print)/print.css` + `app/(print)/roadmap/[id]/print/`:
- It is the app's **only stylesheet**; every other screen styles inline. Not a
  style preference — `@page` margins and `break-inside` have no inline form, and
  neither do media queries or pseudo-classes.
- Tokens are re-declared on `.print-root` rather than inherited, because the root
  layout's no-flash script has already stamped `data-theme` on `<html>` and the
  print view must ignore it.
- `print-color-adjust: exact`, because browsers strip backgrounds by default to
  save toner — which would erase the kill-criterion strips, the mastery boxes and
  the pace banner, i.e. every element whose *meaning* is its fill.
- Mastery prints as a filled **box**, not a coloured dot, so a greyscale photocopy
  still reads. An unchecked topic prints as an empty square you can tick with a pen.
- Two additions beyond the spec above: an on-screen toolbar (`display:none` in
  print) carrying the back link and the Print button, and the amber
  **TEMPLATE MISMATCH** banner when the seeded fallback served the wrong track.

## 9. Animation policy

Prep is a **dense productivity dashboard**, not a landing page. Animation is
restrained and functional — it must never fight the "no fluff, honest metrics"
product voice. The bar: does this motion communicate state, or is it decoration?

**Default: CSS only.** Hover/focus transitions, color/border shifts, and the
opacity button feedback (`.btn-ink`) cover most needs
with zero dependencies. Skeleton loaders (e.g. while a roadmap generates) are CSS
keyframes.

**One sanctioned JS animation dependency: Framer Motion (`motion`).** Used
**surgically**, only where physics genuinely improves the interaction:
- Kill-criterion checkbox → mastery (a small spring on check — the one satisfying
  moment in the flow).
- Week accordions expand/collapse on the Roadmap screen.
- Recall card entrance / grade-result reveal.
- Screen/route transitions if they read as smoother, not slower.

**Rules for using it:**
- Reach for CSS first; add Framer Motion only when CSS can't express it well.
- Keep durations short (dashboard, not showcase). Respect `prefers-reduced-motion`.
- No animating on every render; motion marks *state change*, not presence.

**Explicitly not used** (evaluated 2026-07-25, see [memory.md](./memory.md)):
- **Inspira UI** — Vue/Nuxt only; wrong framework.
- **Animate UI** — would force Tailwind + Motion + Radix + a shadcn design system
  onto our hand-rolled OKLCH/inline-style design; too much to adopt and defend.
- **Lenis smooth-scroll** — momentum scrolling hurts precise navigation in a
  data-dense app (recall queue, roadmap lists want native scroll).
- **Charting libraries** — charts stay hand-rolled SVG (Rule 22).

## 10. Implementation notes

- Tokens live in one global stylesheet; components reference variables only.
- **Phase 5 added the app's only class-based rules** to `globals.css`
  (`:focus-visible`, `.skip-link`, `prefers-reduced-motion`, and the ≤860px
  responsive block that turns the 244px sidebar into a top bar). Components still
  style inline and still reference tokens only; the classes exist because an
  inline `style` attribute cannot express a pseudo-class or a media query. Inline
  styles win the cascade, so the responsive rules that must override structural
  inline values (`width`, `flex-direction`, `overflow`) use `!important` and say
  why at the rule.
- **The 2026-09-28 redesign added a few more hooks** for what inline styles can't
  say: `.hover-row`, `.btn-ink`, `.nav-link` (hover states), `.stat-row`,
  `.week-body`, `.app-main`, `.app-header` (responsive overrides).
- Screens are real routes (see [Architecture.md §3](./Architecture.md)); the
  **token set, component look, and spacing must match this file** (§1–5).
- Icons are inline SVG (stroke `currentColor`, `1.5` width) — keep them inline.
