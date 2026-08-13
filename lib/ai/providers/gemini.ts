// The Gemini provider adapter — the ONLY file that knows Gemini's wire format.
//
// Rule 7 in practice: this implements the vendor-neutral `Provider` interface
// and nothing above it (the gateway, the routes, the screens) imports anything
// from here or knows this API exists. Swapping providers means writing a sibling
// file and changing one line in lib/ai/index.ts.
//
// Deliberately raw `fetch` rather than @google/genai. The SDK would buy us
// retries and types we already own, and would put a vendor package one import
// away from product code — which is the spread Rule 7 exists to prevent. The
// request is one POST with a JSON body; that is not worth a dependency.

import { REQUEST_TIMEOUT_MS } from "../config";
import type { JsonSchema, Provider, ProviderResponse } from "../types";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Gemini's `responseSchema` is OpenAPI-flavoured and wants UPPERCASE type names,
 * so the neutral JsonSchema this project passes around is translated at the
 * boundary. Keeping the translation here (rather than authoring Gemini-shaped
 * schemas in lib/ai/validate.ts) is what stops the vendor's dialect leaking into
 * the code that defines what a valid roadmap is.
 */
function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: schema.type.toUpperCase() };
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)])
    );
    // Gemini honours propertyOrdering for deterministic key order, which also
    // makes the model's output easier to eyeball in the QA pass.
    out.propertyOrdering = Object.keys(schema.properties);
  }
  if (schema.required) out.required = schema.required;
  return out;
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  error?: { code?: number; message?: string; status?: string };
};

export function createGeminiProvider(apiKey: string): Provider {
  return {
    name: "gemini",

    async complete({ model, system, input, jsonSchema }): Promise<ProviderResponse> {
      // Rule 15-adjacent discipline: never let a hung provider hold a request
      // open. Past the budget we abort and the gateway takes the fallback path,
      // which is strictly better for the user than a spinner that never ends.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const res = await fetch(`${ENDPOINT}/${model}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            // Rule 10: the fixed scaffolding goes in systemInstruction, byte-identical
            // across calls of the same kind. Gemini's implicit prompt caching keys on
            // a stable leading prefix, so holding this constant is what makes a cache
            // hit possible at all — and cachedContentTokenCount below is how we prove
            // it happened rather than assuming it.
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: input }] }],
            generationConfig: {
              // Structured output at the provider level. This is the FIRST line of
              // defence, not the only one: lib/ai/validate.ts re-checks everything,
              // because "the provider promised JSON" is not the same as "this is a
              // roadmap my database can accept".
              ...(jsonSchema
                ? {
                    responseMimeType: "application/json",
                    responseSchema: toGeminiSchema(jsonSchema),
                  }
                : {}),
              temperature: 0.7,
            },
          }),
        });

        const body = (await res.json().catch(() => null)) as GeminiResponse | null;

        if (!res.ok) {
          // Surface the provider's own words. The 429 that opened this phase said
          // "prepayment credits are depleted", which is a billing state, not a rate
          // limit — a generic "provider error" would have sent us debugging our code.
          const msg = body?.error?.message ?? `HTTP ${res.status}`;
          throw new Error(`gemini ${res.status}: ${msg}`);
        }

        const text = body?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        const u = body?.usageMetadata ?? {};

        return {
          text,
          usage: {
            inputTokens: u.promptTokenCount ?? 0,
            outputTokens: u.candidatesTokenCount ?? 0,
            // Gemini reports cached tokens as a subset of promptTokenCount, which
            // is the convention lib/ai/cost.ts assumes. Absent field = no hit.
            cachedInputTokens: u.cachedContentTokenCount ?? 0,
          },
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
