// lib/ai/cost.ts — the cost readout's arithmetic.
//
// Pure functions, no DB and no clock, for the same reason lib/recall/scheduler.ts
// and lib/progress/compute.ts are pure: it is the only way this math is
// assertable in a unit test rather than eyeballed on a dashboard. The /usage
// screen reads rows and hands them straight to summarize().
//
// The honesty rule this file exists to enforce: on a free tier the DOLLAR saving
// from prompt caching is zero, because everything is zero. So we report the
// actual charge (usually $0) and, separately, a PROJECTION at paid-tier rates.
// The projection is the honest form of a "cut inference cost by X%" claim — it
// says what the saving would be, computed from real token counts, rather than
// pretending money moved.

import { PRICING, type ModelRates } from "./config";
import type { Usage } from "./types";

/** One `ai_usage` row, in the shape the DB returns it. */
export type UsageRow = {
  route: string;
  tier: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cost_usd: number;
  status: "ok" | "invalid" | "error";
  attempts: number;
};

/** Money is rounded to 6dp everywhere so sums and comparisons agree. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function ratesFor(model: string): ModelRates {
  // An unknown model (one swapped in without a rate-card entry) is priced at
  // zero rather than guessed. A missing price shows up as $0.00 in the readout,
  // which is visibly wrong and prompts a fix — a guessed price would silently
  // produce a plausible number that is not true.
  return PRICING[model] ?? { inputPerM: 0, cachedInputPerM: 0, outputPerM: 0 };
}

/**
 * Whether this model's provider does prompt caching at all (Phase 6.1).
 *
 * DERIVED FROM THE RATE CARD rather than a separate flag, on purpose: a boolean
 * sitting beside the prices is a second source of truth that can disagree with
 * them, and the prices are the thing that has to be right anyway. A model with
 * no cache discount has cachedInputPerM === inputPerM — which is exactly how the
 * Groq entries are written, and what "no cache discount exists" means.
 *
 * This matters because of a metric bug it prevents. cacheHitRate and
 * cacheSavingRatio used to be computed over EVERY row. The moment a
 * structurally non-caching provider started writing rows (Groq reports no
 * cached-token field at all), its input tokens would have landed in the
 * denominator with nothing in the numerator, dragging the rate toward zero and
 * making Gemini's prompt caching look like it had regressed. The number would
 * still have been arithmetically correct and completely misleading — the worst
 * kind, on a screen whose whole point is not overstating things.
 */
export function cachesPrompts(model: string): boolean {
  const r = ratesFor(model);
  return r.cachedInputPerM < r.inputPerM;
}

/**
 * What one dispatch costs at the model's rate card.
 *
 * `cachedInputTokens` is a SUBSET of `inputTokens`, so the fresh input is the
 * difference. Adding them instead would bill the cached tokens twice and make
 * caching look like it INCREASED cost — the exact wrong direction.
 */
export function costUsd(model: string, usage: Usage): number {
  const r = ratesFor(model);
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const fresh = usage.inputTokens - cached;
  return round6(
    (fresh * r.inputPerM) / 1e6 +
      (cached * r.cachedInputPerM) / 1e6 +
      (usage.outputTokens * r.outputPerM) / 1e6
  );
}

/** What the same dispatch would have cost with no cache hits at all. */
export function costWithoutCacheUsd(model: string, usage: Usage): number {
  const r = ratesFor(model);
  return round6(
    (usage.inputTokens * r.inputPerM) / 1e6 + (usage.outputTokens * r.outputPerM) / 1e6
  );
}

export type RouteSummary = {
  route: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  projectedUsd: number;
};

export type UsageSummary = {
  /** Every dispatch, including retries and failures — the provider billed for all of them. */
  calls: number;
  ok: number;
  invalid: number;
  error: number;
  /** Dispatches that were attempt #2, i.e. the retry-on-malformed path firing. */
  retries: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** What was actually charged. $0 on the free tier. */
  actualUsd: number;
  /** What it would cost at the paid rate card — the projection, never stored. */
  projectedUsd: number;
  /** Same projection with every input token billed fresh. */
  projectedWithoutCacheUsd: number;
  /** projectedWithoutCache − projected. The caching win, in projected dollars. */
  cacheSavingUsd: number;
  /** cacheSaving / projectedWithoutCache, 0..1. null when nothing was spent. */
  cacheSavingRatio: number | null;
  /** How many of `calls` ran on a model whose provider caches prompts at all. */
  cacheCapableCalls: number;
  /**
   * cachedInputTokens / inputTokens over CACHE-CAPABLE rows only, 0..1.
   * null when no cache-capable call has been made yet — which is the honest
   * reading for a mock-only or Groq-only window, not a 0% hit rate.
   */
  cacheHitRate: number | null;
  /** Projected cost of every roadmap-generation dispatch ÷ roadmaps produced. */
  costPerRoadmapUsd: number | null;
  perRoute: RouteSummary[];
};

