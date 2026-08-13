import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOURS_PER_WEEK,
  DEFAULT_WEEKS,
  MAX_WEEKS,
  parseHoursPerWeek,
  parseTimelineWeeks,
  planContract,
} from "@/lib/seed/answers";
import { generateSeedRoadmap } from "@/lib/seed/generate";
import { ONBOARDING_STEPS, NOT_SURE, declaredWeakAreas, weakAreasForRole } from "@/lib/seed/catalog";
import type { OnboardingAnswers } from "@/lib/seed/types";

// The onboarding answers → plan contract parsing. This is the code that decides
// how long a user's plan is, and every pace figure on the Progress screen divides
// by its output — so a wrong number here is silently wrong everywhere downstream.

describe("parseTimelineWeeks", () => {
  it("reads plain week answers", () => {
    expect(parseTimelineWeeks("3 weeks")).toBe(3);
    expect(parseTimelineWeeks("8 weeks")).toBe(8);
    expect(parseTimelineWeeks("12 weeks")).toBe(12);
  });

  // The bug this function exists to prevent: a first-integer-wins parser turns
  // "6 months" into a SIX WEEK plan, and the user is measured against it forever.
  it("converts months to weeks instead of reading the bare number", () => {
    expect(parseTimelineWeeks("4 months")).toBe(16);
    expect(parseTimelineWeeks("6 months")).toBe(24);
    expect(parseTimelineWeeks("1 month")).toBe(4);
  });

  it("is not fooled by singular/plural or casing", () => {
    expect(parseTimelineWeeks("6 MONTHS")).toBe(24);
    expect(parseTimelineWeeks("1 Week")).toBe(1);
  });

  it("defaults when there is no number at all", () => {
    expect(parseTimelineWeeks("No date yet")).toBe(DEFAULT_WEEKS);
    expect(parseTimelineWeeks("")).toBe(DEFAULT_WEEKS);
  });

  it("treats a bare number as weeks", () => {
    expect(parseTimelineWeeks("8")).toBe(8);
  });

  // The clamp is a real guard, not decoration: `timeline` comes off the POST body
  // and the route validates its shape, not its membership in the option list.
  it("clamps absurd input rather than building a 9999-week plan", () => {
    expect(parseTimelineWeeks("9999 weeks")).toBe(MAX_WEEKS);
    expect(parseTimelineWeeks("500 months")).toBe(MAX_WEEKS);
    expect(parseTimelineWeeks("0 weeks")).toBe(1);
  });

  it("every timeline option in the wizard produces a sane plan length", () => {
    const options = ONBOARDING_STEPS.find((s) => s.id === "timeline")!.options;
    for (const o of options) {
      const w = parseTimelineWeeks(o);
      expect(w, `option "${o}"`).toBeGreaterThanOrEqual(1);
      expect(w, `option "${o}"`).toBeLessThanOrEqual(MAX_WEEKS);
    }
    // And the longest option really is the longest plan.
    expect(parseTimelineWeeks("6 months")).toBeGreaterThan(parseTimelineWeeks("12 weeks"));
  });
});

describe("parseHoursPerWeek", () => {
  it("reads the number out of the answer", () => {
    expect(parseHoursPerWeek("6h")).toBe(6);
    expect(parseHoursPerWeek("20h")).toBe(20);
  });

  it("defaults when the answer has no number", () => {
    expect(parseHoursPerWeek("As much as it takes")).toBe(DEFAULT_HOURS_PER_WEEK);
  });

  it("clamps to something a human could actually do", () => {
    expect(parseHoursPerWeek("500h")).toBeLessThanOrEqual(60);
    expect(parseHoursPerWeek("0h")).toBe(1);
  });
});

