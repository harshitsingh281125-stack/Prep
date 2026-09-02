"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { detailSourceMeta, topicStatusMeta, type DetailSource } from "@/lib/roadmap/status";
import type { TopicStatus } from "@/lib/seed/types";

export type WeekData = {
  id: string;
  n: number;
  title: string;
  hours: number;
  killCriterion: string;
  mastered: number;
  total: number;
  /** Topics with content generated — the numerator of the header's content chip. */
  withDetail: number;
  topics: { id: string; name: string; status: TopicStatus; detailSource: DetailSource }[];
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
  const allGenerated = week.total > 0 && week.withDetail === week.total;

  return (
    <div
      data-testid="week-accordion"
      style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden" }}
    >
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
        {/* Content coverage (Phase 5). Weeks are collapsed by default, so without
            this you'd have to expand every accordion to learn which topics still
            have no study material — which is the thing the per-row chips below
            were added to save you. */}
        <span
          data-testid="week-content-count"
          title={`${week.withDetail} of ${week.total} topics in this week have study material generated.`}
          style={{
            fontFamily: MONO,
            fontSize: "11.5px",
            color: allGenerated ? "var(--accent)" : "var(--text-faint)",
          }}
        >
          {week.withDetail}/{week.total} studied
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
                detailSource={t.detailSource}
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
  detailSource,
  onOpen,
}: {
  name: string;
  statusLabel: string;
  statusColor: string;
  detailSource: DetailSource;
  onOpen: () => void;
}) {
  const [hover, setHover] = useState(false);
  const d = detailSourceMeta(detailSource);
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
      {/* Content marker (Phase 5): does study material exist for this topic, and
          how grounded is it? Rendered as a bordered CHIP while the progress label
          beside it stays plain text — two mono labels in one row would otherwise
          read as one metric, and these answer different questions ("is the content
          there" vs "have you mastered it"). The not-generated state is drawn
          dashed and faint rather than omitted: a missing chip is invisible when
          you are scanning 25 rows for the topics you still have to generate. */}
      <div
        data-testid="topic-content-chip"
        data-source={detailSource ?? "none"}
        title={d.hint}
        style={{
          fontFamily: MONO,
          fontSize: "10.5px",
          letterSpacing: "0.04em",
          color: d.color,
          background: d.soft,
          border: (detailSource ? "1px solid " : "1px dashed ") + d.color,
          borderRadius: "5px",
          padding: "2px 7px",
          flex: "0 0 auto",
          whiteSpace: "nowrap",
        }}
      >
        {d.label}
      </div>
      <div style={{ fontSize: "12px", color: statusColor, fontFamily: MONO }}>{statusLabel}</div>
      <div style={{ color: "var(--text-faint)", fontFamily: MONO, fontSize: "12px" }}>study →</div>
    </div>
  );
}
