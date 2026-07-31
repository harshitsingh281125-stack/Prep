"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { SeedResource, TopicDetail, TopicStatus } from "@/lib/seed/types";

const MONO = "'IBM Plex Mono',monospace";

// Chip color per resource tag (design's tagStyle): Deep/Spec = accent, Talk =
// amber, else muted.
function tagColor(tag: SeedResource["tag"]): string {
  if (tag === "Deep" || tag === "Spec") return "var(--accent)";
  if (tag === "Talk") return "var(--amber)";
  return "var(--text-muted)";
}

type SaveState = "idle" | "saving" | "saved";

export default function TopicStudy({
  roadmapId,
  topicId,
  topicName,
  status,
  weekLabel,
  killCriterion,
  detail,
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
  const model = detail?.model ?? "No mental model seeded for this topic yet.";

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

          {/* Mental model */}
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
                fontFamily: MONO,
                fontSize: "11px",
                color: "var(--accent)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: "8px",
              }}
            >
              Mental model
            </div>
            <div style={{ fontSize: "14.5px", lineHeight: 1.6 }}>{model}</div>
          </div>

          {/* Resources */}
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
                    <div style={{ fontSize: "14px", fontWeight: 500 }}>{r.title}</div>
                    <div style={{ fontSize: "12px", color: "var(--text-faint)", fontFamily: MONO }}>{r.meta}</div>
                  </div>
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

          {/* Exercises */}
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
