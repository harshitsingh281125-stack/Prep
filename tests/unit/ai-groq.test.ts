import { afterEach, describe, expect, it } from "vitest";
import { toGroqSchema } from "@/lib/ai/providers/groq";
import {
  GROQ_MODELS,
  GROQ_REASONING_EFFORT,
  MODELS,
  PRICING,
  completionModelFor,
  failoverFor,
  providerName,
} from "@/lib/ai/config";
import { ROADMAP_SCHEMA } from "@/lib/ai/validate";
import { cachesPrompts } from "@/lib/ai/cost";

// Phase 6.1 — the second provider's vendor translation and the routing policy
// around it. None of this touches the network: the wire format is a pure
// function, and the policy is pure env → decision.

const ENV_KEYS = ["AI_PROVIDER", "AI_FAILOVER", "GEMINI_API_KEY", "GROQ_API_KEY"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function setEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const k of ENV_KEYS) {
    if (k in env) {
      const v = env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("toGroqSchema — the vendor dialect translation", () => {
  it("lowercases types, unlike Gemini's OpenAPI flavour", () => {
    const out = toGroqSchema({ type: "object", properties: { a: { type: "string" } } });
    expect(out.type).toBe("object");
    expect((out.properties as Record<string, { type: string }>).a.type).toBe("string");
  });

  it("injects additionalProperties:false on every object, at every depth", () => {
    const out = toGroqSchema(ROADMAP_SCHEMA);
    expect(out.additionalProperties).toBe(false);
    const weeks = (out.properties as Record<string, Record<string, unknown>>).weeks;
    const weekItem = weeks.items as Record<string, unknown>;
    // strict:true is rejected by Groq if a nested object omits this — the
    // roadmap schema is two objects deep, so the recursion is the thing to pin.
    expect(weekItem.additionalProperties).toBe(false);
  });

  it("promotes EVERY property to required, not just the validator's list", () => {
    // The neutral schema's `required` is what OUR validator insists on; Groq's
    // strict mode demands all of them. This is the one place the translation
    // deliberately says something stronger than the source schema does.
    const out = toGroqSchema({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "string" } },
      required: ["a"],
    });
    expect(out.required).toEqual(["a", "b"]);
  });

  it("carries enum and description through untouched", () => {
    const out = toGroqSchema({ type: "string", enum: ["Docs", "Deep"], description: "tag" });
    expect(out.enum).toEqual(["Docs", "Deep"]);
    expect(out.description).toBe("tag");
  });

  it("recurses into array items", () => {
    const out = toGroqSchema({ type: "array", items: { type: "string" } });
    expect((out.items as { type: string }).type).toBe("string");
  });
});

describe("failoverFor — the routing policy", () => {
  it("NEVER fails over from the mock provider", () => {
    // The load-bearing one. The E2E suite drives Rule 9's outage path with
    // AI_MOCK_MODE=error; if mock could fail over to a real network provider,
    // every one of those specs would go green for the wrong reason.
    setEnv({ GROQ_API_KEY: "gsk_test" });
    expect(failoverFor("mock")).toBeNull();
  });

  it("fails over from gemini to groq when a groq key exists", () => {
    setEnv({ GROQ_API_KEY: "gsk_test", AI_FAILOVER: undefined });
    expect(failoverFor("gemini")).toBe("groq");
  });

  it("has nowhere to go when there is no groq key", () => {
    setEnv({ GROQ_API_KEY: undefined, AI_FAILOVER: undefined });
    expect(failoverFor("gemini")).toBeNull();
  });

  it("is switched off entirely by AI_FAILOVER=off", () => {
    setEnv({ GROQ_API_KEY: "gsk_test", AI_FAILOVER: "off" });
    expect(failoverFor("gemini")).toBeNull();
  });

  it("does not chain groq onward to gemini", () => {
    setEnv({ GEMINI_API_KEY: "g", GROQ_API_KEY: "gsk_test", AI_FAILOVER: undefined });
    expect(failoverFor("groq")).toBeNull();
  });

  it("has nowhere to go from 'none'", () => {
    setEnv({ GROQ_API_KEY: "gsk_test" });
    expect(failoverFor("none")).toBeNull();
  });
});

