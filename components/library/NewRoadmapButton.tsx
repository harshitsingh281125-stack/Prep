"use client";

import Link from "next/link";

// The "New roadmap" affordance on Library when at least one roadmap exists.
// When the quota is hit, it's disabled (the server route enforces it regardless,
// Rule 18) and explains why on hover.
export default function NewRoadmapButton({ canCreate }: { canCreate: boolean }) {
  if (!canCreate) {
    return (
      <span
        title="You've used all your roadmap creations. Delete one to make room."
        style={{
          padding: "11px 20px",
          borderRadius: "9px",
          border: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          color: "var(--text-faint)",
          font: "inherit",
          fontSize: "14px",
          fontWeight: 600,
          cursor: "not-allowed",
        }}
      >
        Roadmap limit reached
      </span>
    );
  }

  return (
    <Link
      href="/onboarding"
      style={{
        padding: "11px 20px",
        borderRadius: "9px",
        border: "1px solid var(--accent)",
        background: "var(--accent)",
        color: "oklch(0.99 0 0)",
        font: "inherit",
        fontSize: "14px",
        fontWeight: 600,
        cursor: "pointer",
        textDecoration: "none",
      }}
    >
      New roadmap →
    </Link>
  );
}
