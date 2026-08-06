"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { LADDER_DAYS, intervalLabel } from "@/lib/recall/scheduler";

export type DueCard = {
  id: string;
  topicLabel: string;
  question: string;
  /** The gap this card would get on a correct grade — shown as the "+4d" chip. */
  projectedLabel: string;
};

type Graded = {
  grade: "right" | "wrong";
  /** What the SERVER decided (never the client's guess). */
  intervalDays: number;
};

const MONO = "'IBM Plex Mono',monospace";

const chipStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: "11px",
  color: "var(--text-muted)",
  border: "1px solid var(--border)",
  borderRadius: "5px",
  padding: "2px 7px",
};

/**
 * The recall queue. Grading is a SERVER round-trip (/api/recall/[cardId]/grade)
 * because the scheduler's decision has to be trusted — so unlike Phase 1's notes
 * autosave, this is deliberately NOT an optimistic client write. The card shows a
 * pending state while the request is in flight and renders the interval the
 * server actually chose.
 */
export default function RecallQueue({ cards }: { cards: DueCard[] }) {
  const [graded, setGraded] = useState<Record<string, Graded>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  async function grade(cardId: string, value: "right" | "wrong") {
    if (pending[cardId] || graded[cardId]) return;
    setPending((p) => ({ ...p, [cardId]: true }));
    setError(null);

    try {
      const res = await fetch(`/api/recall/${cardId}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade: value }),
      });
      if (!res.ok) throw new Error("grade failed");
      const data = (await res.json()) as { intervalDays: number };
      setGraded((g) => ({ ...g, [cardId]: { grade: value, intervalDays: data.intervalDays } }));
    } catch {
      setError("Couldn't save that grade. Check your connection and try again.");
    } finally {
      setPending((p) => ({ ...p, [cardId]: false }));
    }
  }

  const doneCount = Object.keys(graded).length;
  const rightCount = Object.values(graded).filter((g) => g.grade === "right").length;
  const accuracy = doneCount ? Math.round((rightCount / doneCount) * 100) + "%" : "—";
  const accRatio = doneCount ? rightCount / doneCount : 0;
  const accColor = !doneCount
    ? "var(--text-faint)"
    : accRatio >= 0.7
      ? "var(--green)"
      : accRatio >= 0.5
        ? "var(--amber)"
        : "var(--red)";

  // "Queue clear" — either nothing was due, or everything due has been graded.
  const cleared = cards.length === 0 || doneCount === cards.length;

  return (
    <div>
      {/* Header row: honesty line + the advertised schedule ladder */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          marginBottom: "8px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
          Spaced recall. Grade yourself honestly — a &ldquo;close enough&rdquo; is a miss.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontFamily: MONO, fontSize: "11px", color: "var(--text-faint)", marginRight: "2px" }}>
            SCHEDULE
          </span>
          {LADDER_DAYS.map((d) => (
            <span key={d} style={chipStyle}>
              {intervalLabel(d)}
            </span>
          ))}
        </div>
      </div>

      {/* Session stats */}
      <div
        style={{
          display: "flex",
          gap: "14px",
          margin: "16px 0 22px",
          fontFamily: MONO,
          fontSize: "12px",
        }}
      >
        <span style={{ color: "var(--text-muted)" }}>
          Session accuracy{" "}
          <span style={{ fontWeight: 600, color: accColor }} data-testid="recall-accuracy">
            {accuracy}
          </span>
        </span>
        <span style={{ color: "var(--text-faint)" }}>·</span>
        <span style={{ color: "var(--text-muted)" }} data-testid="recall-progress">
          {doneCount} of {cards.length} graded
        </span>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            background: "var(--red-soft)",
            border: "1px solid var(--red)",
            color: "var(--red)",
            borderRadius: "8px",
            padding: "10px 14px",
            fontSize: "13px",
            marginBottom: "14px",
          }}
        >
          {error}
        </div>
      )}

      {/* Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {cards.map((card) => {
          const g = graded[card.id];
          const isPending = !!pending[card.id];
          const right = g?.grade === "right";

          return (
            <div
              key={card.id}
              data-testid="recall-card"
              data-card-id={card.id}
              style={{
                background: "var(--panel)",
                borderRadius: "12px",
                padding: "18px 20px",
                border: "1px solid " + (g ? (right ? "var(--green)" : "var(--red)") : "var(--border)"),
                opacity: g ? 0.82 : 1,
                transition: "opacity 140ms ease, border-color 140ms ease",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                  marginBottom: "12px",
                }}
              >
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: "11px",
                    color: "var(--text-faint)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {card.topicLabel}
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: "11px",
                    color: "var(--text-faint)",
                    border: "1px solid var(--border)",
                    borderRadius: "5px",
                    padding: "2px 7px",
                  }}
                >
                  {card.projectedLabel}
                </span>
              </div>

              <div style={{ fontSize: "15.5px", lineHeight: 1.55, fontWeight: 500, textWrap: "pretty" }}>
                {card.question}
              </div>

              {g ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    marginTop: "14px",
                    paddingTop: "12px",
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: "12px",
                      fontWeight: 600,
                      color: right ? "var(--green)" : "var(--red)",
                    }}
                    data-testid="recall-result"
                  >
                    {right ? "✓ Got it" : "✗ Missed"}
                  </span>
                  <span
                    style={{ fontSize: "12.5px", color: "var(--text-muted)", fontFamily: MONO }}
                    data-testid="recall-scheduled"
                  >
                    {right
                      ? `→ next review in ${g.intervalDays} ${g.intervalDays === 1 ? "day" : "days"}`
                      : "→ reset to +1d (missed)"}
                  </span>
                </div>
              ) : (
                <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                  <button
                    type="button"
                    onClick={() => grade(card.id, "wrong")}
                    disabled={isPending}
                    data-testid="grade-wrong"
                    style={{
                      flex: 1,
                      padding: "9px",
                      border: "1px solid var(--red)",
                      background: "var(--red-soft)",
                      color: "var(--red)",
                      borderRadius: "8px",
                      cursor: isPending ? "progress" : "pointer",
                      fontWeight: 600,
                      fontSize: "13px",
                      fontFamily: "inherit",
                      opacity: isPending ? 0.6 : 1,
                    }}
                  >
                    Missed it
                  </button>
                  <button
                    type="button"
                    onClick={() => grade(card.id, "right")}
                    disabled={isPending}
                    data-testid="grade-right"
                    style={{
                      flex: 1,
                      padding: "9px",
                      border: "1px solid var(--green)",
                      background: "var(--green-soft)",
                      color: "var(--green)",
                      borderRadius: "8px",
                      cursor: isPending ? "progress" : "pointer",
                      fontWeight: 600,
                      fontSize: "13px",
                      fontFamily: "inherit",
                      opacity: isPending ? 0.6 : 1,
                    }}
                  >
                    Got it cold
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {cleared && (
        <div
          style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-muted)" }}
          data-testid="recall-cleared"
        >
          <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text)" }}>Queue clear.</div>
          <div style={{ fontSize: "13px", marginTop: "6px" }}>
            {cards.length === 0
              ? "Nothing is due right now. Don't cram ahead — the spacing is the point."
              : "That's every card due today. Don't cram ahead — the spacing is the point."}
          </div>
        </div>
      )}
    </div>
  );
}
