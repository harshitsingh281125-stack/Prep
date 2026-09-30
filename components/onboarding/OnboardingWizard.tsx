"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ONBOARDING_STEPS, NOT_SURE, weakAreasForRole } from "@/lib/seed/catalog";
import type { OnboardingAnswers } from "@/lib/seed/types";

const EMPTY: OnboardingAnswers = { role: "", bar: "", timeline: "", hours: "", weak: [] };

// The 5-question onboarding wizard (design: onboardingVals). Single-select
// questions auto-advance; the last (weak areas) is multi-select and gates the
// "Generate roadmap" CTA. A live preview mirrors the answers. On generate we POST
// to /api/roadmaps/generate (seed generator now, AI in Phase 4) and route to the
// new roadmap.
export default function OnboardingWizard({
  atLimit,
  maxRoadmaps,
}: {
  atLimit: boolean;
  maxRoadmaps: number;
}) {
  const router = useRouter();
  const steps = ONBOARDING_STEPS;

  const [idx, setIdx] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswers>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = steps[idx];
  const isLast = idx === steps.length - 1;
  const canGenerate = answers.weak.length > 0;

  // The weak-area options follow the role answered in step 1; every other step's
  // options are fixed. Resolved at render so going back and changing the role
  // immediately re-offers the right list.
  const currentOptions =
    current.id === "weak" ? weakAreasForRole(answers.role) : current.options;

  function jumpStep(i: number) {
    if (i <= maxStep) setIdx(i);
  }

  function choose(value: string) {
    if (current.multi) {
      setAnswers((a) => {
        // "Not sure" is mutually exclusive with everything else: "I don't know
        // where I'm weak, and also React internals" isn't a coherent answer.
        if (value === NOT_SURE) {
          return { ...a, weak: a.weak.includes(NOT_SURE) ? [] : [NOT_SURE] };
        }
        const without = a.weak.filter((x) => x !== NOT_SURE);
        const arr = without.includes(value)
          ? without.filter((x) => x !== value)
          : [...without, value];
        return { ...a, weak: arr };
      });
    } else {
      setAnswers((a) => {
        // Changing the ROLE changes which weak areas exist, so previously-picked
        // ones may no longer be valid options. Clear them rather than carry a
        // stale selection the server would then reject with a confusing
        // "Pick at least one weak area."
        const roleChanged = current.id === "role" && a.role !== value;
        return { ...a, [current.id]: value, ...(roleChanged ? { weak: [] } : {}) };
      });
      const next = Math.min(idx + 1, steps.length - 1);
      setIdx(next);
      setMaxStep((m) => Math.max(m, next));
    }
  }

  async function generate() {
    if (!canGenerate || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/roadmaps/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answers),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Could not generate the roadmap.");
        setSubmitting(false);
        return;
      }
      router.push(`/roadmap/${data.id}`);
    } catch {
      setError("Network error. Try again.");
      setSubmitting(false);
    }
  }

  const answeredSteps = steps.slice(0, idx);

  const previewRows = useMemo(
    () => [
      { label: "Role", value: answers.role || "Frontend", filled: !!answers.role },
      { label: "Bar", value: answers.bar || "—", filled: !!answers.bar },
      { label: "Timeline", value: answers.timeline || "—", filled: !!answers.timeline },
      { label: "Hours / week", value: answers.hours || "—", filled: !!answers.hours },
      {
        label: "Focus",
        value: answers.weak.length ? `${answers.weak.length} area${answers.weak.length === 1 ? "" : "s"}` : "—",
        filled: answers.weak.length > 0,
      },
    ],
    [answers]
  );

  if (atLimit) return <LockedState maxRoadmaps={maxRoadmaps} onLibrary={() => router.push("/library")} />;

  return (
    <div className="grid-side" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 280px", gap: "56px", alignItems: "start" }}>
      {/* Left: the wizard */}
      <div>
        {/* Progress dots */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "32px" }}>
          {steps.map((_, i) => {
            const clickable = i <= maxStep;
            return (
              <div
                key={i}
                onClick={() => clickable && jumpStep(i)}
                style={{
                  flex: 1,
                  height: "3px",
                  borderRadius: "2px",
                  cursor: clickable ? "pointer" : "default",
                  background: i <= idx ? "var(--ink)" : "var(--border)",
                  opacity: i === idx ? 0.45 : 1,
                }}
              />
            );
          })}
        </div>

        {/* Answered-so-far summary (editable) */}
        {answeredSteps.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border)", marginBottom: "36px" }}>
            {answeredSteps.map((st, i) => {
              const val = Array.isArray(answers[st.id])
                ? (answers[st.id] as string[]).join(", ") || "—"
                : (answers[st.id] as string) || "—";
              return (
                <div
                  key={st.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    borderBottom: "1px solid var(--border)",
                    padding: "12px 0",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "12.5px", color: "var(--text-faint)" }}>{st.q}</div>
                    <div style={{ fontSize: "14.5px", fontWeight: 500, marginTop: "2px" }}>{val}</div>
                  </div>
                  <button
                    onClick={() => jumpStep(i)}
                    className="nav-link"
                    style={{
                      border: "none",
                      background: "none",
                      color: "var(--text-faint)",
                      font: "inherit",
                      fontSize: "13px",
                      cursor: "pointer",
                    }}
                  >
                    Edit
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Current question */}
        <div style={{ fontSize: "13px", color: "var(--text-faint)", marginBottom: "10px" }}>
          Question {idx + 1} of {steps.length}
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "28px",
            fontWeight: 500,
            letterSpacing: "-0.015em",
            lineHeight: 1.2,
            marginBottom: current.hint ? "10px" : "22px",
          }}
        >
          {current.q}
        </div>
        {/* Sets expectations about what the answer actually controls — see the
            weak-areas note in lib/seed/catalog.ts. */}
        {current.hint && (
          <div style={{ fontSize: "14px", color: "var(--text-muted)", marginBottom: "22px", lineHeight: 1.55, maxWidth: "60ch" }}>
            {current.hint}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {currentOptions.map((label) => {
            const selected = current.multi
              ? answers.weak.includes(label)
              : (answers[current.id] as string) === label;
            return (
              <button
                key={label}
                onClick={() => choose(label)}
                style={{
                  padding: "9px 16px",
                  borderRadius: "999px",
                  cursor: "pointer",
                  font: "inherit",
                  fontSize: "14px",
                  fontWeight: 500,
                  border: "1px solid " + (selected ? "var(--ink)" : "var(--border-strong)"),
                  background: selected ? "var(--ink)" : "transparent",
                  color: selected ? "var(--on-ink)" : "var(--text)",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* CTA — only on the last (weak areas) step */}
        {isLast && (
          <>
            <button
              onClick={generate}
              disabled={!canGenerate || submitting}
              style={{
                marginTop: "32px",
                padding: "11px 22px",
                borderRadius: "8px",
                font: "inherit",
                fontSize: "14px",
                fontWeight: 600,
                cursor: canGenerate && !submitting ? "pointer" : "not-allowed",
                border: "1px solid " + (canGenerate ? "var(--ink)" : "var(--border)"),
                background: canGenerate ? "var(--ink)" : "transparent",
                color: canGenerate ? "var(--on-ink)" : "var(--text-faint)",
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting
                ? "Building your roadmap…"
                : canGenerate
                ? "Generate roadmap →"
                : "Pick at least one weak area"}
            </button>
            {error && (
              <div style={{ marginTop: "10px", fontSize: "13px", color: "var(--red)" }}>{error}</div>
            )}
            {/* Generation takes a few seconds, and the roadmap route it lands on
                has no loading.tsx (it can 404), so this placeholder stays up
                through the call AND the navigation — `submitting` is only reset
                on failure. */}
            {submitting && <RoadmapDraftSkeleton />}
          </>
        )}
      </div>

      {/* Right: live preview */}
      <div
        style={{
          position: "sticky",
          top: "24px",
          background: "var(--bg-sunken)",
          borderRadius: "12px",
          padding: "20px",
        }}
      >
        <div style={{ fontFamily: "var(--font-serif)", fontSize: "19px", marginBottom: "10px" }}>Your plan, live</div>
        {previewRows.map((r) => (
          <div
            key={r.label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "12px",
              padding: "9px 0",
              borderBottom: "1px solid var(--border)",
              fontSize: "13px",
            }}
          >
            <span style={{ color: "var(--text-faint)" }}>{r.label}</span>
            <span
              style={{
                fontWeight: 500,
                color: r.filled ? "var(--text)" : "var(--text-faint)",
                textAlign: "right",
              }}
            >
              {r.value}
            </span>
          </div>
        ))}
        <div style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.55, marginTop: "14px" }}>
          {planPhrase(answers.timeline)}, ~3 topics per week, front-loaded on your weak areas.
          Every week ships with a kill criterion — no &ldquo;mastered&rdquo; without proof.
        </div>
      </div>
    </div>
  );
}

/** "5 weeks" → "A 5-week plan", "4 months" → "A 4-month plan", "No date yet" → "An open-ended plan". */
function planPhrase(timeline: string): string {
  if (!timeline) return "A 5-week plan";
  const m = timeline.match(/^(\d+) (week|month)s?$/);
  return m ? `A ${m[1]}-${m[2]} plan` : "An open-ended plan";
}

function RoadmapDraftSkeleton() {
  return (
    <div data-testid="roadmap-generating" aria-busy="true" style={{ marginTop: "36px" }}>
      <div role="status" style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "14px" }}>
        Drafting weeks, topics and a kill criterion for each week — usually 5–20 seconds.
      </div>
      <div style={{ borderTop: "1px solid var(--border)" }}>
        {["46%", "38%", "52%"].map((w, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", gap: "16px", padding: "18px 0", borderBottom: "1px solid var(--border)" }}
          >
            <span style={{ fontSize: "13px", color: "var(--text-faint)", flex: "0 0 58px" }}>Week {i + 1}</span>
            <div className="skel" style={{ width: w, height: "18px" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function LockedState({ maxRoadmaps, onLibrary }: { maxRoadmaps: number; onLibrary: () => void }) {
  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        padding: "48px 0",
        maxWidth: "56ch",
      }}
    >
      <div style={{ fontFamily: "var(--font-serif)", fontSize: "24px" }}>You&rsquo;ve used all {maxRoadmaps} roadmap creations.</div>
      <div style={{ color: "var(--text-muted)", marginTop: "8px", fontSize: "15px", lineHeight: 1.6 }}>
        The free plan caps you at {maxRoadmaps}. Delete one from your library to make room for a new plan.
      </div>
      <button
        onClick={onLibrary}
        style={{
          marginTop: "24px",
          padding: "10px 18px",
          borderRadius: "8px",
          border: "1px solid var(--border-strong)",
          background: "transparent",
          color: "var(--text)",
          font: "inherit",
          fontSize: "14px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Back to library
      </button>
    </div>
  );
}
