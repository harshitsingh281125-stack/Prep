// lib/ai/config.ts — the ONLY file in the project that names a concrete model.
//
// Rule 8: product code says `tier: 'reasoning'`, never a model id. Swapping the
// v1 pick (or A/B-ing it) is an edit to the map below; no feature code changes.
// If you find a model string anywhere outside this file, that's a bug.

import type { Tier } from "./types";

/**
 * v1 tier → model binding (settled 2026-07-28, models confirmed against the live
 * models.list endpoint 2026-08-08).
 *
 * The counterintuitive part, and the point worth making out loud: the
 * PRICIER-per-token model sits on the RARE call and the cheap one on the
 * FREQUENT call. Roadmap generation is capped at 3 per user by the quota rule
 * (Rule 18) and is the output the whole product is judged on, so it gets the
 * better model. Recall-card generation runs on every topic of every roadmap, so
 * it gets the cheap one. Cost follows call VOLUME, not perceived importance.
 */
export const MODELS: Record<Tier, string> = {
  reasoning: "gemini-3.5-flash",
  classification: "gemini-3.5-flash-lite",
  // Unused until Phase 4.5 (RAG). Named here so the binding lives in one place.
  embedding: "gemini-embedding-001",
};

/**
 * Rule 3: a hard per-user daily call cap, counted from `ai_usage` and checked
 * BEFORE dispatch. 25 is deliberately reachable by hand — a cap you cannot hit
 * in a QA session is a cap you never actually tested (see tests/phase-4-*.md,
 * suite CAP).
 *
 * This counts PROVIDER DISPATCHES, not user actions: a generation that came back
 * malformed and was retried spends two. That's the honest unit, because it's what
 * the provider's own quota counts.
 */
export const DEFAULT_DAILY_CALL_CAP = 25;

/**
 * Overridable via AI_DAILY_CALL_CAP, and the reason is worth recording because
 * it looks like weakening a security control and isn't.
 *
 * The E2E suite generates roadmaps, topic detail and recall cards repeatedly —
 * comfortably more than 25 dispatches in one run. With a fixed cap the suite
 * exhausted it partway through and every later spec failed as "capped" rather
 * than on its own merits, which makes the whole run uninformative. Raising the
 * cap for the test server (playwright.config.ts) fixes that.
 *
 * What is NOT given up: the cap's LOGIC — the pre-dispatch check, the boundary,
 * the fail-closed path, and the retry that must not step over the limit — is
 * unit-tested against a fake provider in tests/unit/ai-gateway.test.ts, where it
 * can be exercised exactly and for free. Its LIVE behaviour is verified by the
 * manual matrix (suite CAP), which sets the cap to 2 and watches a real
 * generation get refused. Neither of those depends on the constant's value here.
 */
function readCap(): number {
  const raw = Number(process.env.AI_DAILY_CALL_CAP);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_DAILY_CALL_CAP;
}

export const DAILY_CALL_CAP = readCap();

/** One retry on malformed output, then the caller falls back to seed (Rule 9). */
export const MAX_ATTEMPTS = 2;

/** Wall-clock budget for a single dispatch. Past this we fall back rather than hang. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Rate card, USD per 1M tokens, from Google's published pricing (2026-08-08).
 * Used two ways, and the difference matters:
 *
 *   - if billing is 'paid', this is what a call ACTUALLY cost, written to
 *     ai_usage.cost_usd;
 *   - if billing is 'free', the actual cost is 0 and this same card is used at
 *     READ time to project "what this would have cost on the paid tier".
 *
 * The projection is never stored (see 0006_ai_usage.sql) — a rate card changes,
 * and a stored projection would silently become a wrong number in a résumé bullet.
 */
export type ModelRates = {
  /** Fresh (uncached) input tokens. */
  inputPerM: number;
  /** Input tokens served from the provider's prompt cache — the caching win. */
  cachedInputPerM: number;
  outputPerM: number;
};

export const PRICING: Record<string, ModelRates> = {
  "gemini-3.5-flash": { inputPerM: 1.5, cachedInputPerM: 0.15, outputPerM: 9.0 },
  "gemini-3.5-flash-lite": { inputPerM: 0.3, cachedInputPerM: 0.03, outputPerM: 2.5 },
  "gemini-2.5-flash": { inputPerM: 0.3, cachedInputPerM: 0.03, outputPerM: 2.5 },
  "gemini-2.5-flash-lite": { inputPerM: 0.1, cachedInputPerM: 0.01, outputPerM: 0.4 },
  "gemini-embedding-001": { inputPerM: 0.15, cachedInputPerM: 0.15, outputPerM: 0 },
  // The mock adapter is priced at zero: it never touches a provider, so counting
  // it as spend would pollute the readout with fictional cost.
  mock: { inputPerM: 0, cachedInputPerM: 0, outputPerM: 0 },
};

/**
 * Which billing arrangement the configured key is on.
 *
 * This exists because the answer changes what `ai_usage.cost_usd` MEANS, and
 * that column gets quoted. On the free tier nothing is charged, so storing a
 * computed cost there would be a fiction; on prepay/paid the computed cost is
 * the real one. Default 'free' — the safe direction, since it never overstates
 * what was spent.
 */
export function billingMode(): "free" | "paid" {
  return process.env.AI_BILLING_MODE === "paid" ? "paid" : "free";
}

/**
 * Which provider adapter to use.
 *
 * 'mock' is a first-class option, not a test hack: Architecture §5 always
 * planned for a local-dev provider so the app is fully exercisable with AI off,
 * and the E2E suite must not depend on a third party's uptime to stay green.
 * With no key configured at all we report 'none', and every generation takes the
 * seeded fallback path — the app stays completely usable (Rule 9).
 */
export function providerName(): "gemini" | "mock" | "none" {
  if (process.env.AI_PROVIDER === "mock") return "mock";
  return process.env.GEMINI_API_KEY ? "gemini" : "none";
}
