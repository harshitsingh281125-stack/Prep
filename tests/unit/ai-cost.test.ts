import { describe, expect, it } from "vitest";
import { ROADMAP_ROUTE, costUsd, costWithoutCacheUsd, summarize, type UsageRow } from "@/lib/ai/cost";
import { PRICING } from "@/lib/ai/config";

// The cost readout's arithmetic. This is the file that produces a number a
// résumé bullet would quote, so the tests are about whether the number means
// what the label says it means — not just whether it's non-zero.

const FLASH = "gemini-3.5-flash";
const LITE = "gemini-3.5-flash-lite";

function row(over: Partial<UsageRow> = {}): UsageRow {
  return {
    route: "/api/topics/detail",
    tier: "reasoning",
    model: FLASH,
    input_tokens: 1000,
    output_tokens: 500,
    cached_input_tokens: 0,
    cost_usd: 0,
    status: "ok",
    attempts: 1,
    ...over,
  };
}

describe("costUsd", () => {
  it("prices fresh input and output at the rate card", () => {
    const r = PRICING[FLASH];
    expect(costUsd(FLASH, { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 0 })).toBe(
      r.inputPerM
    );
    expect(costUsd(FLASH, { inputTokens: 0, outputTokens: 1_000_000, cachedInputTokens: 0 })).toBe(
      r.outputPerM
    );
  });

  // The subset rule. Treating cached tokens as an ADDITION rather than a subset
  // would bill them twice and make caching look like it raised the bill.
  it("treats cached tokens as a subset of input, priced at the cheaper rate", () => {
    const r = PRICING[FLASH];
    const cost = costUsd(FLASH, {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 400_000,
    });
    const expected = (600_000 * r.inputPerM) / 1e6 + (400_000 * r.cachedInputPerM) / 1e6;
    expect(cost).toBeCloseTo(expected, 9);
    // A full cache hit must be strictly cheaper than none, never more expensive.
    expect(cost).toBeLessThan(costUsd(FLASH, { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 0 }));
  });

  it("clamps cached tokens that exceed the input count", () => {
    // A provider reporting nonsense must not produce negative fresh tokens.
    const cost = costUsd(FLASH, { inputTokens: 100, outputTokens: 0, cachedInputTokens: 999 });
    expect(cost).toBeGreaterThanOrEqual(0);
  });

  // A guessed price would look plausible and be wrong; $0.00 is visibly wrong.
  it("prices an unknown model at zero rather than guessing", () => {
    expect(costUsd("some-model-we-never-configured", { inputTokens: 1e6, outputTokens: 1e6, cachedInputTokens: 0 })).toBe(0);
  });

  it("prices the mock provider at zero so local dev never invents spend", () => {
    expect(costUsd("mock", { inputTokens: 500_000, outputTokens: 500_000, cachedInputTokens: 0 })).toBe(0);
  });

  it("costWithoutCache bills every input token fresh", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 900_000 };
    expect(costWithoutCacheUsd(FLASH, usage)).toBe(PRICING[FLASH].inputPerM);
    expect(costWithoutCacheUsd(FLASH, usage)).toBeGreaterThan(costUsd(FLASH, usage));
  });

  it("the cheap tier really is cheaper for identical usage", () => {
    const usage = { inputTokens: 10_000, outputTokens: 5_000, cachedInputTokens: 0 };
    expect(costUsd(LITE, usage)).toBeLessThan(costUsd(FLASH, usage));
  });
});

