/**
 * The shared loading skeleton (Phase 5).
 *
 * Lives here rather than as a single `(app)/loading.tsx` because of a defect that
 * cost this phase a red suite — see the note in each `loading.tsx` that re-exports
 * it, and memory.md (2026-08-27). Short version: a `loading.tsx` makes its segment
 * STREAM, and a streamed response has already sent its 200 headers by the time an
 * async page calls notFound() — so the two routes that 404 must not have one.
 *
 * WHAT `loading.tsx` ACTUALLY IS: Next wraps the segment's page in a
 * <Suspense fallback={<Loading />}>. Every screen in (app) is an async server
 * component that awaits Supabase, so without it a navigation just *hung* on the
 * old screen until the query returned — the click looked ignored. The shell
 * (sidebar, which lives in the LAYOUT and therefore never re-renders) stays put
 * and only the content area swaps to this.
 *
 * Two shapes: `dashboard` (serif title, a hairline stat row, a list — Library,
 * Recall, Progress, Usage) and `wizard` (Onboarding: question + options beside a
 * rail). A skeleton's job is to hold the layout still, not to be a pixel-accurate
 * preview. The pulse is the global `.skel` class, so the prefers-reduced-motion
 * rule in globals.css turns it into a static block.
 */
export default function ContentSkeleton({ variant = "dashboard" }: { variant?: "dashboard" | "wizard" }) {
  return (
    <div className="app-content" style={{ flex: 1, padding: "44px 28px 72px" }} aria-hidden>
      {/* aria-hidden + the aria-busy on the live region below: a screen reader
          should hear "loading", once — not have every grey rectangle announced. */}
      <div style={{ maxWidth: variant === "wizard" ? "940px" : "1000px", margin: "0 auto" }}>
        <Bar width="240px" height="30px" />
        <div style={{ height: "10px" }} />
        <Bar width="380px" height="14px" />
        <div style={{ height: "32px" }} />
        {variant === "wizard" ? <Wizard /> : <Dashboard />}
      </div>
      <span role="status" aria-busy="true" style={SR_ONLY}>
        Loading
      </span>
    </div>
  );
}

function Dashboard() {
  return (
    <>
      <div
        className="grid-4"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "20px",
          padding: "18px 0",
          borderTop: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <Bar key={i} height="58px" />
        ))}
      </div>
      <div style={{ height: "32px" }} />
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ padding: "18px 0", borderBottom: "1px solid var(--border)" }}>
          <Bar width={`${50 - i * 8}%`} height="20px" />
        </div>
      ))}
    </>
  );
}

function Wizard() {
  return (
    <div className="grid-side" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 280px", gap: "56px" }}>
      <div>
        <Bar height="3px" />
        <div style={{ height: "40px" }} />
        <Bar width="90px" height="13px" />
        <div style={{ height: "12px" }} />
        <Bar width="60%" height="30px" />
        <div style={{ height: "24px" }} />
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {[130, 140, 130, 150].map((w, i) => (
            <Bar key={i} width={`${w}px`} height="40px" radius="999px" />
          ))}
        </div>
      </div>
      <Bar height="300px" radius="12px" />
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

function Bar({ width = "100%", height, radius }: { width?: string; height: string; radius?: string }) {
  return <div className="skel" style={{ width, height, borderRadius: radius }} />;
}
