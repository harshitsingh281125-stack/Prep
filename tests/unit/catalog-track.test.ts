import { describe, expect, it } from "vitest";
import {
  CATALOG,
  CATALOG_TRACK,
  NOT_SURE,
  ONBOARDING_STEPS,
  roleTrack,
  templateMismatch,
  weakAreasForRole,
} from "@/lib/seed/catalog";
import { generateSeedRoadmap } from "@/lib/seed/generate";

// Unit tests for the Phase 5 role-scope change: a backend role now exists, and
// the seeded CATALOG is still a frontend curriculum. templateMismatch() is the
// entire mechanism that keeps that from breaking Rule 9 quietly, so it gets
// tested harder than its five lines suggest.

const BACKEND = "SDE-2 · Backend";
const FRONTEND = "SDE-2 · Frontend";

describe("roles and their weak areas", () => {
  it("offers the backend role in onboarding", () => {
    const roleStep = ONBOARDING_STEPS.find((s) => s.id === "role")!;
    expect(roleStep.options).toContain(BACKEND);
  });

  it("gives the backend role backend weak areas, not frontend ones", () => {
    const areas = weakAreasForRole(BACKEND);
    expect(areas).toContain("Databases & SQL");
    expect(areas).toContain("Distributed systems & scale");
    expect(areas).not.toContain("React internals");
    expect(areas).not.toContain("Browser & rendering");
  });

  it("still ends every role's list with 'Not sure'", () => {
    for (const role of (ONBOARDING_STEPS.find((s) => s.id === "role")!.options)) {
      const areas = weakAreasForRole(role);
      expect(areas[areas.length - 1]).toBe(NOT_SURE);
    }
  });

  it("falls back to the frontend list for an unknown role", () => {
    expect(weakAreasForRole("SDE-2 · Astrology")).toEqual(weakAreasForRole(FRONTEND));
    expect(weakAreasForRole(null)).toEqual(weakAreasForRole(FRONTEND));
  });
});

describe("roleTrack", () => {
  it("maps backend to the backend track and everything else to frontend", () => {
    expect(roleTrack(BACKEND)).toBe("backend");
    expect(roleTrack(FRONTEND)).toBe("frontend");
    expect(roleTrack("Senior · Frontend")).toBe("frontend");
    expect(roleTrack("Staff · Frontend")).toBe("frontend");
  });

  it("treats fullstack as frontend on purpose", () => {
    // The catalog genuinely serves fullstack in part, so flagging it would cry
    // wolf on a mostly-correct plan — and a warning that fires on good plans is
    // one people learn to ignore.
    expect(roleTrack("SDE-2 · Fullstack")).toBe("frontend");
  });

  it("defaults an unknown or missing role to the catalog's own track (no mismatch)", () => {
    expect(roleTrack(undefined)).toBe(CATALOG_TRACK);
    expect(roleTrack("")).toBe(CATALOG_TRACK);
    expect(roleTrack("Something else entirely")).toBe(CATALOG_TRACK);
  });
});

describe("templateMismatch — the honest-fallback gate", () => {
  it("fires only when the seed ran AND the role needs another track", () => {
    expect(templateMismatch(BACKEND, "seed")).toBe(true);
  });

  it("does not fire when the model produced the roadmap", () => {
    // The AI path serves backend properly, so a backend roadmap from 'ai' is
    // exactly what the user asked for.
    expect(templateMismatch(BACKEND, "ai")).toBe(false);
  });

  it("does not fire for a frontend role on the seeded template", () => {
    expect(templateMismatch(FRONTEND, "seed")).toBe(false);
    expect(templateMismatch("Staff · Frontend", "seed")).toBe(false);
  });

  it("stays silent on unknown provenance (null) — the pre-0012 rows", () => {
    // Every roadmap created before migration 0012 has generated_from = null. We
    // cannot make a definite claim about a row we never recorded, so we make
    // none rather than warning falsely on old AI-generated plans.
    expect(templateMismatch(BACKEND, null)).toBe(false);
    expect(templateMismatch(BACKEND, undefined)).toBe(false);
  });

  it("stays silent on any unrecognised provenance value", () => {
    expect(templateMismatch(BACKEND, "")).toBe(false);
    expect(templateMismatch(BACKEND, "rag")).toBe(false);
    expect(templateMismatch(BACKEND, "SEED")).toBe(false); // case-sensitive by design
  });

  it("never fires when the role is missing entirely", () => {
    expect(templateMismatch("", "seed")).toBe(false);
    expect(templateMismatch(null, "seed")).toBe(false);
  });
});

describe("the seeded fallback still works for a backend answer set", () => {
  // Rule 9's real requirement: the fallback must still PRODUCE a usable plan for
  // the new role. It will be the wrong topics — that is what the notice is for —
  // but it must have the right shape, or the mismatch notice would be papering
  // over a broken flow rather than an honest one.
  const answers = {
    role: BACKEND,
    bar: "Big tech (FAANG-tier)",
    timeline: "8 weeks",
    hours: "12h",
    weak: ["Databases & SQL", "Distributed systems & scale"],
  };

  it("honours the user's contract (weeks and hours) regardless of role", () => {
    const roadmap = generateSeedRoadmap(answers);
    expect(roadmap.weeksCount).toBe(8);
    expect(roadmap.hoursPlanned).toBe(96);
    expect(roadmap.weeks).toHaveLength(8);
    expect(roadmap.weeks.every((w) => w.hours === 12)).toBe(true);
  });

  it("numbers its weeks 1..n with a kill criterion and topics on each", () => {
    const roadmap = generateSeedRoadmap(answers);
    roadmap.weeks.forEach((w, i) => {
      expect(w.n).toBe(i + 1);
      expect(w.killCriterion.length).toBeGreaterThan(0);
      expect(w.topics.length).toBeGreaterThan(0);
    });
  });

  it("produces frontend content — which is exactly why the notice exists", () => {
    // This assertion documents the defect the notice discloses. If per-role
    // catalogs are ever authored, THIS is the test that should start failing.
    const roadmap = generateSeedRoadmap(answers);
    const titles = roadmap.weeks.map((w) => w.title);
    expect(CATALOG.map((b) => b.title)).toEqual(expect.arrayContaining(titles));
    expect(titles.some((t) => t.includes("React") || t.includes("Browser") || t.includes("JS"))).toBe(
      true
    );
  });

  it("front-loads nothing when backend weak areas match no catalog block", () => {
    // Backend weak areas match no block's weakAreas, so orderBlocks falls through
    // to natural catalog order. Degrading rather than crashing is the behaviour
    // Phase 4 already relied on for fullstack's DB/API options.
    const roadmap = generateSeedRoadmap({ ...answers, timeline: "5 weeks" });
    expect(roadmap.weeks.map((w) => w.title)).toEqual(CATALOG.map((b) => b.title));
  });
});
