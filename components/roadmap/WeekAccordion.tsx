"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { topicStatusMeta } from "@/lib/roadmap/status";
import type { TopicStatus } from "@/lib/seed/types";

export type WeekData = {
  id: string;
  n: number;
  title: string;
  hours: number;
  killCriterion: string;
  mastered: number;
  total: number;
  topics: { id: string; name: string; status: TopicStatus }[];
};

const MONO = "'IBM Plex Mono',monospace";

// A week accordion (design): header (W{n} · title · progress · hours chip) →
// topic rows (status dot + name + status label + "study →") → kill-criterion strip.
// CSS-only collapse (design.md §9: reach for CSS first).
export default function WeekAccordion({
  roadmapId,
  week,
  defaultOpen,
}: {
  roadmapId: string;
  week: WeekData;
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!!defaultOpen);

  const progLabel = `${week.mastered}/${week.total} mastered`;
  const allMastered = week.total > 0 && week.mastered === week.total;

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden" }}>
      {/* Header (clickable to toggle) */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          width: "100%",
          padding: "14px 18px",
          // Longhand only — the toggling border must not mix with a `border`
          // shorthand, or React warns about conflicting style props on re-render.
          borderTop: "none",
          borderRight: "none",
          borderLeft: "none",
          borderBottom: open ? "1px solid var(--border)" : "1px solid transparent",
          background: "none",
          cursor: "pointer",
          font: "inherit",
          color: "var(--text)",
          textAlign: "left",
        }}
      >
        <span style={{ fontFamily: MONO, fontSize: "12px", color: "var(--text-faint)", flex: "0 0 auto" }}>
          W{week.n}
        </span>
        <span style={{ fontWeight: 600, flex: 1 }}>{week.title}</span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: "11.5px",
            color: allMastered ? "var(--green)" : "var(--text-muted)",
          }}
        >
          {progLabel}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: "12px",
            color: "var(--text-muted)",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            padding: "3px 8px",
          }}
        >
          {week.hours}h
        </span>
        <span
          aria-hidden
          style={{
            color: "var(--text-faint)",
            transition: "transform 0.18s ease",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            display: "inline-block",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M6 4l4 4-4 4" />
          </svg>
        </span>
      </button>

      {open && (
        <div>
          {week.topics.map((t) => {
            const m = topicStatusMeta(t.status);
            return (
              <TopicRow
                key={t.id}
                name={t.name}
                statusLabel={m.label}
                statusColor={m.color}
                onOpen={() => router.push(`/roadmap/${roadmapId}/topic/${t.id}`)}
              />
            );
          })}
          {/* Kill criterion strip */}
          <div
            style={{
              display: "flex",
              gap: "10px",
              alignItems: "flex-start",
              padding: "12px 18px",
              background: "var(--bg-sunken)",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="var(--red)"
              strokeWidth={1.5}
              style={{ marginTop: "2px", flex: "0 0 auto" }}
            >
              <circle cx="8" cy="8" r="6" />
              <circle cx="8" cy="8" r="2.2" />
            </svg>
            <div style={{ fontSize: "12.5px", lineHeight: 1.5 }}>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: "11px",
                  color: "var(--red)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Kill criterion
              </span>{" "}
              <span style={{ color: "var(--text-muted)" }}>{week.killCriterion}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TopicRow({
  name,
  statusLabel,
  statusColor,
  onOpen,
}: {
  name: string;
  statusLabel: string;
  statusColor: string;
  onOpen: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "11px 18px",
        borderBottom: "1px solid var(--border)",
        cursor: "pointer",
        background: hover ? "var(--bg-elevated)" : "transparent",
      }}
    >
      <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: statusColor, flex: "0 0 8px" }} />
      <div style={{ flex: 1, fontSize: "13.5px" }}>{name}</div>
      <div style={{ fontSize: "12px", color: statusColor, fontFamily: MONO }}>{statusLabel}</div>
      <div style={{ color: "var(--text-faint)", fontFamily: MONO, fontSize: "12px" }}>study →</div>
    </div>
  );
}
