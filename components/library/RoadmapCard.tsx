"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export type RoadmapCardData = {
  id: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  statusColor: string;
  statusSoft: string;
  pct: number;
  hoursLogged: number;
  hoursPlanned: number;
  mastered: number;
  total: number;
  createdAt: string;
};

function relativeCreated(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "Created today";
  if (days === 1) return "Created yesterday";
  return `Created ${days} days ago`;
}

// A roadmap row in the Library list: serif title, status as dot + word, a
// hairline progress track, and the figures as plain text. Whole row navigates in;
// the delete control frees a quota slot (Rule 18) via the DELETE route.
export default function RoadmapCard({ data }: { data: RoadmapCardData }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  // /roadmap/[id] has no loading.tsx (it can 404 — see recall/loading.tsx), so
  // the row itself shows the navigation is in flight: router.push inside a
  // transition keeps `navigating` true until the new page has rendered.
  const [navigating, startNavigation] = useTransition();

  async function onDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (deleting) return;
    if (!confirm(`Delete "${data.title}"? This frees a roadmap slot and can't be undone.`)) return;
    setDeleting(true);
    const res = await fetch(`/api/roadmaps/${data.id}`, { method: "DELETE" });
    if (res.ok) {
      router.refresh();
    } else {
      setDeleting(false);
      alert("Could not delete that roadmap. Try again.");
    }
  }

  return (
    <div
      className={"hover-row" + (navigating ? " is-navigating" : "")}
      aria-busy={navigating || undefined}
      onClick={() => startNavigation(() => router.push(`/roadmap/${data.id}`))}
      style={{
        borderBottom: "1px solid var(--border)",
        padding: "22px 12px",
        cursor: "pointer",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: "8px 24px",
        alignItems: "baseline",
        opacity: deleting ? 0.5 : undefined,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "21px",
            fontWeight: 500,
            letterSpacing: "-0.01em",
            lineHeight: 1.25,
          }}
        >
          {data.title}
        </div>
        <div style={{ fontSize: "13.5px", color: "var(--text-muted)", marginTop: "4px" }}>{data.subtitle}</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "13px", color: data.statusColor }}>
        <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: data.statusColor }} />
        {data.statusLabel}
      </div>

      {/* Progress: a hairline with the figures beside it, not a chunky bar. */}
      <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: "16px", marginTop: "10px" }}>
        <div style={{ flex: 1, height: "3px", borderRadius: "2px", background: "var(--border)", overflow: "hidden" }}>
          <div
            style={{
              width: `${data.pct}%`,
              height: "100%",
              background: data.statusColor,
              minWidth: data.pct > 0 ? "3px" : "0",
            }}
          />
        </div>
        <span style={{ fontSize: "13px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
          {navigating && <span style={{ marginRight: "10px", color: "var(--text-faint)" }}>Opening…</span>}
          <strong style={{ color: "var(--text)", fontWeight: 600 }}>{data.pct}%</strong>
        </span>
      </div>

      <div
        style={{
          gridColumn: "1 / -1",
          display: "flex",
          alignItems: "center",
          gap: "18px",
          flexWrap: "wrap",
          fontSize: "13px",
          color: "var(--text-faint)",
        }}
      >
        <span>
          {data.mastered} / {data.total} mastered
        </span>
        <span>
          {data.hoursLogged} / {data.hoursPlanned}h logged
        </span>
        <span>{relativeCreated(data.createdAt)}</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={onDelete}
          disabled={deleting}
          title="Delete roadmap"
          className="nav-link"
          style={{
            border: "none",
            background: "none",
            color: "var(--text-faint)",
            font: "inherit",
            fontSize: "13px",
            cursor: deleting ? "default" : "pointer",
            padding: 0,
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
