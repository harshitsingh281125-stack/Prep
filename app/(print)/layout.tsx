import type { ReactNode } from "react";
import "./print.css";

/**
 * The print route group's layout (Phase 5).
 *
 * WHY A ROUTE GROUP AT ALL. `(app)/layout.tsx` wraps every in-app screen in the
 * sidebar shell — 244px of navigation that must not exist on a printed roadmap,
 * and a `height:100vh; overflow:hidden` frame that would clip a multi-page
 * document to exactly one screenful. Route groups don't appear in the URL, so
 * `(print)/roadmap/[id]/print/page.tsx` still serves `/roadmap/[id]/print`
 * (which is what Architecture.md §3 has always specified) while opting out of
 * the app chrome entirely. `(app)` and `(print)` are siblings: same URL space,
 * different layouts, no conflict because no two page.tsx files resolve to the
 * same path.
 *
 * WHAT THIS LAYOUT DOES NOT DO: define <html>/<body>. Only the ROOT layout may,
 * and it still wraps this one — including its no-flash theme script, which is
 * why `.print-root` re-declares its own light-only hex tokens instead of
 * inheriting the OKLCH set that script chooses between (design.md §8, Rule 21).
 *
 * Auth is NOT re-checked here. The root middleware gates every path except
 * /login and /auth/*, and the page's own query runs under RLS, so a stranger's
 * roadmap id returns no rows and 404s — the same two-layer story as every other
 * screen, rather than a third bespoke check that could drift from them.
 */
export default function PrintLayout({ children }: { children: ReactNode }) {
  return <div className="print-root">{children}</div>;
}
