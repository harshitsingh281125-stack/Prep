import "server-only";

// lib/ai/gateway.ts — the single door every AI call in Prep goes through.
//
// Product code calls complete({ tier, … }) and gets back a discriminated union.
// It never sees a model name (Rule 8), never sees a vendor SDK (Rule 7), and is
// never handed a raw model response — only data that has already passed schema
// validation (Rule 9).
//
// The gateway owns four things the call sites must not be trusted with:
//
//   1. THE CAP (Rule 3) — counted from ai_usage BEFORE dispatch, not after.
//   2. VALIDATION + ONE RETRY (Rule 9) — and then it gives up, on purpose. The
//      caller falls back to seeded content; AI never hard-blocks a flow.
//   3. METERING (Rule 11) — every dispatch writes a row, including the failures.
//      Metering only the successes would make the cap under-count exactly when a
//      broken model is burning the most quota.
//   4. THE PROVIDER BINDING — which adapter, which model for this tier.
//
// Everything is injectable via `deps` so the retry/cap/metering logic is
// unit-testable against a fake provider with no network and no database. That
// is the same discipline as the Phase 2 scheduler and the Phase 3 aggregation:
// if the interesting logic can only be exercised by the real world, it doesn't
// get tested.

import {
  DAILY_CALL_CAP,
  MAX_ATTEMPTS,
  MODELS,
  billingMode,
  providerName,
} from "./config";
import { costUsd } from "./cost";
import { RETRY_NUDGE } from "./prompts";
import { createGeminiProvider } from "./providers/gemini";
import { createMockProvider } from "./providers/mock";
import { EMPTY_USAGE, type CompleteResult, type JsonSchema, type Provider, type Tier, type Usage } from "./types";
import { createAdminClient } from "@/lib/supabase/admin";

/** One metered dispatch, as written to ai_usage. */
export type MeterRow = {
  userId: string;
  route: string;
  tier: Tier;
  model: string;
  usage: Usage;
  status: "ok" | "invalid" | "error";
  /** Which attempt this dispatch was (1, or 2 for the retry-on-malformed). */
  attempts: number;
  latencyMs: number;
};

export type GatewayDeps = {
  provider: Provider | null;
  /** Model id to bill/report against; defaults to the tier binding. */
  model: string;
  /** Calls this user has already dispatched since midnight UTC. */
  countToday: (userId: string) => Promise<number>;
  meter: (row: MeterRow) => Promise<void>;
};

export type CompleteOptions<T> = {
  tier: Exclude<Tier, "embedding">;
  /** The API route spending the call — the grouping key for $/roadmap. */
  route: string;
  userId: string;
  /** Fixed, cacheable scaffolding. Must not vary per user (see prompts.ts). */
  system: string;
  input: string;
  jsonSchema?: JsonSchema;
  /** Rule 9: returns the typed value, or null if the response isn't usable. */
  validate: (raw: unknown) => T | null;
};

// --- provider + metering wiring (the real, non-injected implementations) ----

function resolveProvider(): Provider | null {
  const name = providerName();
  if (name === "mock") return createMockProvider();
  if (name === "gemini") return createGeminiProvider(process.env.GEMINI_API_KEY!);
  return null;
}

/** Midnight UTC today. Rule 15: the cap window is UTC, like every other date here. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function countTodayFromDb(userId: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfUtcDay(new Date()).toISOString());

  // Fail CLOSED. If the usage table can't be read we cannot prove the user is
  // under their cap, and Rule 3 says the cap is hard. Returning 0 here would
  // turn any database blip into an uncapped AI endpoint — the failure mode the
  // rule exists to prevent. The user gets seeded content instead, which is a
  // degradation, not a hole.
  if (error) return Number.POSITIVE_INFINITY;
  return count ?? 0;
}

async function meterToDb(row: MeterRow): Promise<void> {
  const admin = createAdminClient();
  await admin.from("ai_usage").insert({
    user_id: row.userId,
    route: row.route,
    tier: row.tier,
    model: row.model,
    input_tokens: row.usage.inputTokens,
    output_tokens: row.usage.outputTokens,
    cached_input_tokens: row.usage.cachedInputTokens,
    // Free tier: nothing was charged, so nothing is recorded as charged. The
    // paid-tier figure is derived at read time from the token columns instead
    // (lib/ai/cost.ts) — see the note in 0006_ai_usage.sql.
    cost_usd: billingMode() === "paid" ? costUsd(row.model, row.usage) : 0,
    status: row.status,
    attempts: row.attempts,
    latency_ms: row.latencyMs,
  });
}

// --- response parsing ------------------------------------------------------

/**
 * Pull JSON out of a model response.
 *
 * Models wrap JSON in ```json fences often enough that treating a fenced
 * response as malformed would spend a retry on a formatting quirk rather than a
 * real schema failure. Stripping the fence is not "being lenient about the
 * schema" — validate() still has to pass afterwards.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

// --- the gateway -----------------------------------------------------------

/**
 * Run one structured generation.
 *
 * Never throws for an AI-side problem: an unreachable provider, a spent cap and
 * a twice-malformed response all come back as `{ ok: false, reason }` so the
 * call site is forced to have a fallback (Rule 9). It can still throw if the
 * *caller* is broken — e.g. no service-role key configured — because that is a
 * deployment fault, not an AI outcome.
 */
