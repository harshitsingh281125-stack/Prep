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
          padding: "8px 14px",
          borderRadius: "8px",
          border: "1px solid var(--border)",
          color: "var(--text-faint)",
          fontSize: "13.5px",
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
      className="btn-ink"
      style={{
        padding: "8px 14px",
        borderRadius: "8px",
        background: "var(--ink)",
        color: "var(--on-ink)",
        fontSize: "13.5px",
        fontWeight: 600,
        cursor: "pointer",
        textDecoration: "none",
      }}
    >
      New roadmap
    </Link>
  );
}
