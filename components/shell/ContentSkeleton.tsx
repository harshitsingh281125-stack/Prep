/**
 * The shared loading skeleton (Phase 5).
 *
 * Lives here rather than as a single `(app)/loading.tsx` because of a defect that
 * cost this phase a red suite — see the note in each `loading.tsx` that re-exports
 * it, and memory.md (2026-08-27). Short version: a `loading.tsx` makes its segment
 * STREAM, and a streamed response has already sent its 200 headers by the time an
 * async page calls notFound() — so the two routes that 404 must not have one.
 */
/**
 * The loading skeleton body (Phase 5).
 *
 * WHAT `loading.tsx` ACTUALLY IS: Next wraps the segment's page in a
 * <Suspense fallback={<Loading />}>. Every screen in (app) is an async server
 * component that awaits Supabase, so before this file existed a navigation just
 * *hung* on the old screen until the query returned — the click looked ignored.
 * Now the shell (sidebar, which lives in the LAYOUT and therefore never
 * re-renders) stays put and only the content area swaps to this.
 *
 * One file covers every screen because they share one shape: header strip, a row
 * of tiles, a stack of cards. A skeleton's job is to hold the layout still, not
 * to be a pixel-accurate preview of a screen the user is about to see anyway.
 *
 * Pure CSS keyframes, per design.md §9 — and it inherits the global
 * prefers-reduced-motion rule, which collapses the pulse to a static block
 * rather than strobing at someone who asked their OS to stop.
 */
export default function ContentSkeleton() {
  return (
    <div className="app-content" style={{ flex: 1, overflowY: "auto", padding: "28px" }} aria-hidden>
      {/* aria-hidden + the aria-busy on the live region below: a screen reader
          should hear "loading", once — not have every grey rectangle announced. */}
      <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
        <Bar width="220px" height="20px" />
        <div style={{ height: "18px" }} />
        <div className="grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
          {[0, 1, 2, 3].map((i) => (
            <Block key={i} height="76px" />
          ))}
        </div>
        <div style={{ height: "22px" }} />
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ marginBottom: "14px" }}>
            <Block height="92px" />
          </div>
        ))}
      </div>
      <span role="status" aria-busy="true" style={SR_ONLY}>
        Loading
      </span>
      <style>{PULSE}</style>
    </div>
  );
}

const SR_ONLY: React.CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

const PULSE = `
@keyframes prep-skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
`;

const skeletonStyle: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: "10px",
  animation: "prep-skeleton-pulse 1.4s ease-in-out infinite",
};

function Block({ height }: { height: string }) {
  return <div style={{ ...skeletonStyle, height }} />;
}

function Bar({ width, height }: { width: string; height: string }) {
  return <div style={{ ...skeletonStyle, width, height, borderRadius: "6px" }} />;
}
