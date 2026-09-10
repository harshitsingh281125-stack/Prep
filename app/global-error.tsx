"use client";

/**
 * The last-resort error boundary (Phase 5).
 *
 * `(app)/error.tsx` catches anything a page throws, but a boundary cannot catch
 * an error in its own parent — so a throw inside the root layout, or inside
 * `(app)/layout.tsx` (which does a Supabase `getUser()` and a profile query on
 * every request), would escape it. global-error.tsx is the only boundary above
 * the root layout.
 *
 * That is also why it renders its own <html> and <body>: when it fires, the root
 * layout is the thing that failed, so its markup is not available to wrap this.
 * It therefore cannot use the app's design tokens either — globals.css is
 * imported by that same root layout — which is the one other place besides the
 * print view where colours are written literally rather than as tokens. Not a
 * Rule 21 exception so much as the boundary condition Rule 21 assumes: there is
 * no token layer left to go through.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
          background: "#14151a",
          color: "#f2f3f7",
          padding: "28px",
        }}
      >
        <div style={{ maxWidth: "440px", textAlign: "center" }}>
          <h1 style={{ fontSize: "18px", fontWeight: 600, margin: "0 0 8px" }}>
            Prep failed to start.
          </h1>
          <p style={{ fontSize: "14px", lineHeight: 1.6, color: "#a4a7b5", margin: "0 0 20px" }}>
            Something went wrong before the app could render. Reloading usually clears it.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "10px 18px",
              borderRadius: "9px",
              border: "1px solid #5b63d3",
              background: "#5b63d3",
              color: "#ffffff",
              font: "inherit",
              fontSize: "13.5px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          {error.digest && (
            <div style={{ marginTop: "16px", fontSize: "11px", color: "#75788a" }}>
              ref: {error.digest}
            </div>
          )}
        </div>
      </body>
    </html>
  );
}
