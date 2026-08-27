import { describe, expect, it } from "vitest";
import { complete, extractJson, startOfUtcDay, type MeterRow } from "@/lib/ai/gateway";
import { DAILY_CALL_CAP } from "@/lib/ai/config";
import { RETRY_NUDGE } from "@/lib/ai/prompts";
import type { Provider } from "@/lib/ai/types";

// The gateway's cap / retry / metering logic, tested against a fake provider —
// no network, no database, no clock. Everything interesting here is a rule the
// product must guarantee (Rules 3, 9, 11), and a rule you can only exercise by
// getting a real model to misbehave is a rule you will never actually test.

type Recorded = { system: string; input: string };

/** A provider that returns a scripted sequence of responses, and records what it was sent. */
function fakeProvider(script: (string | Error)[]): Provider & { sent: Recorded[] } {
  const sent: Recorded[] = [];
  let i = 0;
  return {
    name: "fake",
    sent,
    async complete({ system, input }) {
      sent.push({ system, input });
      const next = script[Math.min(i, script.length - 1)];
      i += 1;
      if (next instanceof Error) throw next;
      return {
        text: next,
        usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 20 },
      };
    },
    // Required by the Provider interface since Phase 4.5. Unused by these
    // completion tests; the embedding path has its own fakes in ai-embed.test.ts.
    async embed({ dimensions }) {
      return {
        vector: new Array(dimensions).fill(0),
        usage: { inputTokens: 10, outputTokens: 0, cachedInputTokens: 0 },
      };
    },
  };
}

const VALID = JSON.stringify({ value: "good" });
const MALFORMED = JSON.stringify({ nope: true });

/** Accepts only the exact valid payload — stands in for a real schema validator. */
const validate = (raw: unknown) =>
  (raw as { value?: string })?.value === "good" ? { value: "good" } : null;

function harness(script: (string | Error)[], used = 0) {
  const provider = fakeProvider(script);
  const metered: MeterRow[] = [];
  return {
    provider,
    metered,
    run: () =>
      complete(
        {
          tier: "reasoning",
          route: "/api/test",
          userId: "user-1",
          system: "SYSTEM SCAFFOLD",
          input: "INPUT",
          validate,
        },
        {
          provider,
          model: "gemini-3.5-flash",
          countToday: async () => used,
          meter: async (row) => {
            metered.push(row);
          },
        }
      ),
  };
}

describe("complete — happy path", () => {
  it("returns validated data and meters exactly one dispatch", async () => {
    const h = harness([VALID]);
    const res = await h.run();

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual({ value: "good" });
    expect(res.attempts).toBe(1);
    expect(h.provider.sent).toHaveLength(1);

    expect(h.metered).toHaveLength(1);
    expect(h.metered[0]).toMatchObject({
      userId: "user-1",
      route: "/api/test",
      tier: "reasoning",
      model: "gemini-3.5-flash",
      status: "ok",
      attempts: 1,
    });
    expect(h.metered[0].usage.inputTokens).toBe(100);
    expect(h.metered[0].usage.cachedInputTokens).toBe(20);
  });
});

describe("complete — retry on malformed (Rule 9)", () => {
  it("retries once and succeeds, metering BOTH dispatches", async () => {
    const h = harness([MALFORMED, VALID]);
    const res = await h.run();

    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
    // Two provider calls happened, so two rows exist. Metering only the success
    // would under-count the cap exactly when a flaky model is burning the most.
    expect(h.metered.map((m) => m.status)).toEqual(["invalid", "ok"]);
    expect(h.metered.map((m) => m.attempts)).toEqual([1, 2]);
  });

  it("puts the retry nudge in the INPUT and leaves the system prompt byte-identical", async () => {
    // Rule 10: the cached prefix is the system string. Rewriting it on retry
    // would make the retry cost more than the call it is retrying.
    const h = harness([MALFORMED, VALID]);
    await h.run();

    expect(h.provider.sent[0].system).toBe(h.provider.sent[1].system);
    expect(h.provider.sent[0].input).toBe("INPUT");
    expect(h.provider.sent[1].input).toBe("INPUT" + RETRY_NUDGE);
  });

  it("gives up after two malformed responses so the caller can fall back", async () => {
    const h = harness([MALFORMED, MALFORMED]);
    const res = await h.run();

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("invalid");
    expect(res.attempts).toBe(2);
    expect(h.provider.sent).toHaveLength(2); // and no third try
    expect(h.metered.map((m) => m.status)).toEqual(["invalid", "invalid"]);
  });

  it("treats unparseable text as malformed rather than throwing", async () => {
    const h = harness(["Sure! Here's your roadmap:", VALID]);
    const res = await h.run();
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
  });
});

