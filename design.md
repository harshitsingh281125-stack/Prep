# Design — Prep

> The visual system, extracted verbatim from the pasted design source
> (`Prep.dc.html`, with `Prep-print.dc.html` for the print view). This is the
> UI source of truth (Rule 20). Companion: [PRD.md](./PRD.md) ·
> [Architecture.md](./Architecture.md).

---

## 1. Typography

- **Sans:** `IBM Plex Sans`, weights 400/500/600/700 — all body/UI text.
- **Mono:** `IBM Plex Mono`, weights 400/500/600 — labels, metadata, chips,
  numbers, `UPPERCASE` eyebrow labels.
- Base: `14px`, line-height `1.5`, `-webkit-font-smoothing: antialiased`.
- Headings use `letter-spacing: -0.01em` to `-0.02em`.

## 2. Color tokens (OKLCH, dark + light)

Ship both themes; every color goes through a token (Rule 21). Copy these into
global CSS as `[data-theme="dark"]` / `[data-theme="light"]` blocks.

### Dark
```css
--bg: oklch(0.165 0.006 265);        --bg-sunken: oklch(0.14 0.006 265);
--bg-elevated: oklch(0.205 0.007 265); --panel: oklch(0.198 0.007 265);
--border: oklch(0.28 0.008 265);      --border-strong: oklch(0.36 0.01 265);
--text: oklch(0.955 0.004 265);       --text-muted: oklch(0.7 0.01 265);
--text-faint: oklch(0.52 0.01 265);
--accent: oklch(0.68 0.15 264);       --accent-soft: oklch(0.68 0.15 264 / 0.14);
--accent-line: oklch(0.68 0.15 264 / 0.4);
--green: oklch(0.75 0.14 155);        --green-soft: oklch(0.75 0.14 155 / 0.14);
--amber: oklch(0.8 0.12 78);          --amber-soft: oklch(0.8 0.12 78 / 0.14);
--red: oklch(0.68 0.19 24);           --red-soft: oklch(0.68 0.19 24 / 0.13);
```

### Light
```css
--bg: oklch(0.99 0.002 265);          --bg-sunken: oklch(0.975 0.003 265);
--bg-elevated: oklch(1 0 0);          --panel: oklch(1 0 0);
--border: oklch(0.915 0.004 265);     --border-strong: oklch(0.85 0.006 265);
--text: oklch(0.24 0.012 265);        --text-muted: oklch(0.5 0.012 265);
--text-faint: oklch(0.66 0.012 265);
--accent: oklch(0.53 0.18 264);       --accent-soft: oklch(0.53 0.18 264 / 0.1);
--accent-line: oklch(0.53 0.18 264 / 0.35);
--green: oklch(0.55 0.14 155);        --green-soft: oklch(0.55 0.14 155 / 0.1);
--amber: oklch(0.62 0.13 72);         --amber-soft: oklch(0.62 0.13 72 / 0.12);
--red: oklch(0.55 0.2 25);            --red-soft: oklch(0.55 0.2 25 / 0.09);
```

### Semantic meaning
- **accent** (indigo/blue): primary actions, "due", active nav, links.
- **green:** mastered / "on track" / "Got it cold".
- **amber:** in-progress / warning-but-not-failing / flat recall accuracy.
- **red:** behind pace / stalled / kill criteria / "Missed it".
- **text / muted / faint:** three-level text hierarchy.

## 3. Shape, spacing, elevation

- **Radii:** cards `12–14px`, tiles/inputs `9–10px`, chips/badges `5–6px`,
  avatar/dots `50%`, logo mark `8–9px`.
- **Borders:** `1px solid var(--border)`; hover lifts to `var(--border-strong)`.
- **Panels:** `background: var(--panel)`, `1px` border. Sunken zones use `--bg-sunken`.
- **Padding:** cards ~`18–28px`; list rows ~`11–14px` vertical; header `16px 28px`.
- **Dashed** `--border-strong` borders for empty states + "new" placeholder tiles.
- Custom scrollbar: `10px`, thumb `--border-strong` with padding-box inset.

## 4. Layout

- Full-height app: `height: 100vh; overflow: hidden`.
- **Sidebar:** fixed `244px`, `--bg-sunken`, right border. Logo → nav items →
  "New roadmap" → spacer → theme toggle → user card (avatar, name, sign-out).
- **Main:** header bar (`screenTitle` / `screenSubtitle` + right-aligned status
  tag) over a scrolling `padding: 28px` content area.
- **Content max-widths:** Library `920px`, Onboarding/Topic `940px`, Roadmap/
  Progress `1000px`, Recall `740px`, centered.

## 5. Component patterns (from the design)

- **Logo mark:** rounded square, `--accent` bg, white "P" in mono 600.
- **Nav item:** icon + label; active = `--bg-elevated` bg + border + `--text`;
  inactive = `--text-muted`, hover `--bg-elevated`. Recall item carries a due badge.
- **Stat tile:** mono uppercase label, big value (`24px/700`, `-0.02em`), sub-line;
  value turns `--red` when behind, `--accent` for "due today".
- **Roadmap card:** title/subtitle, status badge, progress bar (`7px`, fill =
  status color), mono chips (mastered / recall / due), footer (created · "Open →").
- **Week accordion:** header (`W{n}` · title · progress · hours chip) → topic rows
  (status dot + name + status label + "study →") → **kill-criterion** strip in
  `--bg-sunken` with a red target icon + mono `KILL CRITERION` eyebrow.
- **Chips/badges:** mono `~11px`, soft bg + colored border, `UPPERCASE` eyebrows
  with `letter-spacing: 0.04–0.06em`.
- **Buttons:** primary = `--accent` bg, white text; secondary = `--bg-elevated`
  bg + border; hover primary `filter: brightness(1.08)`.
- **Kill-criterion checkbox (Topic):** `28px` square; unchecked = border only;
  checked = `--green` bg + check mark → flips card to `--green-soft`.
- **Recall card:** topic eyebrow + next-review chip, question, then either
  Got-it/Missed buttons or a graded result row (with undo). Border + slight
  opacity change once graded.

## 6. Charts (hand-rolled SVG — no library, Rule 22)

- **Hours bars:** per-week paired bars — logged (`--accent`) vs planned
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

Reference: `Prep-print.dc.html`, built on the `doc-page` web component.
- Light-only, **hex** tokens (the one place raw hex is allowed), IBM Plex.
- `0.7in` margins, `break-inside: avoid` on week cards + stat grid (`.kx`).
- Layout: header (logo + title + track line) → behind-pace banner → 4 stat tiles
  → week-by-week cards with kill criteria → recall schedule + blockers footer.

## 9. Animation policy

Prep is a **dense productivity dashboard**, not a landing page. Animation is
restrained and functional — it must never fight the "no fluff, honest metrics"
product voice. The bar: does this motion communicate state, or is it decoration?

**Default: CSS only.** Hover/focus transitions, color/border shifts, and the
`filter: brightness()` button feedback already in `Prep.dc.html` cover most needs
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
- The design ships as one big state-switched component; in Next.js this becomes
  real routes (see [Architecture.md §3](./Architecture.md)) — but the **token set,
  component look, and spacing must match** the pasted source.
- Icons are inline SVG (stroke `currentColor`, `1.5` width) — keep them inline.
