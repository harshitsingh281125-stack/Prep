"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { SeedResource, TopicDetail, TopicStatus } from "@/lib/seed/types";

const MONO = "'IBM Plex Mono',monospace";

/** Shared style for the two generate buttons in the sidebar panel. */
function secondaryButton(busy: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "9px",
    borderRadius: "8px",
    font: "inherit",
    fontSize: "13px",
    fontWeight: 600,
    cursor: busy ? "wait" : "pointer",
    border: "1px solid var(--accent)",
    background: "var(--accent-soft)",
    color: "var(--accent)",
    opacity: busy ? 0.7 : 1,
  };
}

// Chip color per resource tag (design's tagStyle): Deep/Spec = accent, Talk =
// amber, else muted.
function tagColor(tag: SeedResource["tag"]): string {
  if (tag === "Deep" || tag === "Spec") return "var(--accent)";
  if (tag === "Talk") return "var(--amber)";
  return "var(--text-muted)";
}

/**
 * Where this topic's content came from, in three words the user can act on.
 * Phase 4.5 added the top rung: 'rag' means the resources below are real links
 * chosen from the curated corpus, which is a materially different claim from
 * 'ai' (the model recalled them and nothing checked) — so it gets its own label
 * rather than being folded into "ai-generated".
 */
function sourceLabel(source: TopicDetail["source"]): string {
  if (source === "rag") return "grounded · vetted sources";
  if (source === "ai") return "ai-generated";
  return "template";
}

type SaveState = "idle" | "saving" | "saved";

/**
 * Why a generation didn't come from the model, in words the user can act on.
 * Rule 9 says AI never hard-blocks — but "never blocks" is not the same as
 * "never tell them". A cap they can wait out and a model that returned junk are
 * different situations, and flattening both into a silent template swap would
 * make the app quietly less honest than it claims to be.
 */
function fallbackNote(reason: string | null | undefined): string {
  switch (reason) {
    case "cap":
      return "Daily AI cap reached — this is the study template. Resets at midnight UTC.";
    case "provider":
      return "The model is unreachable right now — this is the study template.";
    case "invalid":
      return "The model returned something unusable twice — this is the study template.";
    case "disabled":
      return "AI isn't configured — this is the study template.";
    default:
      return "This is the study template.";
  }
}

