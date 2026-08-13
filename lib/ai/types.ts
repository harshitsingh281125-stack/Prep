// Shared types for the AI Gateway (Phase 4).
//
// Rule 7/8: product code depends on THIS interface, never a vendor SDK, and it
// speaks tiers rather than model names. Everything below is deliberately
// vendor-neutral — nothing here mentions Gemini, and nothing here would have to
// change to put a different provider behind the gateway.

/** What product code asks for. A config map binds each tier to a real model. */
export type Tier = "reasoning" | "classification" | "embedding";

/**
 * Token accounting for one provider dispatch.
 *
 * `cachedInputTokens` is a SUBSET of `inputTokens`, not an addition to it — the
 * provider reports how many of the input tokens it served from its prompt cache.
 * Keeping it as a subset is what makes cache hit-rate a simple ratio and stops
 * the totals from double-counting (see lib/ai/cost.ts).
 */
export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
};

/** One dispatch's result, as returned by a provider adapter. */
export type ProviderResponse = {
  /** Raw text the model produced — expected to be JSON when a schema was sent. */
  text: string;
  usage: Usage;
};

/**
 * A provider adapter. The gateway owns caps, validation, retry and metering;
 * an adapter's only job is "turn this request into text + token counts".
 *
 * Deliberately narrow: no streaming, no tools, no multi-turn. Prep makes
 * single-shot structured generations, and an interface that promised more than
 * the product uses would be speculative surface (CLAUDE.md: simplicity first).
 */
export interface Provider {
  /** For logs + the `model` column when a request never reaches the wire. */
  readonly name: string;
  complete(req: {
    model: string;
    /** Fixed, cacheable scaffolding. Kept identical across calls on purpose. */
    system: string;
    /** The per-call variable part. */
    input: string;
    /** Provider-side structured-output constraint, when the caller has one. */
    jsonSchema?: JsonSchema;
  }): Promise<ProviderResponse>;
}

/**
 * The tiny subset of JSON Schema this project actually sends to providers.
 * Hand-rolled rather than pulled from a library for the same reason the
 * scheduler and the charts are (Rules 14/22): it is small, it is owned, and a
 * dependency here would buy nothing.
 */
export type JsonSchema = {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean";
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  description?: string;
};

/** Why a generation didn't produce usable data. Drives the caller's fallback. */
export type FailureReason =
  /** The per-user daily cap was already spent — nothing was dispatched (Rule 3). */
  | "cap"
  /** The provider errored / was unreachable (HTTP failure, timeout, outage). */
  | "provider"
  /** Every attempt returned something that failed schema validation (Rule 9). */
  | "invalid"
  /** No provider is configured (no API key) — local dev with AI switched off. */
  | "disabled";

/**
 * The gateway's return type. Note it is NOT a thrown error on failure: an AI
 * failure is an expected, routine branch here, and Rule 9 says it must never
 * hard-block a user flow. Making the caller destructure `ok` forces every call
 * site to decide what its fallback is, rather than letting an unhandled throw
 * take out the request.
 */
export type CompleteResult<T> =
  | { ok: true; data: T; usage: Usage; model: string; attempts: number }
  | { ok: false; reason: FailureReason; attempts: number };