describe("planContract ↔ the seed generator agree", () => {
  const base: OnboardingAnswers = {
    role: "SDE-2 · Frontend",
    bar: "Big tech (FAANG-tier)",
    timeline: "6 months",
    hours: "12h",
    weak: ["React internals"],
  };

  // This is THE property that makes the seeded path a drop-in fallback: whichever
  // generator runs, the user's plan has the length and budget they chose.
  it("the seeded roadmap matches the contract the AI path is held to", () => {
    for (const timeline of ["3 weeks", "8 weeks", "12 weeks", "4 months", "6 months", "No date yet"]) {
      for (const hours of ["6h", "20h", "As much as it takes"]) {
        const answers = { ...base, timeline, hours };
        const contract = planContract(answers);
        const seeded = generateSeedRoadmap(answers);
        expect(seeded.weeksCount, `${timeline} / ${hours}`).toBe(contract.weeksCount);
        expect(seeded.weeks, `${timeline} / ${hours}`).toHaveLength(contract.weeksCount);
        expect(seeded.hoursPlanned, `${timeline} / ${hours}`).toBe(
          contract.weeksCount * contract.perWeekHours
        );
      }
    }
  });

  it("a 6-month plan really is 24 weeks of content, not 6", () => {
    const seeded = generateSeedRoadmap({ ...base, timeline: "6 months" });
    expect(seeded.weeks).toHaveLength(24);
    // Padding cycles the catalog rather than emitting blanks.
    for (const w of seeded.weeks) {
      expect(w.title.length).toBeGreaterThan(0);
      expect(w.topics.length).toBeGreaterThan(0);
    }
    expect(seeded.weeks.map((w) => w.n)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });
});

describe("weak areas follow the role", () => {
  it("offers a different list per role", () => {
    const fe = weakAreasForRole("SDE-2 · Frontend");
    const fs = weakAreasForRole("SDE-2 · Fullstack");
    const staff = weakAreasForRole("Staff · Frontend");

    expect(fs).toContain("Databases & SQL");
    expect(fe).not.toContain("Databases & SQL");
    expect(staff).toContain("Cross-team influence");
    expect(fe).not.toContain("Cross-team influence");
  });

  it("always offers 'Not sure', and always last", () => {
    for (const role of [
      "SDE-2 · Frontend",
      "SDE-2 · Fullstack",
      "Senior · Frontend",
      "Staff · Frontend",
      null,
      "something we've never heard of",
    ]) {
      const list = weakAreasForRole(role);
      expect(list[list.length - 1], `role=${role}`).toBe(NOT_SURE);
    }
  });

  it("falls back to the frontend list for an unknown role", () => {
    expect(weakAreasForRole("SDE-2 · Astrology")).toEqual(weakAreasForRole("SDE-2 · Frontend"));
  });

  it("has no duplicate options in any role's list", () => {
    for (const role of ["SDE-2 · Frontend", "SDE-2 · Fullstack", "Senior · Frontend", "Staff · Frontend"]) {
      const list = weakAreasForRole(role);
      expect(new Set(list).size, `role=${role}`).toBe(list.length);
    }
  });
});

describe("'Not sure' means no weak areas", () => {
  it("is stripped before either generator sees it", () => {
    expect(declaredWeakAreas([NOT_SURE])).toEqual([]);
    expect(declaredWeakAreas([NOT_SURE, "Async JS"])).toEqual(["Async JS"]);
    expect(declaredWeakAreas(["Async JS"])).toEqual(["Async JS"]);
  });

  // "Not sure" must produce a balanced plan — the same one you'd get by declaring
  // nothing — rather than being treated as an unmatched area that reorders nothing
  // by accident. Same outcome, but asserted so it stays deliberate.
  it("produces the same seeded plan as declaring nothing", () => {
    const base: OnboardingAnswers = {
      role: "SDE-2 · Frontend",
      bar: "Big tech (FAANG-tier)",
      timeline: "5 weeks",
      hours: "12h",
      weak: [],
    };
    const notSure = generateSeedRoadmap({ ...base, weak: [NOT_SURE] });
    const nothing = generateSeedRoadmap({ ...base, weak: [] });
    expect(notSure.weeks.map((w) => w.title)).toEqual(nothing.weeks.map((w) => w.title));
  });

  it("does not front-load anything", () => {
    const answers: OnboardingAnswers = {
      role: "SDE-2 · Frontend",
      bar: "Big tech (FAANG-tier)",
      timeline: "5 weeks",
      hours: "12h",
      weak: [NOT_SURE],
    };
    const r = generateSeedRoadmap(answers);
    // Natural catalog order — no area pulled to the front.
    expect(r.weeks[0].title).toBe("Core JS & Async");
  });
});
