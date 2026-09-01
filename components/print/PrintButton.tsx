"use client";

/**
 * The one interactive element on the print page.
 *
 * It is a client component for exactly one reason: `window.print()` is a browser
 * API and a server component has no window. Everything else on the page — the
 * whole document — stays a server component, which is the split worth being able
 * to explain: interactivity is the thing that pulls code across the boundary, not
 * importance.
 *
 * WHY window.print() AND NOT A GENERATED PDF FILE. Settled in Phase 5: the
 * browser's own print pipeline already does pagination, page-size selection,
 * margins, headers, and "Save as PDF" — all of it, on every platform, for free.
 * Producing a real PDF server-side means a headless-Chromium dependency that
 * doesn't fit a Vercel serverless function, or a PDF library that would make us
 * re-implement layout by hand. Rule 22's spirit ("hand-rolled beats a dependency
 * we can't defend") points the same way here.
 */
export default function PrintButton() {
  return (
    <button type="button" className="print-btn" onClick={() => window.print()}>
      Print / Save as PDF
    </button>
  );
}
