"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
    <section data-testid="week-accordion" style={{ borderBottom: "1px solid var(--border)" }}>
      {/* Header (clickable to toggle) */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="week-head"
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "16px",
          width: "100%",
          padding: "20px 0",
          border: "none",
          background: "none",
          cursor: "pointer",
          font: "inherit",
          color: "var(--text)",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: "13px", color: "var(--text-faint)", flex: "0 0 58px", fontWeight: 500 }}>
          Week {week.n}
        </span>
        <span
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "20px",
            fontWeight: 500,
            letterSpacing: "-0.01em",
            flex: 1,
            minWidth: 0,
          }}
        >
          {week.title}
        </span>
        <span className="week-meta" style={{ display: "flex", gap: "18px", fontSize: "13px", color: "var(--text-faint)", flex: "0 0 auto" }}>
          <span style={{ color: allMastered ? "var(--green)" : undefined }}>{progLabel}</span>
          {/* Content coverage (Phase 5). Weeks are collapsed by default, so without
              this you'd have to expand every accordion to learn which topics still
              have no study material. */}
          <span
            data-testid="week-content-count"
            title={`${week.withDetail} of ${week.total} topics in this week have study material generated.`}
            style={{ color: allGenerated ? "var(--accent)" : undefined }}
          >
            {week.withDetail}/{week.total} studied
          </span>
          <span>{week.hours}h</span>
        </span>
        <span
          aria-hidden
          style={{
            color: "var(--text-faint)",
            transition: "transform 0.18s ease",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            display: "inline-block",
            alignSelf: "center",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M6 4l4 4-4 4" />
          </svg>
        </span>
      </button>

      {open && (
        <div style={{ paddingLeft: "74px", paddingBottom: "22px" }} className="week-body">
          <div style={{ borderTop: "1px solid var(--border)" }}>
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
          </div>
          {/* Kill criterion — set as a pull-quote: it is the sentence you are held to. */}
          <div style={{ marginTop: "18px", paddingLeft: "16px", borderLeft: "2px solid var(--red)" }}>
            <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--red)" }}>Kill criterion</div>
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "16.5px",
                lineHeight: 1.5,
                marginTop: "3px",
                color: "var(--text)",
              }}
            >
              {week.killCriterion}
            </div>
          </div>
        </div>
      )}
    </section>
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
  const d = detailSourceMeta(detailSource);
  // The topic route has no loading.tsx (it can 404), so the row carries the
  // pending state until the topic page has rendered.
  const [navigating, startNavigation] = useTransition();
  return (
    <div
      className={"hover-row topic-row" + (navigating ? " is-navigating" : "")}
      aria-busy={navigating || undefined}
      onClick={() => startNavigation(onOpen)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "14px",
        padding: "11px 0",
        borderBottom: "1px solid var(--border)",
        cursor: "pointer",
      }}
    >
      <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: statusColor, flex: "0 0 7px" }} />
      <div className="topic-name" style={{ flex: 1, fontSize: "14.5px" }}>{name}</div>
      {/* Content marker (Phase 5): does study material exist for this topic, and
          how grounded is it? Plain coloured text — the not-generated state stays
          visible (faint) rather than omitted, so a scan finds what's missing. */}
      <div
        data-testid="topic-content-chip"
        data-source={detailSource ?? "none"}
        title={d.hint}
        style={{ fontSize: "12.5px", color: d.color, flex: "0 0 88px", whiteSpace: "nowrap" }}
      >
        {d.label}
      </div>
      <div style={{ fontSize: "12.5px", color: statusColor, flex: "0 0 84px" }}>{statusLabel}</div>
      <div style={{ color: "var(--text-muted)", fontSize: "12.5px", fontWeight: 500 }}>
        {navigating ? "opening…" : "study →"}
      </div>
    </div>
  );
}
