import { describe, expect, it } from "vitest";
import { seedTopicDetail } from "@/lib/seed/detail";
import { TOPIC_DETAIL } from "@/lib/seed/catalog";

// The Rule 9 fallback for /api/topics/[id]/detail. Its one hard requirement is
// that it can never itself fail — a fallback with a failure mode isn't one.

describe("seedTopicDetail", () => {
  it("returns the catalog's hand-written detail for a known topic", () => {
    const known = Object.keys(TOPIC_DETAIL)[0];
    const d = seedTopicDetail(known);
    expect(d.model).toBe(TOPIC_DETAIL[known].model);
    expect(d.resources.length).toBeGreaterThan(0);
  });

  it("returns a coherent template for a topic the catalog has never seen", () => {
    // An AI-generated roadmap invents its own topic names, so this is the COMMON
    // case now, not the edge case.
    const d = seedTopicDetail("Some topic the model invented");
    expect(d.model).toContain("Some topic the model invented");
    expect(d.resources.length).toBeGreaterThanOrEqual(2);
    expect(d.exercises.length).toBeGreaterThanOrEqual(2);
  });

  it("always marks itself as the template, never as a generation", () => {
    expect(seedTopicDetail("anything").source).toBe("seed");
    expect(seedTopicDetail(Object.keys(TOPIC_DETAIL)[0]).source).toBe("seed");
  });

  // Only model-recalled resources get flagged. Hand-written catalog entries are
  // not "unverified" — a blanket flag would make the marker meaningless.
  it("does not mark seeded resources unverified", () => {
    const d = seedTopicDetail("Some topic the model invented");
    expect(d.resources.every((r) => !r.unverified)).toBe(true);
  });

  it("survives degenerate topic names without throwing", () => {
    for (const name of ["", "   ", "a".repeat(500), "💀 <script>"]) {
      const d = seedTopicDetail(name);
      expect(d.model.length).toBeGreaterThan(0);
      expect(d.exercises.length).toBeGreaterThan(0);
    }
  });

  it("does not mutate the shared catalog entry", () => {
    const known = Object.keys(TOPIC_DETAIL)[0];
    const before = JSON.stringify(TOPIC_DETAIL[known]);
    seedTopicDetail(known);
    expect(JSON.stringify(TOPIC_DETAIL[known])).toBe(before);
    // ...which the spread in seedTopicDetail is what guarantees: stamping
    // `source` onto the catalog object itself would poison every later read.
    expect(TOPIC_DETAIL[known].source).toBeUndefined();
  });
});
