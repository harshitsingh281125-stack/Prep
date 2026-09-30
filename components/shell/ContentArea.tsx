import type { CSSProperties, ReactNode } from "react";

/**
 * The content column under the page header. `maxWidth` centres content
 * per-screen (Library 920, Onboarding/Topic 940, Roadmap/Progress 1000,
 * Recall 740 — see design.md §4); pass the same value to <Header>.
 * Scrolling is owned by <main> in AppShell so header and content move together.
 */
export default function ContentArea({
  maxWidth,
  children,
}: {
  maxWidth: number;
  children: ReactNode;
}) {
  const inner: CSSProperties = { maxWidth: `${maxWidth}px`, margin: "0 auto" };
  return (
    <div className="app-content" style={{ flex: 1, padding: "0 28px 72px" }}>
      <div style={inner}>{children}</div>
    </div>
  );
}
