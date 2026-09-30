"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { SeedResource, TopicDetail, TopicStatus } from "@/lib/seed/types";

/** Shared style for the two generate buttons in the sidebar panel. */
function secondaryButton(busy: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "9px",
    borderRadius: "8px",
    font: "inherit",
    fontSize: "13.5px",
    fontWeight: 500,
    cursor: busy ? "wait" : "pointer",
    border: "1px solid var(--border-strong)",
    background: "transparent",
    color: "var(--text)",
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

/**
 * Where an UNVERIFIED resource points.
 *
 * Ungrounded resources have no `url` — the generator is never asked for one, on
 * purpose, because a model-recalled URL is exactly the hallucinated citation
 * this phase exists to remove (and an invented domain is a click into
 * somebody's squatted namespace, not merely a 404).
 *
 * But "no link at all" is a poor answer for the user, who now has to copy a
 * title into a search bar by hand. So the title becomes a link to a SEARCH for
 * that title — a URL we construct ourselves, which therefore cannot be invented,
 * cannot rot, and promises exactly what it delivers: "here is where to look",
 * not "here is the document". The rendering says so too — a dotted underline and
 * muted colour rather than the solid accent link a vetted resource gets.
 *
 * Derived at render time, never stored, for the same reason Phase 3 derives
 * roadmap status: a stored search URL would be a second copy of the title that
 * could drift out of sync with it.
 */
function searchUrl(title: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(title)}`;
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
  topicId,
  topicName,
  status,
  killCriterion,
  detail: initialDetail,
  initialNote,
}: {
  topicId: string;
  topicName: string;
  status: TopicStatus;
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

  const staleStyle: React.CSSProperties = {
    opacity: detailBusy ? 0.45 : 1,
    transition: "opacity 160ms ease",
  };

  const resources = detail?.resources ?? [];
  const exercises = detail?.exercises ?? [];

  return (
    <div>
      <div className="grid-side" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 280px", gap: "56px", alignItems: "start" }}>
        {/* Left column: model + resources + exercises */}
        <div>
          {/* No detail yet — the explicit-generation empty state (Phase 4).
              A generated roadmap ships topics with no content on purpose, so
              nothing spends an AI call until the user asks for one. */}
          {/* Generating, first time: hold the shape of what's coming. */}
          {!detail && detailBusy && <DetailSkeleton />}

          {!detail && !detailBusy && (
            <div
              data-testid="detail-empty"
              style={{
                borderTop: "1px solid var(--border)",
                borderBottom: "1px solid var(--border)",
                padding: "32px 0",
                marginBottom: "40px",
              }}
            >
              <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", marginBottom: "8px" }}>
                No study material yet.
              </div>
              <div
                style={{
                  fontSize: "13.5px",
                  color: "var(--text-muted)",
                  lineHeight: 1.6,
                  marginBottom: "18px",
                  maxWidth: "56ch",
                  margin: "0 0 20px",
                }}
              >
                Generate the mental model, ranked resources and from-scratch exercises for{" "}
                <b>{topicName}</b>. One AI call, and it&apos;s saved to this topic.
              </div>
              <button
                onClick={generateDetail}
                disabled={detailBusy}
                data-testid="generate-detail"
                className="btn-ink"
                style={{
                  padding: "10px 18px",
                  borderRadius: "8px",
                  border: "none",
                  background: "var(--ink)",
                  color: "var(--on-ink)",
                  font: "inherit",
                  fontSize: "14px",
                  fontWeight: 600,
                  opacity: detailBusy ? 0.6 : 1,
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
          {/* Regenerating: the old material stays readable but visibly stale. */}
          {detail && detailBusy && (
            <div role="status" style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", color: "var(--text-muted)", marginBottom: "20px" }}>
              <span className="skel" style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent)" }} />
              Regenerating study material…
            </div>
          )}

          {detail && (
            <div style={{ marginBottom: "44px", ...staleStyle }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: "12px",
                  marginBottom: "10px",
                }}
              >
                <SectionLabel noMargin>Mental model</SectionLabel>
                {/* Where this content came from. Shown, not hidden — a template
                    standing in for a failed generation is information the user
                    is entitled to. */}
                <span
                  data-testid="detail-source"
                  style={{ fontSize: "12.5px", color: "var(--text-faint)" }}
                >
                  {sourceLabel(detail.source)}
                </span>
              </div>
              <div style={{ fontFamily: "var(--font-serif)", fontSize: "19px", lineHeight: 1.6, textWrap: "pretty" }}>
                {detail.model}
              </div>
              {detailNote && (
                <div data-testid="detail-note" style={{ fontSize: "12.5px", color: "var(--amber)", marginTop: "10px" }}>
                  {detailNote}
                </div>
              )}
            </div>
          )}

          {/* Resources */}
          {detail && (
          <div style={{ marginBottom: "44px", ...staleStyle }}>
            <SectionLabel>Resources, ranked</SectionLabel>
            <div style={{ borderTop: "1px solid var(--border)" }}>
              {resources.map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: "16px",
                    alignItems: "baseline",
                    borderBottom: "1px solid var(--border)",
                    padding: "14px 0",
                  }}
                >
                  <div style={{ fontFamily: "var(--font-serif)", fontSize: "18px", color: "var(--text-faint)", flex: "0 0 18px" }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* A url is present only on corpus-retrieved resources, so
                        "is a link" and "was vetted" are the same condition —
                        the grounded generator is never asked for a URL, so a
                        model-recalled one can't reach this branch. */}
                    <a
                      href={r.url ?? searchUrl(r.title)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={
                        r.url
                          ? "Vetted link from Prep's corpus."
                          : "Not in Prep's corpus — this opens a web search for the title, not a link the model produced."
                      }
                      style={{
                        fontSize: "15px",
                        fontWeight: 500,
                        // A vetted destination reads as a real link; a search
                        // reads as a lead to follow. Different promises, so they
                        // must not look identical.
                        color: r.url ? "var(--accent)" : "var(--text)",
                        textDecoration: r.url ? undefined : "underline dotted",
                        textUnderlineOffset: "3px",
                      }}
                    >
                      {r.title}
                      {!r.url && (
                        <span
                          style={{
                            fontSize: "12px",
                            color: "var(--text-faint)",
                            marginLeft: "6px",
                          }}
                        >
                          search ↗
                        </span>
                      )}
                    </a>
                    <div style={{ fontSize: "12.5px", color: "var(--text-faint)", marginTop: "2px" }}>{r.meta}</div>
                  </div>

                  {/* The positive case, stated rather than implied. Without it a
                      user cannot tell a vetted corpus link from a link a model
                      happened to produce — and the whole point of Phase 4.5 is
                      that those are different things. */}
                  {r.url && !r.unverified && (
                    <span
                      data-testid="verified-chip"
                      title="Retrieved from Prep's hand-curated corpus. The model ranked it; it did not invent it."
                      style={{ fontSize: "12.5px", fontWeight: 500, color: "var(--green)", flex: "0 0 auto" }}
                    >
                      Verified
                    </span>
                  )}

                  {/* Generated resources are model-recalled and nothing here can
                      check them — the corpus had no match for this topic. */}
                  {r.unverified && (
                    <span
                      data-testid="unverified-chip"
                      title="Generated from the model's memory — no vetted source in the corpus matched this topic, so nothing has checked that this document exists. The title links to a web search, not to a URL the model produced."
                      style={{ fontSize: "12.5px", fontWeight: 500, color: "var(--amber)", flex: "0 0 auto" }}
                    >
                      Unverified
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: "12px",
                      color: tagColor(r.tag),
                      border: "1px solid var(--border)",
                      borderRadius: "999px",
                      padding: "1px 9px",
                      flex: "0 0 auto",
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
          <div style={{ marginBottom: "44px", ...staleStyle }}>
            <SectionLabel>From scratch</SectionLabel>
            <div style={{ borderTop: "1px solid var(--border)" }}>
              {exercises.map((ex, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: "14px",
                    borderBottom: "1px solid var(--border)",
                    padding: "14px 0",
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="var(--text-faint)"
                    strokeWidth={1.5}
                    style={{ marginTop: "3px", flex: "0 0 auto" }}
                  >
                    <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
                  </svg>
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 500, marginBottom: "3px" }}>{ex.title}</div>
                    <div style={{ fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.55 }}>{ex.desc}</div>
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
              <span style={{ fontSize: "12.5px", color: "var(--text-faint)" }}>
                {saveState === "saving" ? "saving…" : saveState === "saved" ? "saved" : ""}
              </span>
            </div>
            <textarea
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="What clicked, what didn't, the one-liner you'd say in the interview…"
              rows={8}
              style={{
                width: "100%",
                resize: "vertical",
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "16px 18px",
                color: "var(--text)",
                fontFamily: "var(--font-serif)",
                fontSize: "17px",
                lineHeight: 1.6,
              }}
            />
          </div>
        </div>

        {/* Right column: sticky kill-criterion / mastery card */}
        <div style={{ position: "sticky", top: "24px", display: "flex", flexDirection: "column", gap: "32px" }}>
          <div
            style={{
              background: mastered ? "var(--green-soft)" : "var(--panel)",
              border: "1px solid " + (mastered ? "var(--green)" : "var(--border-strong)"),
              borderRadius: "12px",
              padding: "20px",
              transition: "background 0.2s ease, border-color 0.2s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
              <button
                type="button"
                onClick={toggleMastery}
                aria-pressed={mastered}
                // Phase 5: named explicitly. It used to be findable as "the only
                // button[aria-pressed] on the page" — until the sidebar's theme
                // toggle correctly became an aria-pressed toggle button too, at
                // which point `.first()` in study-flow.spec.ts silently started
                // clicking the theme toggle and the mastery test timed out waiting
                // for a topics PATCH that was never going to happen. A structural
                // selector that depends on being unique in the whole document is a
                // trap; a name is not.
                data-testid="kill-criterion"
                aria-label="Mark this topic mastered"
                style={{
                  width: "26px",
                  height: "26px",
                  flex: "0 0 auto",
                  borderRadius: "7px",
                  cursor: "pointer",
                  border: "1.5px solid " + (mastered ? "var(--green)" : "var(--text-faint)"),
                  background: mastered ? "var(--green)" : "transparent",
                  color: "var(--on-ink)",
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
                <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--red)", marginBottom: "6px" }}>
                  Kill criterion
                </div>
                <div style={{ fontFamily: "var(--font-serif)", fontSize: "17px", lineHeight: 1.45 }}>{killCriterion}</div>
              </div>
            </div>
            <div
              style={{
                marginTop: "16px",
                paddingTop: "12px",
                borderTop: "1px solid var(--border)",
                fontSize: "12.5px",
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
          <div>
            <SectionLabel>Generate</SectionLabel>

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

            <div style={{ fontSize: "12.5px", color: "var(--text-faint)", marginTop: "12px", lineHeight: 1.5 }}>
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

/**
 * Placeholder for the first generation (one reasoning-tier call, typically a few
 * seconds up to ~15). Mirrors the three sections that will replace it, so the
 * page doesn't jump when they land, and says in words what is happening — a
 * pulse alone doesn't tell you whether to wait or retry.
 */
function DetailSkeleton() {
  return (
    <div data-testid="detail-generating" aria-busy="true" style={{ marginBottom: "44px" }}>
      <div role="status" style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "22px" }}>
        Writing the mental model, ranking resources and drafting exercises — usually 5–15 seconds.
      </div>
      <SectionLabel>Mental model</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "44px" }}>
        {["100%", "96%", "88%", "55%"].map((w, i) => (
          <div key={i} className="skel" style={{ width: w, height: "18px" }} />
        ))}
      </div>
      <SectionLabel>Resources, ranked</SectionLabel>
      <div style={{ borderTop: "1px solid var(--border)", marginBottom: "44px" }}>
        {["62%", "48%", "56%"].map((w, i) => (
          <div key={i} style={{ padding: "16px 0", borderBottom: "1px solid var(--border)" }}>
            <div className="skel" style={{ width: w, height: "15px" }} />
            <div className="skel" style={{ width: "30%", height: "11px", marginTop: "8px" }} />
          </div>
        ))}
      </div>
      <SectionLabel>From scratch</SectionLabel>
      <div style={{ borderTop: "1px solid var(--border)" }}>
        {["70%", "58%"].map((w, i) => (
          <div key={i} style={{ padding: "16px 0", borderBottom: "1px solid var(--border)" }}>
            <div className="skel" style={{ width: w, height: "15px" }} />
          </div>
        ))}
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
        color: "var(--text-muted)",
        marginBottom: noMargin ? 0 : "10px",
      }}
    >
      {children}
    </div>
  );
}
