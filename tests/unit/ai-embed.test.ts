import { describe, expect, it } from "vitest";
import { embed, type MeterRow } from "@/lib/ai/gateway";
import { DAILY_CALL_CAP, EMBEDDING_DIM } from "@/lib/ai/config";
import { createMockProvider } from "@/lib/ai/providers/mock";
import type { EmbedPurpose, Provider } from "@/lib/ai/types";

// The embedding half of the gateway (Phase 4.5), tested against fake providers —
// no network, no database. Same discipline as ai-gateway.test.ts: the rules the
// product must guarantee (Rules 3, 9, 11) are exercised here, because a rule you
// can only test by getting a real provider to misbehave is a rule you will never
// actually test.

type Sent = { input: string; purpose: EmbedPurpose; dimensions: number };

/** A provider whose embed() is scripted. `complete` is never called by these tests. */
function fakeProvider(
  behaviour: { width?: number } | Error
): Provider & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    name: "fake",
    sent,
    async complete() {
      throw new Error("complete() should not be called by an embedding test");
    },
    async embed({ input, purpose, dimensions }) {
      sent.push({ input, purpose, dimensions });
      if (behaviour instanceof Error) throw behaviour;
      const width = behaviour.width ?? dimensions;
      return {
        vector: new Array(width).fill(0.1),
        usage: { inputTokens: 42, outputTokens: 0, cachedInputTokens: 0 },
      };
    },
  };
}

function harness(behaviour: { width?: number } | Error, used = 0) {
  const provider = fakeProvider(behaviour);
  const metered: MeterRow[] = [];
  return {
    provider,
    metered,
    run: () =>
      embed(
        { route: "/api/test", userId: "user-1", input: "a topic", purpose: "query" },
        {
          provider,
          model: "gemini-embedding-001",
          countToday: async () => used,
          meter: async (row) => {
            metered.push(row);
          },
        }
      ),
  };
}

describe("gateway.embed — the happy path", () => {
  it("returns the vector and reports the model that served it", async () => {
    const h = harness({});
    const res = await h.run();

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.vector).toHaveLength(EMBEDDING_DIM);
    expect(res.model).toBe("gemini-embedding-001");
  });

  it("asks the provider for the width the pgvector column can actually hold", async () => {
    // The column is vector(1536) and pgvector cannot index anything above 2000,
    // so the width is not the model's default — it is a constraint the gateway
    // imposes. If these two ever disagree the corpus stops being writable.
    const h = harness({});
    await h.run();
    expect(h.provider.sent[0].dimensions).toBe(EMBEDDING_DIM);
  });

  it("passes the purpose through, because retrieval embeddings are asymmetric", async () => {
    const h = harness({});
    await h.run();
    expect(h.provider.sent[0].purpose).toBe("query");
  });

  it("writes exactly one ai_usage row, on the embedding tier (Rule 11)", async () => {
    const h = harness({});
    await h.run();

    expect(h.metered).toHaveLength(1);
    expect(h.metered[0].tier).toBe("embedding");
    expect(h.metered[0].status).toBe("ok");
    expect(h.metered[0].attempts).toBe(1);
    // An embedding generates no text. A non-zero output count here would inflate
    // the projected cost on /usage for tokens that were never produced.
    expect(h.metered[0].usage.outputTokens).toBe(0);
  });
});

describe("gateway.embed — the cap (Rule 3)", () => {
  it("refuses before dispatch when the cap is already spent", async () => {
    const h = harness({}, DAILY_CALL_CAP);
    const res = await h.run();

    expect(res).toEqual({ ok: false, reason: "cap" });
    // The important half: the provider was never called, so nothing was spent.
    expect(h.provider.sent).toHaveLength(0);
    // And nothing is metered, because nothing was dispatched.
    expect(h.metered).toHaveLength(0);
  });

  it("allows the very last call under the cap", async () => {
    const h = harness({}, DAILY_CALL_CAP - 1);
    const res = await h.run();
    expect(res.ok).toBe(true);
  });

  it("fails closed when the usage count is unreadable", async () => {
    // countTodayFromDb returns Infinity when it cannot read ai_usage. A DB blip
    // must degrade to "no retrieval", never to "an uncapped embedding endpoint".
    const provider = fakeProvider({});
    const res = await embed(
      { route: "/api/test", userId: "u", input: "x", purpose: "query" },
      { provider, countToday: async () => Number.POSITIVE_INFINITY, meter: async () => {} }
    );
    expect(res).toEqual({ ok: false, reason: "cap" });
    expect(provider.sent).toHaveLength(0);
  });
});

