import { describe, expect, it } from "vitest";
import { generateSeedRoadmap } from "@/lib/seed/generate";
import { CATALOG } from "@/lib/seed/catalog";
import type { OnboardingAnswers } from "@/lib/seed/types";

// Unit tests for the seed generator — the slice/reorder/pad logic behind the
// onboarding cases OB-08/09/10 in tests/phase-1-roadmaps.md. Pure function, so we
// test it directly instead of driving the whole UI (faster + not flaky).

const base: OnboardingAnswers = {
  role: "SDE-2 · Frontend",
  bar: "Big tech (FAANG-tier)",
  timeline: "5 weeks",
  hours: "12h",
  weak: [],
};

describe("generateSeedRoadmap", () => {
  // OB-08 — slice to timeline + front-load weak areas.
  it("front-loads weak areas and slices to the timeline (3 weeks)", () => {
    const r = generateSeedRoadmap({
      ...base,
      timeline: "3 weeks",
      weak: ["React internals", "Frontend system design"],
    });
    expect(r.weeksCount).toBe(3);
    expect(r.weeks).toHaveLength(3);
    expect(r.weeks[0].title).toBe("React Internals");
    expect(r.weeks[1].title).toBe("Frontend System Design");
    // Third week is the first non-weak catalog block in natural order.
    expect(r.weeks[2].title).toBe("Core JS & Async");
    // Week numbers are 1..3 in order.
    expect(r.weeks.map((w) => w.n)).toEqual([1, 2, 3]);
  });

  // OB-09 — pad longer-than-catalog timelines by cycling (never blank weeks).
  it("pads an 8-week timeline by cycling the ordered blocks", () => {
    const r = generateSeedRoadmap({ ...base, timeline: "8 weeks", hours: "20h", weak: ["Async JS"] });
    expect(r.weeksCount).toBe(8);
    expect(r.weeks).toHaveLength(8);
    // Every week has a real title + 3 topics — no blanks from padding.
    for (const w of r.weeks) {
      expect(w.title.length).toBeGreaterThan(0);
      expect(w.topics.length).toBeGreaterThan(0);
    }
    // W1 is the weak area; the block cycles, so W6 repeats W1's block (8 > 5 catalog).
    expect(r.weeks[0].title).toBe("Core JS & Async");
    expect(r.weeks[5].title).toBe(r.weeks[0].title);
    // hours_planned = weeks × per-week.
    expect(r.hoursPlanned).toBe(8 * 20);
  });

  // OB-10 — non-numeric answers fall back to sane defaults; no NaN.
  it("applies defaults for non-numeric timeline/hours (no NaN)", () => {
    const r = generateSeedRoadmap({
      ...base,
      timeline: "No date yet",
      hours: "As much as it takes",
      weak: ["Async JS"],
    });
    expect(r.weeksCount).toBe(5); // default timeline
    expect(r.hoursPlanned).toBe(5 * 12); // default 12h/week
    expect(Number.isNaN(r.hoursPlanned)).toBe(false);
  });

  it("with no weak areas, keeps natural catalog order", () => {
    const r = generateSeedRoadmap({ ...base, timeline: "5 weeks", weak: [] });
    expect(r.weeks.map((w) => w.title)).toEqual(CATALOG.map((b) => b.title));
  });

  // CHANGED IN PHASE 4. This used to assert every topic shipped with a filled-in
  // detail blob. Detail is now generated on demand from the Topic screen, so a
  // freshly created roadmap carries none — and that must hold for the SEED path
  // too, not just the AI path. If the fallback quietly re-added detail, a user
  // could tell which path built their roadmap by whether its topics arrived
  // pre-filled, and the fallback would stop being a drop-in.
  it("ships topics with no detail — generated on demand instead (Phase 4)", () => {
    const r = generateSeedRoadmap({ ...base, weak: ["React internals"] });
    for (const w of r.weeks) {
      for (const t of w.topics) {
        expect(t.detail).toBeNull();
        expect(t.name.length).toBeGreaterThan(0);
        expect(t.status).toBe("not_started");
      }
    }
  });

  it("clamps a degenerate timeline to at least 1 week", () => {
    // parseNum falls back to 5 when there's no number, but guard the clamp anyway.
    const r = generateSeedRoadmap({ ...base, timeline: "0 weeks", weak: ["Async JS"] });
    expect(r.weeksCount).toBeGreaterThanOrEqual(1);
  });
});