describe("providerName — selection precedence", () => {
  it("AI_PROVIDER=mock always wins", () => {
    setEnv({ AI_PROVIDER: "mock", GEMINI_API_KEY: "g", GROQ_API_KEY: "gsk" });
    expect(providerName()).toBe("mock");
  });

  it("an explicit groq request without a key reports 'none', never a silent gemini", () => {
    // Silently serving Gemini to someone who asked for Groq would make an A/B
    // comparison compare a model against itself.
    setEnv({ AI_PROVIDER: "groq", GROQ_API_KEY: undefined, GEMINI_API_KEY: "g" });
    expect(providerName()).toBe("none");
  });

  it("honours an explicit groq request when the key is present", () => {
    setEnv({ AI_PROVIDER: "groq", GROQ_API_KEY: "gsk", GEMINI_API_KEY: "g" });
    expect(providerName()).toBe("groq");
  });

  it("prefers gemini when both keys exist and nothing is forced", () => {
    setEnv({ AI_PROVIDER: undefined, GEMINI_API_KEY: "g", GROQ_API_KEY: "gsk" });
    expect(providerName()).toBe("gemini");
  });

  it("supports a groq-only deployment", () => {
    setEnv({ AI_PROVIDER: undefined, GEMINI_API_KEY: undefined, GROQ_API_KEY: "gsk" });
    expect(providerName()).toBe("groq");
  });

  it("reports 'none' with no keys at all", () => {
    setEnv({ AI_PROVIDER: undefined, GEMINI_API_KEY: undefined, GROQ_API_KEY: undefined });
    expect(providerName()).toBe("none");
  });
});

describe("completionModelFor — tier bindings per provider", () => {
  it("maps each provider's tiers to its own model ids", () => {
    expect(completionModelFor("gemini", "reasoning")).toBe(MODELS.reasoning);
    expect(completionModelFor("gemini", "classification")).toBe(MODELS.classification);
    expect(completionModelFor("groq", "reasoning")).toBe(GROQ_MODELS.reasoning);
    expect(completionModelFor("groq", "classification")).toBe(GROQ_MODELS.classification);
    expect(completionModelFor("mock", "reasoning")).toBe("mock");
  });

  it("keeps the pricier model on the RARE call for groq too", () => {
    // The same cost-follows-volume reasoning as the Gemini map: roadmaps are
    // capped at 3/user, recall cards run on every topic.
    const rare = PRICING[GROQ_MODELS.reasoning];
    const frequent = PRICING[GROQ_MODELS.classification];
    expect(rare.outputPerM).toBeGreaterThan(frequent.outputPerM);
  });
});

describe("the rate card encodes Groq's lack of a prompt cache", () => {
  it("prices cached input identically to fresh input", () => {
    for (const model of Object.values(GROQ_MODELS)) {
      expect(PRICING[model].cachedInputPerM).toBe(PRICING[model].inputPerM);
    }
  });

  it("so cost.ts classifies gpt-oss as non-caching and gemini as caching", () => {
    expect(cachesPrompts(GROQ_MODELS.reasoning)).toBe(false);
    expect(cachesPrompts(GROQ_MODELS.classification)).toBe(false);
    expect(cachesPrompts(MODELS.reasoning)).toBe(true);
  });

  it("treats an unpriced model as non-caching rather than guessing", () => {
    expect(cachesPrompts("some-model-nobody-added-to-the-rate-card")).toBe(false);
  });
});

describe("reasoning effort is pinned to the measured setting", () => {
  it("is 'low' — all four settings passed the validator, so the cheapest wins", () => {
    expect(GROQ_REASONING_EFFORT).toBe("low");
  });
});
