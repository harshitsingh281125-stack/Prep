import type { CSSProperties, ReactNode } from "react";

/**
 * The scrolling content area under the header (padding:28px in the design).
 * `maxWidth` centers content per-screen (Library 920, Onboarding/Topic 940,
 * Roadmap/Progress 1000, Recall 740 — see design.md §4).
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
    <div className="app-content" style={{ flex: 1, overflowY: "auto", padding: "28px" }}>
      <div style={inner}>{children}</div>
    </div>
  );
}
