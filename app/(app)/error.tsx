"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * The error boundary for every in-app screen (Phase 5).
 *
 * WHY IT MUST BE A CLIENT COMPONENT: it receives `reset`, a function prop, and
 * it renders an onClick. Server components can't do either — this is the one
 * place in Next where the "use client" directive isn't a choice.
 *
 * WHAT IT CATCHES: a throw during render of a page in (app), including inside an
 * async server component (the framework serialises the error across and renders
 * this on the client). WHAT IT DOES NOT CATCH: an error thrown by (app)/layout.tsx
 * itself — a boundary can't catch its own parent — which is why app/global-error.tsx
 * also exists.
 *
 * Rule 9's shape, applied to plumbing rather than AI: a failure states what it
 * is and offers the way forward. `reset()` re-renders the segment, which for a
 * transient DB hiccup is a genuine one-click recovery rather than a "try again"
 * button that reloads the whole app and loses the user's place.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server error is redacted in production and identified only by `digest`.
    // Logging it here is what makes a user-reported "it broke" traceable to a
    // server log line; without it the digest on screen matches nothing.
    console.error("Prep app error:", error.digest ?? "(no digest)", error.message);
  }, [error]);

  return (
    <div className="app-content" style={{ flex: 1, overflowY: "auto", padding: "28px" }}>
      <div style={{ maxWidth: "620px", margin: "48px auto 0" }}>
        <div
          role="alert"
          style={{
            borderLeft: "2px solid var(--red)",
            paddingLeft: "22px",
          }}
        >
          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--red)", marginBottom: "6px" }}>
            Something broke
          </div>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: "28px", fontWeight: 500, marginBottom: "8px" }}>
            This screen didn&apos;t load.
          </div>
          <p style={{ fontSize: "15px", color: "var(--text-muted)", lineHeight: 1.6, marginTop: 0 }}>
            Your data is fine — nothing here writes on load. Retry the screen, or go back to your
            roadmaps.
          </p>
          <div style={{ display: "flex", gap: "10px", marginTop: "18px", flexWrap: "wrap" }}>
            <button type="button" onClick={reset} style={primaryButton}>
              Try again
            </button>
            <Link href="/library" style={secondaryButton}>
              My roadmaps
            </Link>
          </div>
          {error.digest && (
            <div
              style={{
                marginTop: "16px",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                color: "var(--text-faint)",
              }}
            >
              ref: {error.digest}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const primaryButton: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: "8px",
  border: "1px solid var(--ink)",
  background: "var(--ink)",
  color: "var(--on-ink)",
  font: "inherit",
  fontSize: "13.5px",
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButton: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: "8px",
  border: "1px solid var(--border-strong)",
  background: "transparent",
  color: "var(--text)",
  font: "inherit",
  fontSize: "13.5px",
  fontWeight: 600,
  textDecoration: "none",
};