export async function complete<T>(
  opts: CompleteOptions<T>,
  deps: Partial<GatewayDeps> = {}
): Promise<CompleteResult<T>> {
  const provider = deps.provider !== undefined ? deps.provider : resolveProvider();
  const model = deps.model ?? (provider?.name === "mock" ? "mock" : MODELS[opts.tier]);
  const countToday = deps.countToday ?? countTodayFromDb;
  const meter = deps.meter ?? meterToDb;

  // No provider configured at all — local dev with AI switched off. Nothing is
  // metered because nothing was dispatched.
  if (!provider) return { ok: false, reason: "disabled", attempts: 0 };

  // Rule 3: the cap is checked BEFORE the call, not enforced by noticing
  // afterwards that we went over.
  const used = await countToday(opts.userId);
  if (used >= DAILY_CALL_CAP) return { ok: false, reason: "cap", attempts: 0 };

  let attempt = 0;
  while (attempt < MAX_ATTEMPTS) {
    // Re-check before the retry too: attempt 2 is a second real dispatch against
    // the provider, so a user sitting on the cap boundary must not be able to
    // step over it by way of a malformed first response.
    if (used + attempt >= DAILY_CALL_CAP) {
      return { ok: false, reason: "cap", attempts: attempt };
    }
    attempt += 1;

    const startedAt = Date.now();
    let text: string;
    let usage: Usage;

    try {
      const res = await provider.complete({
        model,
        system: opts.system,
        // The nudge goes in the INPUT, never the system string — rewriting the
        // system prompt on retry would invalidate the cached prefix and make the
        // retry cost more than the call it is retrying (Rule 10).
        input: attempt === 1 ? opts.input : opts.input + RETRY_NUDGE,
        jsonSchema: opts.jsonSchema,
      });
      text = res.text;
      usage = res.usage;
    } catch {
      // A provider error is NOT retried. Rule 9's retry is specifically
      // retry-on-malformed; re-dispatching into an outage just spends a second
      // call from the user's cap to fail the same way. Still metered: the
      // provider counted that request even though we got nothing back.
      await safeMeter(meter, {
        userId: opts.userId,
        route: opts.route,
        tier: opts.tier,
        model,
        usage: EMPTY_USAGE,
        status: "error",
        attempts: attempt,
        latencyMs: Date.now() - startedAt,
      });
      return { ok: false, reason: "provider", attempts: attempt };
    }

    const parsed = extractJson(text);
    const data = parsed === null ? null : opts.validate(parsed);
    const latencyMs = Date.now() - startedAt;

    await safeMeter(meter, {
      userId: opts.userId,
      route: opts.route,
      tier: opts.tier,
      model,
      usage,
      status: data === null ? "invalid" : "ok",
      attempts: attempt,
      latencyMs,
    });

    if (data !== null) return { ok: true, data, usage, model, attempts: attempt };
  }

  // Both attempts came back unusable. The caller now falls back to seeded
  // content — the user gets a working roadmap and never learns the model failed,
  // except through the honest source label the UI shows.
  return { ok: false, reason: "invalid", attempts: attempt };
}

/**
 * Metering must never take down a request that otherwise succeeded. A dropped
 * usage row costs us one row of analytics; a thrown insert would cost the user
 * the roadmap they just waited for.
 */
async function safeMeter(meter: (row: MeterRow) => Promise<void>, row: MeterRow) {
  try {
    await meter(row);
  } catch {
    // Intentionally swallowed — see above.
  }
}

/** How many calls this user has left today. Powers the /usage readout. */
export async function remainingCallsToday(userId: string): Promise<number> {
  const used = await countTodayFromDb(userId);
  if (!Number.isFinite(used)) return 0;
  return Math.max(0, DAILY_CALL_CAP - used);
}
