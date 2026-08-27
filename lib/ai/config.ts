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
  // Live since Phase 4.5 (RAG) — embeds the corpus and every retrieval query.
  embedding: "gemini-embedding-001",
};

/**
 * Embedding width, in dimensions (Phase 4.5).
 *
 * NOT the model's default. Probed against the live endpoint on 2026-08-13:
 * gemini-embedding-001 returns 3072 dimensions natively (unit length), and
 * honours outputDimensionality to truncate — 1536 and 768 both come back at the
 * requested width but NOT unit length.
 *
 * 1536 is chosen because **pgvector cannot index a `vector` wider than 2000
 * dimensions** (HNSW and IVFFlat both refuse). At 3072 the corpus search would
 * be a sequential scan forever, or would need halfvec at half precision. 1536 is
 * a Matryoshka truncation of the same embedding, so the leading dimensions still
 * carry most of the signal.
 *
 * This constant and the `vector(1536)` column in 0007_resources.sql must agree.
 * They are checked against each other at runtime: the gateway rejects an
 * embedding of the wrong width rather than letting Postgres reject the insert
 * halfway through a backfill.
 */
export const EMBEDDING_DIM = 1536;

/**
 * The retrieval similarity floor: how close a corpus document must be to the
 * topic query before it is allowed to ground the answer.
 *
 * This is the single most important number in the RAG pipeline, because a plain
 * top-k has no notion of "nothing relevant" — it would return five confident
 * links for a topic the corpus knows nothing about. The floor is what makes
 * empty retrieval possible, and empty retrieval is what routes a niche topic to
 * the honest `unverified` fallback (Rule 9).
 *
 * THE VALUE IS MEASURED, AND IT HAS BEEN RE-MEASURED TWICE. That is the point:
 * it is a property of the model-and-corpus PAIR, so it moves when either moves.
 *
 * Round 1 (2026-08-13, 48-document frontend corpus). Started at 0.55, chosen by
 * intuition. Probing with deliberately off-domain queries showed that would have
 * admitted everything:
 *
 *   in-domain  "Reconciliation & keys"            0.761 … 0.642  (correct docs)
 *   OFF-domain "Postgres query planner internals" 0.568 … 0.562  <- ABOVE 0.55
 *              "Kafka consumer group rebalancing" 0.560 … 0.544
 *
 * Gemini's embeddings are NOT zero-centred: two texts with nothing in common
 * still score ~0.55, so "cosine similarity above a half" means nothing here. At
 * 0.55 a backend topic would have been grounded on React documentation with
 * every link marked VERIFIED — the exact failure this phase exists to prevent,
 * reintroduced by a plausible-looking constant. Raised to 0.62, margin 0.052.
 *
 * Round 2 (2026-08-14, 202 documents across 26 areas). Migrations 0009-0011
 * widened the corpus into security, TypeScript, testing, databases, DSA,
 * distributed systems and more. A BROADER CORPUS SHRINKS THE MARGIN, because
 * more of the world is now genuinely adjacent to something we hold: the best
 * off-domain score rose to 0.616 ("SwiftUI view lifecycle" against react.dev's
 * "Lifecycle of Reactive Effects" — not an absurd match at all), leaving 0.62
 * with a margin of 0.004. Raised to 0.64, margin 0.024.
 *
 * What 0.64 costs, measured rather than assumed: across 189 real topics,
 * 182 still ground on 2+ documents, 6 drop to one and 1 to none. The matches it
 * removed were fifth-place tails ("debounce / throttle" -> AWS backoff-with-
 * jitter at 0.630), which are precisely the weak links that would otherwise
 * render with a green VERIFIED chip they have not earned.
 *
 * Re-run `npm run probe:retrieval` after ANY corpus or model change, and keep
 * its OFF_DOMAIN list in step with what the corpus now covers — a stale fixture
 * there produced a false "FLOOR IS TOO LOW" alarm once already.
 *
 * Env-overridable for the same reason AI_DAILY_CALL_CAP is, and it is worth
 * being precise that this is a TEST-REACHABILITY override, not a weakening:
 * the E2E suite runs on the mock provider, whose embeddings are lexical and live
 * in a completely different vector space from the Gemini vectors stored in the
 * corpus — so every similarity under mock is meaningless noise. Pinning the
 * floor per-spec (near -1 to force hits, above 1 to force a miss) is what makes
 * BOTH branches of the pipeline reachable without a live provider. The floor's
 * real value is exercised by the manual RAG suite against real embeddings.
 */
export const DEFAULT_RAG_MIN_SIMILARITY = 0.64;

export function ragMinSimilarity(): number {
  const raw = Number(process.env.RAG_MIN_SIMILARITY);
  return Number.isFinite(raw) ? raw : DEFAULT_RAG_MIN_SIMILARITY;
}

/** How many corpus documents are retrieved to ground one topic. */
export const RAG_TOP_K = 5;

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

/**
 * How many recent `ai_usage` rows the cost readout aggregates.
 *
 * The readout is a WINDOW, not a lifetime total, and this constant exists so the
 * API and the page cannot disagree about that — and so the field can be named
 * for what it is. It used to be an unnamed `.limit(500)` in two places whose
 * result was returned as `allTime`, which stopped being true the moment a user
 * crossed 500 dispatches: the count pinned at exactly 500 and every derived
 * figure ($/roadmap, cache hit-rate, fallback rate) silently became "over the
 * last 500 calls" while still being labelled all-time. On a screen whose entire
 * selling point is not overstating things, that was the wrong kind of bug.
 */
export const USAGE_WINDOW = 500;