describe("complete — provider failure", () => {
  it("does NOT retry an outage, and still meters the dispatch", async () => {
    const h = harness([new Error("503"), VALID]);
    const res = await h.run();

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("provider");
    // Rule 9's retry is retry-on-MALFORMED. Re-dispatching into an outage just
    // spends a second call from the user's cap to fail the same way.
    expect(h.provider.sent).toHaveLength(1);
    expect(h.metered).toHaveLength(1);
    expect(h.metered[0].status).toBe("error");
    expect(h.metered[0].usage.inputTokens).toBe(0);
  });

  it("never throws — an AI failure is a return value, not an exception", async () => {
    const h = harness([new Error("boom")]);
    await expect(h.run()).resolves.toBeDefined();
  });
});

describe("complete — the daily cap (Rule 3)", () => {
  it("refuses before dispatch when the cap is already spent", async () => {
    const h = harness([VALID], DAILY_CALL_CAP);
    const res = await h.run();

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("cap");
    // The point of a pre-dispatch check: nothing was sent and nothing was billed.
    expect(h.provider.sent).toHaveLength(0);
    expect(h.metered).toHaveLength(0);
  });

  it("allows the very last call at the boundary", async () => {
    const h = harness([VALID], DAILY_CALL_CAP - 1);
    const res = await h.run();
    expect(res.ok).toBe(true);
  });

  // The subtle one: a malformed first response must not let a user standing on
  // the cap boundary step over it via the retry.
  it("blocks the RETRY when the retry would exceed the cap", async () => {
    const h = harness([MALFORMED, VALID], DAILY_CALL_CAP - 1);
    const res = await h.run();

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("cap");
    expect(res.attempts).toBe(1);
    expect(h.provider.sent).toHaveLength(1); // the retry never went out
    expect(h.metered).toHaveLength(1);
  });

  // Fail CLOSED: if we can't prove the user is under their cap, we don't dispatch.
  it("refuses when the usage count is unavailable", async () => {
    const provider = fakeProvider([VALID]);
    const res = await complete(
      {
        tier: "reasoning",
        route: "/api/test",
        userId: "user-1",
        system: "S",
        input: "I",
        validate,
      },
      { provider, countToday: async () => Number.POSITIVE_INFINITY, meter: async () => {} }
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("cap");
    expect(provider.sent).toHaveLength(0);
  });
});

describe("complete — no provider configured", () => {
  it("reports 'disabled' without metering anything", async () => {
    const metered: MeterRow[] = [];
    const res = await complete(
      { tier: "reasoning", route: "/api/test", userId: "u", system: "S", input: "I", validate },
      { provider: null, countToday: async () => 0, meter: async (r) => void metered.push(r) }
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("disabled");
    expect(metered).toHaveLength(0);
  });
});

describe("complete — metering must never break the request", () => {
  it("still returns the data when the usage insert throws", async () => {
    const provider = fakeProvider([VALID]);
    const res = await complete(
      { tier: "reasoning", route: "/api/test", userId: "u", system: "S", input: "I", validate },
      {
        provider,
        countToday: async () => 0,
        meter: async () => {
          throw new Error("usage table unreachable");
        },
      }
    );
    // A dropped analytics row costs us a row. A thrown insert would cost the
    // user the roadmap they just waited for.
    expect(res.ok).toBe(true);
  });
});

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  // Fenced output is a formatting quirk, not a schema failure — spending a retry
  // on it would waste a call from the user's cap.
  it("unwraps ```json fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("tolerates surrounding whitespace", () => {
    expect(extractJson('   {"a":1}\n\n')).toEqual({ a: 1 });
  });

  it("returns null for prose", () => {
    expect(extractJson("I'd be happy to help!")).toBeNull();
  });

  it("returns null for truncated JSON", () => {
    expect(extractJson('{"a":')).toBeNull();
  });
});

describe("startOfUtcDay", () => {
  // Rule 15: the cap window is UTC, like every other date in this project.
  it("floors to midnight UTC regardless of local time", () => {
    const d = startOfUtcDay(new Date("2026-08-08T23:45:12.500Z"));
    expect(d.toISOString()).toBe("2026-08-08T00:00:00.000Z");
  });

  it("does not roll back a timestamp already at midnight", () => {
    const d = startOfUtcDay(new Date("2026-08-08T00:00:00.000Z"));
    expect(d.toISOString()).toBe("2026-08-08T00:00:00.000Z");
  });
});
