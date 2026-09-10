"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ONBOARDING_STEPS, NOT_SURE, weakAreasForRole } from "@/lib/seed/catalog";
import type { OnboardingAnswers } from "@/lib/seed/types";

const MONO = "'IBM Plex Mono',monospace";

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
        value: answers.weak.length ? `${answers.weak.length} areas` : "—",
        filled: answers.weak.length > 0,
      },
    ],
    [answers]
  );

  if (atLimit) return <LockedState maxRoadmaps={maxRoadmaps} onLibrary={() => router.push("/library")} />;

  return (
    <div className="grid-side" style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "26px", alignItems: "start" }}>
      {/* Left: the wizard */}
      <div>
        {/* Progress dots */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "22px" }}>
          {steps.map((_, i) => {
            const clickable = i <= maxStep;
            return (
              <div
                key={i}
                onClick={() => clickable && jumpStep(i)}
                style={{
                  flex: 1,
                  height: "5px",
                  borderRadius: "3px",
                  cursor: clickable ? "pointer" : "default",
                  background:
                    i < idx ? "var(--accent)" : i === idx ? "var(--accent-line)" : "var(--border)",
                }}
              />
            );
          })}
        </div>

        {/* Answered-so-far summary (editable) */}
        {answeredSteps.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "20px" }}>
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
                    background: "var(--panel)",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "10px 14px",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: MONO, fontSize: "11px", color: "var(--text-faint)" }}>
                      0{i + 1} · {st.q}
                    </div>
                    <div style={{ fontSize: "13.5px", fontWeight: 500, marginTop: "2px" }}>{val}</div>
                  </div>
                  <button
                    onClick={() => jumpStep(i)}
                    style={{
                      border: "none",
                      background: "none",
                      color: "var(--text-faint)",
                      fontFamily: MONO,
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                  >
                    edit
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Current question */}
        <div style={{ fontFamily: MONO, fontSize: "12px", color: "var(--text-faint)", marginBottom: "8px" }}>
          Question {idx + 1} of {steps.length}
        </div>
        <div style={{ fontSize: "18px", fontWeight: 600, letterSpacing: "-0.01em", marginBottom: current.hint ? "6px" : "16px" }}>
          {current.q}
        </div>
        {/* Sets expectations about what the answer actually controls — see the
            weak-areas note in lib/seed/catalog.ts. */}
        {current.hint && (
          <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "16px", lineHeight: 1.5 }}>
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
                  padding: "9px 14px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  font: "inherit",
                  fontSize: "13.5px",
                  fontWeight: 500,
                  border: "1px solid " + (selected ? "var(--accent)" : "var(--border)"),
                  background: selected ? "var(--accent-soft)" : "var(--bg-elevated)",
                  color: selected ? "var(--accent)" : "var(--text)",
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
                marginTop: "20px",
                width: "100%",
                padding: "11px",
                borderRadius: "8px",
                font: "inherit",
                fontSize: "14px",
                fontWeight: 600,
                cursor: canGenerate && !submitting ? "pointer" : "not-allowed",
                border: "1px solid " + (canGenerate ? "var(--accent)" : "var(--border)"),
                background: canGenerate ? "var(--accent)" : "var(--bg-elevated)",
                color: canGenerate ? "oklch(0.99 0 0)" : "var(--text-faint)",
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
          </>
        )}
      </div>

      {/* Right: live preview */}
      <div
        style={{
          position: "sticky",
          top: 0,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "18px",
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: "11px",
            color: "var(--text-faint)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: "12px",
          }}
        >
          Your plan, live
        </div>
        {previewRows.map((r) => (
          <div
            key={r.label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "12px",
              padding: "8px 0",
              borderBottom: "1px solid var(--border)",
              fontSize: "12.5px",
            }}
          >
            <span style={{ color: "var(--text-faint)" }}>{r.label}</span>
            <span
              style={{
                fontWeight: 600,
                fontFamily: MONO,
                color: r.filled ? "var(--text)" : "var(--text-faint)",
                textAlign: "right",
              }}
            >
              {r.value}
            </span>
          </div>
        ))}
        <div style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.55, marginTop: "12px" }}>
          A {answers.timeline || "5-week"} plan, ~3 topics per week, front-loaded on your weak areas.
          Every week ships with a kill criterion — no &ldquo;mastered&rdquo; without proof.
        </div>
      </div>
    </div>
  );
}

function LockedState({ maxRoadmaps, onLibrary }: { maxRoadmaps: number; onLibrary: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        padding: "60px 24px",
        border: "1px dashed var(--border-strong)",
        borderRadius: "16px",
        background: "var(--bg-sunken)",
      }}
    >
      <div style={{ fontSize: "18px", fontWeight: 600 }}>You&rsquo;ve used all {maxRoadmaps} roadmap creations.</div>
      <div style={{ color: "var(--text-muted)", marginTop: "6px", maxWidth: "44ch" }}>
        The free plan caps you at {maxRoadmaps}. Delete one from your library to make room for a new plan.
      </div>
      <button
        onClick={onLibrary}
        style={{
          marginTop: "22px",
          padding: "11px 20px",
          borderRadius: "9px",
          border: "1px solid var(--border-strong)",
          background: "var(--bg-elevated)",
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
