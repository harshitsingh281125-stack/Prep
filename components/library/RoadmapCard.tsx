"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

// A roadmap card (design's library card): title/subtitle, status badge, progress
// bar (fill = status color), mono stat chips, footer. Whole card navigates in;
// the delete control frees a quota slot (Rule 18) via the DELETE route.
export default function RoadmapCard({ data }: { data: RoadmapCardData }) {
  const router = useRouter();
  const [hover, setHover] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      onClick={() => router.push(`/roadmap/${data.id}`)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: "var(--panel)",
        border: "1px solid " + (hover ? "var(--border-strong)" : "var(--border)"),
        borderRadius: "14px",
        padding: "20px",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        opacity: deleting ? 0.5 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{data.title}</div>
          <div style={{ fontSize: "12.5px", color: "var(--text-muted)", marginTop: "2px" }}>
            {data.subtitle}
          </div>
        </div>
        <span
          style={{
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: "11px",
            color: data.statusColor,
            background: data.statusSoft,
            border: "1px solid " + data.statusColor,
            borderRadius: "6px",
            padding: "3px 9px",
            flex: "0 0 auto",
          }}
        >
          {data.statusLabel}
        </span>
      </div>

      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: "11.5px",
            color: "var(--text-muted)",
            marginBottom: "6px",
          }}
        >
          <span>
            {data.hoursLogged} / {data.hoursPlanned}h logged
          </span>
          <span>{data.pct}%</span>
        </div>
        <div style={{ height: "7px", borderRadius: "4px", background: "var(--bg-elevated)", overflow: "hidden" }}>
          <div
            style={{
              width: `${data.pct}%`,
              height: "100%",
              background: data.statusColor,
              borderRadius: "4px",
              minWidth: data.pct > 0 ? "3px" : "0",
            }}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <Chip>
          {data.mastered} / {data.total} mastered
        </Chip>
        {/* Recall + due chips arrive with Phase 2 (spaced repetition). */}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          marginTop: "2px",
        }}
      >
        <span style={{ fontSize: "12px", color: "var(--text-faint)" }}>{relativeCreated(data.createdAt)}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            onClick={onDelete}
            disabled={deleting}
            title="Delete roadmap"
            style={{
              border: "none",
              background: "none",
              color: "var(--text-faint)",
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: "12px",
              cursor: deleting ? "default" : "pointer",
              padding: 0,
            }}
          >
            Delete
          </button>
          <span
            style={{
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: "12px",
              color: "var(--accent)",
              fontWeight: 500,
            }}
          >
            Open →
          </span>
        </div>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "'IBM Plex Mono',monospace",
        fontSize: "11px",
        color: "var(--text-muted)",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        padding: "3px 8px",
      }}
    >
      {children}
    </span>
  );
}