/** The route whose successes define "a roadmap" for the $/roadmap figure. */
export const ROADMAP_ROUTE = "/api/roadmaps/generate";

/**
 * Aggregate raw usage rows into everything the /usage screen shows.
 *
 * Note what the denominators are, because they're the part an interviewer would
 * poke at: cache hit-rate is over INPUT tokens (output is never cached, so
 * including it would dilute the rate toward zero and understate the win), and
 * $/roadmap divides ALL roadmap-route spend — including retried and failed
 * attempts — by the number of roadmaps actually produced. A generation that had
 * to be retried genuinely made that roadmap more expensive, and hiding the
 * failures in the numerator would flatter the number.
 */
export function summarize(rows: UsageRow[]): UsageSummary {
  const s: UsageSummary = {
    calls: 0,
    ok: 0,
    invalid: 0,
    error: 0,
    retries: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    actualUsd: 0,
    projectedUsd: 0,
    projectedWithoutCacheUsd: 0,
    cacheSavingUsd: 0,
    cacheSavingRatio: null,
    cacheCapableCalls: 0,
    cacheHitRate: null,
    costPerRoadmapUsd: null,
    perRoute: [],
  };

  const byRoute = new Map<string, RouteSummary>();
  let roadmapProjected = 0;
  let roadmapsProduced = 0;
  // Cache metrics are computed over this subset, not over every row — see
  // cachesPrompts() above for why mixing providers would otherwise lie.
  let capableInput = 0;
  let capableCached = 0;
  let capableProjected = 0;
  let capableProjectedWithoutCache = 0;

  for (const row of rows) {
    const usage: Usage = {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cachedInputTokens: row.cached_input_tokens,
    };
    const projected = costUsd(row.model, usage);

    s.calls += 1;
    if (row.status === "ok") s.ok += 1;
    else if (row.status === "invalid") s.invalid += 1;
    else s.error += 1;
    if (row.attempts > 1) s.retries += 1;

    s.inputTokens += row.input_tokens;
    s.outputTokens += row.output_tokens;
    s.cachedInputTokens += row.cached_input_tokens;
    s.actualUsd += Number(row.cost_usd) || 0;
    s.projectedUsd += projected;
    const projectedWithoutCache = costWithoutCacheUsd(row.model, usage);
    s.projectedWithoutCacheUsd += projectedWithoutCache;

    if (cachesPrompts(row.model)) {
      s.cacheCapableCalls += 1;
      capableInput += row.input_tokens;
      capableCached += row.cached_input_tokens;
      capableProjected += projected;
      capableProjectedWithoutCache += projectedWithoutCache;
    }

    const r = byRoute.get(row.route) ?? {
      route: row.route,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      projectedUsd: 0,
    };
    r.calls += 1;
    r.inputTokens += row.input_tokens;
    r.outputTokens += row.output_tokens;
    r.projectedUsd = round6(r.projectedUsd + projected);
    byRoute.set(row.route, r);

    if (row.route === ROADMAP_ROUTE) {
      roadmapProjected += projected;
      if (row.status === "ok") roadmapsProduced += 1;
    }
  }

  s.actualUsd = round6(s.actualUsd);
  s.projectedUsd = round6(s.projectedUsd);
  s.projectedWithoutCacheUsd = round6(s.projectedWithoutCacheUsd);
  // The absolute saving stays global and is still correct: a non-caching row has
  // projectedWithoutCache === projected, so it contributes exactly 0 to it. Only
  // the RATIOS needed narrowing, because only they have a denominator that a
  // non-caching row can inflate.
  s.cacheSavingUsd = round6(s.projectedWithoutCacheUsd - s.projectedUsd);
  s.cacheSavingRatio =
    capableProjectedWithoutCache > 0
      ? round6((capableProjectedWithoutCache - capableProjected) / capableProjectedWithoutCache)
      : null;
  s.cacheHitRate = capableInput > 0 ? round6(capableCached / capableInput) : null;
  s.costPerRoadmapUsd =
    roadmapsProduced > 0 ? round6(roadmapProjected / roadmapsProduced) : null;
  s.perRoute = [...byRoute.values()].sort((a, b) => b.calls - a.calls);

  return s;
}
