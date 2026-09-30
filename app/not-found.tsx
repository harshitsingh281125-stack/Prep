import Link from "next/link";

/**
 * The 404 page (Phase 5).
 *
 * Two different things land here, and the copy has to serve both without lying
 * about which happened:
 *
 *   1. a URL that matches no route at all;
 *   2. an explicit `notFound()` from a page — which in Prep almost always means
 *      "that row exists but is not yours". The Roadmap, Topic and print pages
 *      all call it when their RLS-scoped query returns nothing.
 *
 * Case 2 is why this page says "not found" and never "you don't have access":
 * distinguishing the two would confirm to a stranger that a given roadmap id is
 * real, which is exactly the leak RLS-returns-nothing avoids in the first place.
 * An honest 404 here is a security property, not just tidy copy.
 *
 * It renders WITHOUT the app shell (it sits at the root, above the (app) group)
 * — deliberate, since one of the ways to arrive is with no valid session
 * context at all.
 */
export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "28px",
        background: "var(--bg)",
      }}
    >
      <div style={{ maxWidth: "440px" }}>
        <div style={{ fontSize: "13px", color: "var(--text-faint)", fontWeight: 500 }}>Error 404</div>
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "40px",
            fontWeight: 500,
            letterSpacing: "-0.02em",
            margin: "6px 0 12px",
          }}
        >
          Nothing here.
        </h1>
        <p style={{ fontSize: "15px", color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 28px" }}>
          Either that page doesn&apos;t exist, or it isn&apos;t yours. Prep only ever shows you your
          own roadmaps.
        </p>
        <Link
          href="/library"
          style={{
            display: "inline-block",
            padding: "10px 18px",
            borderRadius: "8px",
            background: "var(--ink)",
            color: "var(--on-ink)",
            fontSize: "14px",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Back to my roadmaps →
        </Link>
      </div>
    </div>
  );
}
