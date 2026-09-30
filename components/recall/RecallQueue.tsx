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

const MONO = "var(--font-mono)";

/* Grade buttons are neutral outlines; the verdict colour lives in a small dot,
   so a queue of ten cards isn't twenty red and green blocks. */
function gradeStyle(isPending: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 16px",
    border: "1px solid var(--border-strong)",
    background: "transparent",
    color: "var(--text)",
    borderRadius: "8px",
    cursor: isPending ? "progress" : "pointer",
    fontWeight: 500,
    fontSize: "13.5px",
    fontFamily: "inherit",
    opacity: isPending ? 0.6 : 1,
  };
}

function dot(color: string): CSSProperties {
  return { width: "7px", height: "7px", borderRadius: "50%", background: color, flex: "0 0 7px" };
}

/**
 * The recall queue. Grading is a SERVER round-trip (/api/recall/[cardId]/grade)
 * because the scheduler's decision has to be trusted — so unlike Phase 1's notes
 * autosave, this is deliberately NOT an optimistic client write. The card shows a
 * pending state while the request is in flight and renders the interval the
 * server actually chose.
 */
export default function RecallQueue({
  cards,
  totalCards,
}: {
  cards: DueCard[];
  /** Every card the user owns, due or not — distinguishes "clear" from "empty". */
  totalCards: number;
}) {
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
      {/* Honesty line, the schedule ladder, and the running session score. */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "8px 24px",
          flexWrap: "wrap",
          paddingBottom: "16px",
          borderBottom: "1px solid var(--border)",
          fontSize: "13px",
          color: "var(--text-muted)",
        }}
      >
        <div>Grade yourself honestly — a &ldquo;close enough&rdquo; is a miss.</div>
        <div style={{ display: "flex", gap: "16px", color: "var(--text-faint)" }}>
          <span>
            Accuracy{" "}
            <span style={{ fontWeight: 600, color: accColor }} data-testid="recall-accuracy">
              {accuracy}
            </span>
          </span>
          <span data-testid="recall-progress">
            {doneCount} of {cards.length} graded
          </span>
        </div>
      </div>
      <div style={{ fontSize: "12.5px", color: "var(--text-faint)", margin: "10px 0 8px" }}>
        Schedule{" "}
        <span style={{ fontFamily: MONO, fontSize: "12px" }}>
          {LADDER_DAYS.map((d) => intervalLabel(d)).join(" → ")}
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
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {cards.map((card, i) => {
          const g = graded[card.id];
          const isPending = !!pending[card.id];
          const right = g?.grade === "right";

          return (
            <li
              key={card.id}
              data-testid="recall-card"
              data-card-id={card.id}
              style={{
                display: "grid",
                gridTemplateColumns: "36px minmax(0, 1fr)",
                padding: "26px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span style={{ fontFamily: MONO, fontSize: "12px", color: "var(--text-faint)", paddingTop: "6px" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: "10px",
                    fontSize: "12.5px",
                    color: "var(--text-faint)",
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{card.topicLabel}</span>
                  <span style={{ fontFamily: MONO, fontSize: "12px" }} title="Next gap if you get it right">
                    {card.projectedLabel}
                  </span>
                </div>

                <div
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontSize: "20px",
                    lineHeight: 1.45,
                    marginTop: "6px",
                    textWrap: "pretty",
                    color: g ? "var(--text-muted)" : "var(--text)",
                    transition: "color 140ms ease",
                  }}
                >
                  {card.question}
                </div>

                {g ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "16px", fontSize: "13px" }}>
                    <span
                      style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600, color: right ? "var(--green)" : "var(--red)" }}
                      data-testid="recall-result"
                    >
                      <span style={dot(right ? "var(--green)" : "var(--red)")} />
                      {right ? "Got it" : "Missed"}
                    </span>
                    <span style={{ color: "var(--text-faint)" }} data-testid="recall-scheduled">
                      {right
                        ? `→ next review in ${g.intervalDays} ${g.intervalDays === 1 ? "day" : "days"}`
                        : "→ reset to +1d (missed)"}
                    </span>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "10px", marginTop: "18px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="hover-row"
                      onClick={() => grade(card.id, "right")}
                      disabled={isPending}
                      data-testid="grade-right"
                      style={gradeStyle(isPending)}
                    >
                      <span style={dot("var(--green)")} />
                      Got it cold
                    </button>
                    <button
                      type="button"
                      className="hover-row"
                      onClick={() => grade(card.id, "wrong")}
                      disabled={isPending}
                      data-testid="grade-wrong"
                      style={gradeStyle(isPending)}
                    >
                      <span style={dot("var(--red)")} />
                      Missed it
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* No deck at all — NOT the same as "you're caught up". Says what to do
          rather than implying there is nothing to do. */}
      {cleared && totalCards === 0 && (
        <div
          style={{
            padding: "40px 0",
          }}
          data-testid="recall-empty"
        >
          <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px" }}>No recall cards yet.</div>
          <div
            style={{
              fontSize: "13px",
              marginTop: "6px",
              color: "var(--text-muted)",
              lineHeight: 1.6,
              maxWidth: "52ch",
              margin: "8px 0 0",
            }}
          >
            Spaced repetition needs questions to space out. Open a topic in your roadmap and hit{" "}
            <b>Generate recall cards</b> — they land in this queue due immediately.
          </div>
        </div>
      )}

      {cleared && totalCards > 0 && (
        <div
          style={{ padding: "40px 0", color: "var(--text-muted)" }}
          data-testid="recall-cleared"
        >
          <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", color: "var(--text)" }}>Queue clear.</div>
          <div style={{ fontSize: "14px", marginTop: "8px" }}>
            {cards.length === 0
              ? "Nothing is due right now. Don't cram ahead — the spacing is the point."
              : "That's every card due today. Don't cram ahead — the spacing is the point."}
          </div>
        </div>
      )}
    </div>
  );
}
