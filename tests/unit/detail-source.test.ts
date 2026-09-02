import { describe, expect, it } from "vitest";
import { detailSourceMeta, type DetailSource } from "@/lib/roadmap/status";

// The Roadmap screen's content marker (Phase 5) — "has this topic's study
// material been generated, and how grounded is it", answered without opening the
// topic. Small mapping, but it encodes one rule worth pinning: an unrecognised
// provenance must read as "no content", never as content we can vouch for.

describe("detailSourceMeta", () => {
  it("grades the three generated sources on the SAME ladder as the Topic screen", () => {
    // rag > ai > seed, and the colours must match the meaning used elsewhere:
    // green = vetted links, amber = model-recalled, muted = template.
    expect(detailSourceMeta("rag").color).toBe("var(--green)");
    expect(detailSourceMeta("ai").color).toBe("var(--amber)");
    expect(detailSourceMeta("seed").color).toBe("var(--text-muted)");
  });

  it("labels each source with one scannable word", () => {
    expect(detailSourceMeta("rag").label).toBe("VETTED");
    expect(detailSourceMeta("ai").label).toBe("AI");
    expect(detailSourceMeta("seed").label).toBe("TEMPLATE");
    expect(detailSourceMeta(null).label).toBe("NO CONTENT");
  });

  it("treats null as 'not generated' — the ungenerated state is shown, not omitted", () => {
    const none = detailSourceMeta(null);
    expect(none.color).toBe("var(--text-faint)");
    expect(none.soft).toBe("transparent");
    // The point of rendering it at all: you are scanning 25 rows for the topics
    // you still have to generate, and an absent chip is invisible.
    expect(none.hint).toMatch(/Generate with AI/);
  });

  it("never renders an unexpected value as if it were content", () => {
    // topics.detail is jsonb written by three code paths that all stamp `source`,
    // but the column is not constrained — so anything else must degrade to "no
    // content" rather than being displayed raw or treated as vetted.
    for (const bogus of ["RAG", "grounded", "", "null", "manual"]) {
      const m = detailSourceMeta(bogus as unknown as DetailSource);
      expect(m.label).toBe("NO CONTENT");
      expect(m.color).toBe("var(--text-faint)");
    }
  });

  it("gives every state a hint long enough to explain the chip", () => {
    for (const s of ["rag", "ai", "seed", null] as DetailSource[]) {
      expect(detailSourceMeta(s).hint.length).toBeGreaterThan(30);
    }
  });
});
