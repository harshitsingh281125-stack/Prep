// The Groq provider adapter — the ONLY file that knows Groq's wire format.
//
// Phase 6.1. Sibling of gemini.ts, and deliberately shaped like it: raw `fetch`
// rather than an SDK, all vendor dialect translated at this boundary, nothing
// above it aware this API exists.
//
// It implements CompletionProvider and NOT Provider, and that is the honest
// part: Groq has no embeddings endpoint (confirmed against its own models.list —
// 14 models, every one chat, speech or safety). The type system now says so, so
// the embedding tier can never be routed here by accident. See ../types.ts.

import { GROQ_REASONING_EFFORT, REQUEST_TIMEOUT_MS } from "../config";
import type { CompletionProvider, JsonSchema, ProviderResponse } from "../types";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Groq's structured-output dialect. Three differences from Gemini's, all
 * verified against the live API rather than read off a docs page:
 *
 *   - lowercase JSON-Schema type names (Gemini's OpenAPI flavour wants UPPER);
 *   - `strict: true` needs `additionalProperties: false` on every object;
 *   - `strict: true` needs EVERY property listed in `required`.
 *
 * The last two are why this can't just pass our neutral JsonSchema through: it
 * has no additionalProperties field, and its `required` lists only the fields
 * the validator insists on. Both are injected here. That is safe because the
 * neutral schemas have no optional properties — if one ever gains an optional
 * field, this function would silently make it mandatory, so the unit test in
 * tests/unit/ai-groq.test.ts pins the translation.
 */
export function toGroqSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: schema.type };
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.items) out.items = toGroqSchema(schema.items);
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, toGroqSchema(v)])
    );
    out.required = Object.keys(schema.properties);
    out.additionalProperties = false;
  }
  return out;
}

type GroqResponse = {
  choices?: { message?: { content?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string; type?: string };
};

export function createGroqProvider(apiKey: string): CompletionProvider {
  return {
    name: "groq",

    async complete({ model, system, input, jsonSchema }): Promise<ProviderResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            // Same cache-shaped discipline as the Gemini adapter even though Groq
            // has no prompt cache to hit: the system string stays byte-identical
            // across calls of a kind, so the two providers are being compared on
            // the same input rather than on two differently-assembled prompts.
            messages: [
              { role: "system", content: system },
              { role: "user", content: input },
            ],
            temperature: 0.7,
            // MEASURED, not guessed — see GROQ_REASONING_EFFORT in ../config.ts.
            reasoning_effort: GROQ_REASONING_EFFORT,
            ...(jsonSchema
              ? {
                  response_format: {
                    type: "json_schema",
                    json_schema: {
                      name: "prep_output",
                      strict: true,
                      schema: toGroqSchema(jsonSchema),
                    },
                  },
                }
              : {}),
          }),
        });

        const body = (await res.json().catch(() => null)) as GroqResponse | null;

        if (!res.ok) {
          // Surface the provider's own words, for the same reason gemini.ts does:
          // a rate-limit, a bad model id and a depleted account are three
          // different problems wearing the same status code.
          const msg = body?.error?.message ?? `HTTP ${res.status}`;
          throw new Error(`groq ${res.status}: ${msg}`);
        }

        const u = body?.usage ?? {};

        return {
          text: body?.choices?.[0]?.message?.content ?? "",
          usage: {
            inputTokens: u.prompt_tokens ?? 0,
            // completion_tokens INCLUDES the model's invisible reasoning tokens
            // (measured at ~11% of output at reasoning_effort 'low', and 84% at
            // 'high'). Recording the total rather than the visible remainder is
            // deliberate: it is what Groq bills, and lib/ai/cost.ts exists to say
            // what a call really costs. Netting the reasoning out would make the
            // cheaper-looking number the false one.
            outputTokens: u.completion_tokens ?? 0,
            // Groq does no prompt caching — there is no cached-token field on the
            // response at all (the only sub-object is completion_tokens_details,
            // which carries reasoning_tokens). A hard 0, stated rather than
            // implied, and cost.ts treats these rows as non-caching so they can't
            // dilute Gemini's cache hit-rate.
            cachedInputTokens: 0,
          },
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