export default function TopicStudy({
  roadmapId,
  topicId,
  topicName,
  status,
  weekLabel,
  killCriterion,
  detail: initialDetail,
  initialNote,
}: {
  roadmapId: string;
  topicId: string;
  topicName: string;
  status: TopicStatus;
  weekLabel: string;
  killCriterion: string;
  detail: TopicDetail | null;
  initialNote: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [mastered, setMastered] = useState(status === "mastered");
  const [note, setNote] = useState(initialNote);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase 4: detail is generated on demand, so it's client state now — a fresh
  // topic starts null and fills in when the user asks for it.
  const [detail, setDetail] = useState<TopicDetail | null>(initialDetail);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailNote, setDetailNote] = useState<string | null>(null);
  const [cardsBusy, setCardsBusy] = useState(false);
  const [cardsNote, setCardsNote] = useState<string | null>(null);

  // Reasoning tier — mental model, resources, exercises.
  async function generateDetail() {
    if (detailBusy) return;
    setDetailBusy(true);
    setDetailNote(null);
    try {
      const res = await fetch(`/api/topics/${topicId}/detail`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setDetailNote(data?.error ?? "Could not generate this topic.");
        return;
      }
      setDetail(data.detail);
      setDetailNote(data.source === "ai" ? null : fallbackNote(data.reason));
    } catch {
      setDetailNote("Network error — nothing was generated.");
    } finally {
      setDetailBusy(false);
    }
  }

  // Classification tier — the cheap model, because this call happens per topic
  // across every roadmap while detail generation happens once.
  async function generateCards() {
    if (cardsBusy) return;
    setCardsBusy(true);
    setCardsNote(null);
    try {
      const res = await fetch("/api/recall/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCardsNote(data?.error ?? "Could not generate cards.");
        return;
      }
      const suffix = data.source === "ai" ? "" : ` (${fallbackNote(data.reason).toLowerCase()})`;
      setCardsNote(
        data.created === 0
          ? `No new cards — this topic already has every question we'd add${suffix}`
          : `Added ${data.created} card${data.created === 1 ? "" : "s"} to your recall queue${suffix}`
      );
      router.refresh(); // the sidebar due-count badge recomputes from real rows
    } catch {
      setCardsNote("Network error — no cards were added.");
    } finally {
      setCardsBusy(false);
    }
  }

  // Kill-criterion checkbox → mastery (Rule 16: mastery is earned, only via this
  // explicit check; unchecking reverts to in_progress — it was clearly started).
  async function toggleMastery() {
    const next = !mastered;
    setMastered(next);
    const newStatus: TopicStatus = next ? "mastered" : "in_progress";
    const { error } = await supabase
      .from("topics")
      .update({ status: newStatus, mastered_at: next ? new Date().toISOString() : null })
      .eq("id", topicId);
    if (error) {
      setMastered(!next); // revert optimistic flip on failure
      return;
    }
    router.refresh(); // roadmap/library counts recompute from real data
  }

  // Autosave notes, debounced. First keystroke also flips a not_started topic to
  // in_progress (studying it counts as starting — but never to mastered; Rule 16).
  const persistNote = useCallback(
    async (body: string) => {
      setSaveState("saving");
      const { error } = await supabase
        .from("notes")
        .upsert({ topic_id: topicId, body }, { onConflict: "topic_id" });
      if (!error && !mastered && status === "not_started") {
        await supabase.from("topics").update({ status: "in_progress" }).eq("id", topicId);
      }
      setSaveState(error ? "idle" : "saved");
    },
    [supabase, topicId, mastered, status]
  );

  function onNoteChange(v: string) {
    setNote(v);
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistNote(v), 700);
  }

  // Flush any pending save on unmount so a fast navigation doesn't drop the last edit.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const resources = detail?.resources ?? [];
  const exercises = detail?.exercises ?? [];

  return (
    <div>
      <button
        onClick={() => router.push(`/roadmap/${roadmapId}`)}
        style={{
          border: "none",
          background: "none",
          color: "var(--text-muted)",
          fontSize: "12.5px",
          cursor: "pointer",
          marginBottom: "16px",
          fontFamily: MONO,
        }}
      >
        ← Roadmap
      </button>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "26px", alignItems: "start" }}>
        {/* Left column: model + resources + exercises */}
        <div>
          <div style={{ marginBottom: "20px" }}>
            <div style={{ fontFamily: MONO, fontSize: "12px", color: "var(--text-faint)", marginBottom: "4px" }}>
              {weekLabel}
            </div>
            <div style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "-0.015em" }}>{topicName}</div>
          </div>

          {/* No detail yet — the explicit-generation empty state (Phase 4).
              A generated roadmap ships topics with no content on purpose, so
              nothing spends an AI call until the user asks for one. */}
          {!detail && (
            <div
              data-testid="detail-empty"
              style={{
                border: "1px dashed var(--border)",
                borderRadius: "12px",
                padding: "36px 28px",
                marginBottom: "24px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "15px", fontWeight: 600, marginBottom: "6px" }}>
                No study material yet
              </div>
              <div
                style={{
                  fontSize: "13.5px",
                  color: "var(--text-muted)",
                  lineHeight: 1.6,
                  marginBottom: "18px",
                  maxWidth: "460px",
                  margin: "0 auto 18px",
                }}
              >
                Generate the mental model, ranked resources and from-scratch exercises for{" "}
                <b>{topicName}</b>. One AI call, and it&apos;s saved to this topic.
              </div>
              <button
                onClick={generateDetail}
                disabled={detailBusy}
                data-testid="generate-detail"
                style={{
                  padding: "10px 18px",
                  borderRadius: "9px",
                  border: "1px solid var(--accent)",
                  background: detailBusy ? "var(--accent-soft)" : "var(--accent)",
                  color: detailBusy ? "var(--accent)" : "oklch(0.99 0 0)",
                  fontSize: "13.5px",
                  fontWeight: 600,
                  font: "inherit",
                  cursor: detailBusy ? "wait" : "pointer",
                }}
              >
                {detailBusy ? "Generating…" : "Generate with AI"}
              </button>
              {detailNote && (
                <div
                  data-testid="detail-note"
                  style={{ fontSize: "12.5px", color: "var(--amber)", marginTop: "12px" }}
                >
                  {detailNote}
                </div>
              )}
            </div>
          )}

          {/* Mental model */}
          {detail && (
            <div
              style={{
                background: "var(--accent-soft)",
                border: "1px solid var(--accent-line)",
                borderRadius: "12px",
                padding: "18px 20px",
                marginBottom: "24px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: "12px",
                  marginBottom: "8px",
                }}
              >
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: "11px",
                    color: "var(--accent)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Mental model
                </div>
                {/* Where this content came from. Shown, not hidden — a template
                    standing in for a failed generation is information the user
                    is entitled to. */}
                <span
                  data-testid="detail-source"
                  style={{ fontFamily: MONO, fontSize: "10.5px", color: "var(--text-faint)" }}
                >
                  {sourceLabel(detail.source)}
                </span>
              </div>
              <div style={{ fontSize: "14.5px", lineHeight: 1.6 }}>{detail.model}</div>
              {detailNote && (
                <div data-testid="detail-note" style={{ fontSize: "12.5px", color: "var(--amber)", marginTop: "10px" }}>
                  {detailNote}
                </div>
              )}
            </div>
          )}

          {/* Resources */}
          {detail && (
          <div style={{ marginBottom: "24px" }}>
            <SectionLabel>Resources · ranked</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {resources.map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: "14px",
                    alignItems: "center",
                    background: "var(--panel)",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "12px 16px",
                  }}
                >
                  <div style={{ fontFamily: MONO, fontSize: "15px", fontWeight: 600, color: "var(--accent)", flex: "0 0 auto" }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* A url is present only on corpus-retrieved resources, so
                        "is a link" and "was vetted" are the same condition —
                        the grounded generator is never asked for a URL, so a
                        model-recalled one can't reach this branch. */}
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: "14px", fontWeight: 500, color: "var(--accent)" }}
                      >
                        {r.title}
                      </a>
                    ) : (
                      <div style={{ fontSize: "14px", fontWeight: 500 }}>{r.title}</div>
                    )}
                    <div style={{ fontSize: "12px", color: "var(--text-faint)", fontFamily: MONO }}>{r.meta}</div>
                  </div>

                  {/* The positive case, stated rather than implied. Without it a
                      user cannot tell a vetted corpus link from a link a model
                      happened to produce — and the whole point of Phase 4.5 is
                      that those are different things. */}
                  {r.url && !r.unverified && (
                    <span
                      data-testid="verified-chip"
                      title="Retrieved from Prep's hand-curated corpus. The model ranked it; it did not invent it."
                      style={{
                        fontFamily: MONO,
                        fontSize: "10.5px",
                        color: "var(--green)",
                        background: "var(--green-soft)",
                        border: "1px solid var(--green)",
                        borderRadius: "5px",
                        padding: "2px 7px",
                        flex: "0 0 auto",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}
                    >
                      Verified
                    </span>
                  )}

                  {/* Generated resources are model-recalled and nothing here can
                      check them — the corpus had no match for this topic. */}
                  {r.unverified && (
                    <span
                      data-testid="unverified-chip"
                      title="Generated from the model's memory — no vetted source in the corpus matched this topic, so nothing has checked it."
                      style={{
                        fontFamily: MONO,
                        fontSize: "10.5px",
                        color: "var(--amber)",
                        background: "var(--amber-soft)",
                        border: "1px solid var(--amber)",
                        borderRadius: "5px",
                        padding: "2px 7px",
                        flex: "0 0 auto",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}
                    >
                      Unverified
                    </span>
                  )}
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: "10.5px",
                      color: tagColor(r.tag),
                      border: "1px solid var(--border)",
                      borderRadius: "5px",
                      padding: "2px 7px",
                      flex: "0 0 auto",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {r.tag}
                  </span>
                </div>
              ))}
            </div>
          </div>
          )}

          {/* Exercises */}
          {detail && (
          <div style={{ marginBottom: "24px" }}>
            <SectionLabel>From scratch</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {exercises.map((ex, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: "12px",
                    background: "var(--panel)",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "14px 16px",
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="var(--text-faint)"
                    strokeWidth={1.5}
                    style={{ marginTop: "2px", flex: "0 0 auto" }}
                  >
                    <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
                  </svg>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "2px" }}>{ex.title}</div>
                    <div style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.5 }}>{ex.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}

          {/* Notes (autosave) */}
          <div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "12px" }}>
              <SectionLabel noMargin>Your notes</SectionLabel>
              <span style={{ fontFamily: MONO, fontSize: "11px", color: "var(--text-faint)" }}>
                {saveState === "saving" ? "saving…" : saveState === "saved" ? "saved" : ""}
              </span>
            </div>
            <textarea
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="What clicked, what didn't, the one-liner you'd say in the interview…"
              rows={6}
              style={{
                width: "100%",
                resize: "vertical",
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "14px 16px",
                color: "var(--text)",
                font: "inherit",
                fontSize: "14px",
                lineHeight: 1.6,
                outline: "none",
              }}
            />
          </div>
        </div>

        {/* Right column: sticky kill-criterion / mastery card */}
        <div style={{ position: "sticky", top: 0, display: "flex", flexDirection: "column", gap: "14px" }}>
          <div
            style={{
              background: mastered ? "var(--green-soft)" : "var(--panel)",
              border: "1px solid " + (mastered ? "var(--green)" : "var(--border)"),
              borderRadius: "12px",
              padding: "18px",
              transition: "background 0.2s ease, border-color 0.2s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
              <button
                onClick={toggleMastery}
                aria-pressed={mastered}
                style={{
                  width: "28px",
                  height: "28px",
                  flex: "0 0 auto",
                  borderRadius: "8px",
                  cursor: "pointer",
                  border: "1px solid " + (mastered ? "var(--green)" : "var(--border-strong)"),
                  background: mastered ? "var(--green)" : "transparent",
                  color: "oklch(0.99 0 0)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                }}
              >
                {mastered && (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2}>
                    <path d="M3.5 8.5l3 3 6-6.5" />
                  </svg>
                )}
              </button>
              <div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: "11px",
                    color: "var(--red)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: "6px",
                  }}
                >
                  Kill criterion
                </div>
                <div style={{ fontSize: "13.5px", lineHeight: 1.55 }}>{killCriterion}</div>
              </div>
            </div>
            <div
              style={{
                marginTop: "14px",
                fontFamily: MONO,
                fontSize: "11.5px",
                color: mastered ? "var(--green)" : "var(--text-faint)",
              }}
            >
              {mastered ? "Mastered — you can defend this." : "Check only when you can do it cold, no notes."}
            </div>
          </div>

          {/* AI actions (Phase 4). Two buttons, two tiers, on purpose: study
              material runs on the reasoning tier (rare, high-value) and recall
              cards on the classification tier (frequent, cheap). Keeping them
              separate is also what keeps each press to exactly one call. */}
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: "12px",
              padding: "16px 18px",
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                fontSize: "11px",
                color: "var(--text-faint)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: "10px",
              }}
            >
              Generate
            </div>

            {detail && (
              <button
                onClick={generateDetail}
                disabled={detailBusy}
                data-testid="regenerate-detail"
                style={secondaryButton(detailBusy)}
              >
                {detailBusy ? "Generating…" : "Regenerate study material"}
              </button>
            )}

            <button
              onClick={generateCards}
              disabled={cardsBusy}
              data-testid="generate-cards"
              style={{ ...secondaryButton(cardsBusy), marginTop: detail ? "8px" : 0 }}
            >
              {cardsBusy ? "Generating…" : "Generate recall cards"}
            </button>

            {cardsNote && (
              <div
                data-testid="cards-note"
                style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "10px", lineHeight: 1.5 }}
              >
                {cardsNote}
              </div>
            )}

            <div style={{ fontSize: "11.5px", color: "var(--text-faint)", marginTop: "10px", lineHeight: 1.5 }}>
              Each press spends one call from your daily cap.{" "}
              <Link href="/usage" style={{ color: "var(--accent)" }}>
                See usage
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children, noMargin }: { children: React.ReactNode; noMargin?: boolean }) {
  return (
    <div
      style={{
        fontSize: "13px",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "var(--text-muted)",
        marginBottom: noMargin ? 0 : "12px",
        fontFamily: MONO,
      }}
    >
      {children}
    </div>
  );
}