describe("summarize", () => {
  it("returns nulls rather than zeros when there is nothing to divide", () => {
    const s = summarize([]);
    expect(s.calls).toBe(0);
    expect(s.cacheHitRate).toBeNull();
    expect(s.cacheSavingRatio).toBeNull();
    expect(s.costPerRoadmapUsd).toBeNull();
    expect(s.perRoute).toEqual([]);
  });

  it("totals tokens and classifies every dispatch by status", () => {
    const s = summarize([
      row(),
      row({ status: "invalid", attempts: 1 }),
      row({ status: "ok", attempts: 2 }),
      row({ status: "error", input_tokens: 0, output_tokens: 0 }),
    ]);
    expect(s.calls).toBe(4);
    expect(s.ok).toBe(2);
    expect(s.invalid).toBe(1);
    expect(s.error).toBe(1);
    expect(s.retries).toBe(1); // only the attempts > 1 dispatch
    expect(s.inputTokens).toBe(3000);
    expect(s.outputTokens).toBe(1500);
  });

  it("computes cache hit-rate over input tokens only", () => {
    // Output is never cached; including it would dilute the rate and understate
    // the win the metric exists to report.
    const s = summarize([row({ input_tokens: 1000, cached_input_tokens: 250, output_tokens: 9999 })]);
    expect(s.cacheHitRate).toBe(0.25);
  });

  it("reports the caching win as projected dollars off the uncached projection", () => {
    const s = summarize([row({ input_tokens: 1_000_000, cached_input_tokens: 500_000, output_tokens: 0 })]);
    const r = PRICING[FLASH];
    const uncached = r.inputPerM;
    const withCache = (500_000 * r.inputPerM) / 1e6 + (500_000 * r.cachedInputPerM) / 1e6;
    expect(s.projectedWithoutCacheUsd).toBeCloseTo(uncached, 6);
    expect(s.projectedUsd).toBeCloseTo(withCache, 6);
    expect(s.cacheSavingUsd).toBeCloseTo(uncached - withCache, 6);
    expect(s.cacheSavingRatio).toBeGreaterThan(0);
    expect(s.cacheSavingRatio).toBeLessThan(1);
  });

  // The honesty property: on the free tier cost_usd is 0 on every row, and the
  // projection must NOT quietly stand in for it.
  it("keeps actual charges and the paid-tier projection separate", () => {
    const s = summarize([row({ cost_usd: 0 }), row({ cost_usd: 0 })]);
    expect(s.actualUsd).toBe(0);
    expect(s.projectedUsd).toBeGreaterThan(0);
  });

  it("uses the stored charge for actualUsd when billing is real", () => {
    const s = summarize([row({ cost_usd: 0.004 }), row({ cost_usd: 0.006 })]);
    expect(s.actualUsd).toBeCloseTo(0.01, 9);
  });

  // $/roadmap divides ALL roadmap-route spend by the roadmaps actually produced.
  // A retried generation genuinely made that roadmap more expensive.
  it("charges failed and retried attempts to the roadmap they were spent on", () => {
    const clean = summarize([row({ route: ROADMAP_ROUTE, status: "ok" })]);
    const retried = summarize([
      row({ route: ROADMAP_ROUTE, status: "invalid", attempts: 1 }),
      row({ route: ROADMAP_ROUTE, status: "ok", attempts: 2 }),
    ]);
    expect(retried.costPerRoadmapUsd).toBeGreaterThan(clean.costPerRoadmapUsd!);
    expect(retried.costPerRoadmapUsd).toBeCloseTo(clean.costPerRoadmapUsd! * 2, 9);
  });

  it("leaves $/roadmap null when spend produced no roadmap at all", () => {
    const s = summarize([row({ route: ROADMAP_ROUTE, status: "invalid" }), row({ route: ROADMAP_ROUTE, status: "invalid" })]);
    expect(s.costPerRoadmapUsd).toBeNull();
    expect(s.projectedUsd).toBeGreaterThan(0); // the tokens were still spent
  });

  it("ignores other routes when computing $/roadmap", () => {
    const s = summarize([
      row({ route: ROADMAP_ROUTE, status: "ok" }),
      row({ route: "/api/recall/generate", model: LITE, status: "ok" }),
    ]);
    expect(s.costPerRoadmapUsd).toBeCloseTo(costUsd(FLASH, { inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0 }), 9);
  });

  it("groups by route, busiest first", () => {
    const s = summarize([
      row({ route: "/api/recall/generate" }),
      row({ route: ROADMAP_ROUTE }),
      row({ route: "/api/recall/generate" }),
      row({ route: "/api/recall/generate" }),
    ]);
    expect(s.perRoute[0].route).toBe("/api/recall/generate");
    expect(s.perRoute[0].calls).toBe(3);
    expect(s.perRoute[1].calls).toBe(1);
  });

  it("does not mutate the rows it is given", () => {
    const rows = [row(), row({ route: ROADMAP_ROUTE })];
    const snapshot = JSON.stringify(rows);
    summarize(rows);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});