describe("gateway.embed — failures never throw (Rule 9)", () => {
  it("reports a provider outage as a value, and still meters it", async () => {
    const h = harness(new Error("simulated outage"));
    const res = await h.run();

    expect(res).toEqual({ ok: false, reason: "provider" });
    // The provider counted the request even though we got nothing usable back,
    // so the cap must count it too.
    expect(h.metered).toHaveLength(1);
    expect(h.metered[0].status).toBe("error");
  });

  it("rejects a vector of the wrong width rather than passing it to Postgres", async () => {
    const h = harness({ width: EMBEDDING_DIM - 1 });
    const res = await h.run();

    expect(res).toEqual({ ok: false, reason: "invalid" });
    expect(h.metered[0].status).toBe("invalid");
  });

  it("does NOT retry — unlike complete(), the failure is deterministic", async () => {
    // A malformed completion can succeed on a second attempt; a wrong-width
    // embedding is a config error that will reproduce exactly. Retrying would
    // spend a second call from the user's cap to fail identically.
    const h = harness({ width: 8 });
    await h.run();

    expect(h.provider.sent).toHaveLength(1);
    expect(h.metered).toHaveLength(1);
  });

  it("reports 'disabled' with no provider configured, and meters nothing", async () => {
    const metered: MeterRow[] = [];
    const res = await embed(
      { route: "/api/test", userId: "u", input: "x", purpose: "query" },
      { provider: null, countToday: async () => 0, meter: async (r) => void metered.push(r) }
    );
    expect(res).toEqual({ ok: false, reason: "disabled" });
    expect(metered).toHaveLength(0);
  });

  it("does not let a metering failure take down a successful embedding", async () => {
    const provider = fakeProvider({});
    const res = await embed(
      { route: "/api/test", userId: "u", input: "x", purpose: "query" },
      {
        provider,
        countToday: async () => 0,
        meter: async () => {
          throw new Error("usage insert failed");
        },
      }
    );
    // A dropped usage row costs a row of analytics; a thrown insert would cost
    // the user the topic they were waiting for.
    expect(res.ok).toBe(true);
  });
});

describe("the mock provider's embeddings", () => {
  const provider = createMockProvider();

  async function vec(text: string, dimensions = 64) {
    const { vector } = await provider.embed({
      model: "mock",
      input: text,
      purpose: "document",
      dimensions,
    });
    return vector;
  }

  const cosine = (a: number[], b: number[]) =>
    a.reduce((sum, v, i) => sum + v * b[i], 0);

  it("is deterministic — the same text always embeds identically", async () => {
    expect(await vec("event loop and microtasks")).toEqual(
      await vec("event loop and microtasks")
    );
  });

  it("returns unit-length vectors at the requested width", async () => {
    const v = await vec("closures and scope", 128);
    expect(v).toHaveLength(128);
    expect(Math.sqrt(cosine(v, v))).toBeCloseTo(1, 6);
  });

  it("scores overlapping text above unrelated text", async () => {
    // This is the property the mock exists for. A random-but-deterministic
    // embedding would make every pair near-orthogonal, every similarity ~0, and
    // the retrieval pipeline permanently untestable in the "hit" direction.
    const query = await vec("react reconciliation keys");
    const related = await vec("react reconciliation and keys explained in depth");
    const unrelated = await vec("behavioral interview star stories leadership");

    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });

  it("never returns the zero vector, whose cosine distance is undefined", async () => {
    // pgvector returns NaN for a zero vector and the ordering goes incoherent.
    const v = await vec("!!! ??");
    expect(Math.sqrt(cosine(v, v))).toBeCloseTo(1, 6);
  });
});
