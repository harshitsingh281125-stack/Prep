import { describe, expect, it } from "vitest";
import { buildRetrievalQuery } from "@/lib/rag/query";
import { matchResources } from "@/lib/rag/retrieve";
import { RAG_TOP_K } from "@/lib/ai/config";
import {
  GROUNDED_LIMITS,
  validateGroundedDetail,
  type GroundingDoc,
} from "@/lib/ai/validate";

// The RAG pipeline's pure parts (Phase 4.5). The interesting one by far is
// validateGroundedDetail — it is the component that turns a model's citation
// into a link, and therefore the component where a hallucinated URL would have
// to get through if it were going to get through anywhere.

// --- the retrieval query ---------------------------------------------------

describe("buildRetrievalQuery", () => {
  it("combines the topic with its week for context", () => {
    expect(
      buildRetrievalQuery({ topicName: "Concurrent features", weekTitle: "React Internals" })
    ).toBe("Concurrent features. React Internals.");
  });

  it("omits the week placeholder rather than embedding a stray dash", () => {
    // "—" is what the route passes when a topic has no week row.
    expect(buildRetrievalQuery({ topicName: "Closures & scope", weekTitle: "—" })).toBe(
      "Closures & scope."
    );
  });

  it("omits an empty week", () => {
    expect(buildRetrievalQuery({ topicName: "Event loop", weekTitle: "   " })).toBe(
      "Event loop."
    );
  });

  it("trims, so a stored name with whitespace doesn't shift the vector", () => {
    expect(
      buildRetrievalQuery({ topicName: "  Reflow vs repaint  ", weekTitle: " Browser " })
    ).toBe("Reflow vs repaint. Browser.");
  });

  it("does NOT include the roadmap title", () => {
    // Deliberate: roadmap titles are model-written plan names full of words
    // ("weeks", "plan", "senior") that appear in no technical document, so they
    // pull the query vector away from the corpus without adding subject signal.
    // Pinned as a test because it is the kind of thing a later change would
    // "helpfully" add back.
    const q = buildRetrievalQuery({ topicName: "Virtualized list", weekTitle: "Coding" });
    expect(q).not.toMatch(/plan|roadmap|weeks/i);
  });
});

// --- the corpus search -----------------------------------------------------

function fakeRpc(result: { data: unknown; error: unknown }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    client: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return result;
      },
    },
  };
}

const ROW = {
  id: "r1",
  topic_area: "react",
  title: "react.dev: Preserving and Resetting State",
  url: "https://react.dev/learn/preserving-and-resetting-state",
  kind: "doc",
  summary: "How React decides whether to keep or discard state.",
  similarity: 0.81,
};

describe("matchResources", () => {
  it("calls the SQL function with the top-k and the similarity floor", async () => {
    const { client, calls } = fakeRpc({ data: [ROW], error: null });
    await matchResources(client, [0.1, 0.2, 0.3]);

    expect(calls[0].fn).toBe("match_resources");
    expect(calls[0].args.match_count).toBe(RAG_TOP_K);
    expect(typeof calls[0].args.min_similarity).toBe("number");
  });

  it("sends the vector in pgvector's own text format", () => {
    // Not as a JS array: sending the literal removes any question about how
    // PostgREST serialises it before Postgres casts it to `vector`.
    const { client, calls } = fakeRpc({ data: [], error: null });
    return matchResources(client, [0.5, -0.25]).then(() => {
      expect(calls[0].args.query_embedding).toBe("[0.5,-0.25]");
    });
  });

  it("maps snake_case rows onto the app's shape", async () => {
    const { client } = fakeRpc({ data: [ROW], error: null });
    const docs = await matchResources(client, [0.1]);

    expect(docs).toEqual([
      {
        id: "r1",
        topicArea: "react",
        title: ROW.title,
        url: ROW.url,
        kind: "doc",
        summary: ROW.summary,
        similarity: 0.81,
      },
    ]);
  });

  it("returns [] when the search errors, so RAG cannot hard-block a topic", async () => {
    // Rule 9. An unreachable corpus and an empty corpus are the same situation
    // from the user's seat: generate ungrounded, flag the resources unverified.
    const { client } = fakeRpc({ data: null, error: { message: "relation missing" } });
    expect(await matchResources(client, [0.1])).toEqual([]);
  });

  it("returns [] when the function returns a non-array", async () => {
    const { client } = fakeRpc({ data: { unexpected: true }, error: null });
    expect(await matchResources(client, [0.1])).toEqual([]);
  });
});

// --- the grounding validator (the one that matters) ------------------------

const DOCS: GroundingDoc[] = [
  {
    title: "react.dev: Preserving and Resetting State",
    url: "https://react.dev/learn/preserving-and-resetting-state",
    kind: "doc",
  },
  {
    title: "react.dev: You Might Not Need an Effect",
    url: "https://react.dev/learn/you-might-not-need-an-effect",
    kind: "deep",
  },
  {
    title: "Jake Archibald — In The Loop",
    url: "https://www.youtube.com/watch?v=cCOL7MC4Pl0",
    kind: "talk",
  },
];

const GOOD_MODEL =
  "React never diffs the real DOM — it diffs its own element trees, and the key is the only handle you give it to match elements across a reorder.";

function grounded(overrides: Record<string, unknown> = {}) {
  return {
    model: GOOD_MODEL,
    resources: [{ ref: 1, why: "the primary reference on state identity" }],
    exercises: [
      { title: "Explain it cold", desc: "Say it in 90 seconds with no notes." },
      { title: "Break it", desc: "Reproduce the index-key bug, then fix it." },
    ],
    ...overrides,
  };
}

describe("validateGroundedDetail — the link never comes from the model", () => {
  it("takes title, url and tag from the corpus row, not from the response", () => {
    const detail = validateGroundedDetail(grounded(), DOCS);
    expect(detail).not.toBeNull();
    expect(detail!.resources[0].title).toBe(DOCS[0].title);
    expect(detail!.resources[0].url).toBe(DOCS[0].url);
    expect(detail!.resources[0].tag).toBe("Docs");
  });

  it("ignores a title or url the model tried to supply anyway", () => {
    // The schema has no such fields, but a model can always return extra keys.
    // The point is that they are not READ, so a hallucinated link has no path
    // into stored data even if the model volunteers one.
    const detail = validateGroundedDetail(
      grounded({
        resources: [
          {
            ref: 1,
            why: "good",
            title: "A Book That Does Not Exist",
            url: "https://example.invalid/made-up",
          },
        ],
      }),
      DOCS
    );
    expect(detail!.resources[0].url).toBe(DOCS[0].url);
    expect(detail!.resources[0].title).toBe(DOCS[0].title);
  });

  it("marks grounded resources as verified by omitting the unverified flag", () => {
    const detail = validateGroundedDetail(grounded(), DOCS);
    expect(detail!.resources[0].unverified).toBeUndefined();
    expect(detail!.source).toBe("rag");
  });

  it("puts the source host in the meta line, alongside the model's reason", () => {
    const detail = validateGroundedDetail(grounded(), DOCS);
    expect(detail!.resources[0].meta).toBe(
      "react.dev · the primary reference on state identity"
    );
  });

  it("maps every corpus kind onto a chip the Topic screen renders", () => {
    const detail = validateGroundedDetail(
      grounded({
        resources: [
          { ref: 1, why: "a" },
          { ref: 2, why: "b" },
          { ref: 3, why: "c" },
        ],
      }),
      DOCS
    );
    expect(detail!.resources.map((r) => r.tag)).toEqual(["Docs", "Deep", "Talk"]);
  });
});

describe("validateGroundedDetail — real-length model output (regression)", () => {
  // VERBATIM from a live gemini-3.5-flash response, 2026-08-13. The original
  // whyMax of 90 rejected all three of these, so every grounded generation fell
  // through to the ungrounded path and the feature was 100% broken against the
  // real provider — while the unit suite and the E2E suite were both green,
  // because their fixtures used short strings I had written myself.
  const REAL_WHYS = [
    "Provides the definitive, interactive step-by-step execution trace demonstrating how microtasks completely exhaust their queue before the loop proceeds to the next macrotask, clearing up common edge cases with nested queues.",
    "Offers the best visual explanation of the rendering pipeline's relationship with the event loop, showing exactly where requestAnimationFrame and style/layout calculations execute relative to tasks and microtasks.",
    "Translates event loop theory into production engineering by detailing how to break up long tasks, yield to the main thread, and use modern APIs like scheduler.yield to prevent UI responsiveness degradation.",
  ];

  it("accepts captions of the length the model actually writes", () => {
    const detail = validateGroundedDetail(
      grounded({ resources: REAL_WHYS.map((why, i) => ({ ref: i + 1, why })) }),
      DOCS
    );
    // The bug: this was null. A vetted link must not be thrown away because its
    // decorative caption was thirty characters longer than I guessed.
    expect(detail).not.toBeNull();
    expect(detail!.resources).toHaveLength(3);
    expect(detail!.resources.every((r) => Boolean(r.url))).toBe(true);
  });

  it("condenses a long caption to fit the resource row, on a word boundary", () => {
    const detail = validateGroundedDetail(
      grounded({ resources: [{ ref: 1, why: REAL_WHYS[0] }] }),
      DOCS
    );
    const meta = detail!.resources[0].meta;

    expect(meta.startsWith("react.dev · ")).toBe(true);
    expect(meta.length).toBeLessThanOrEqual(
      "react.dev · ".length + GROUNDED_LIMITS.whyDisplayMax + 1
    );
    expect(meta.endsWith("…")).toBe(true);
    // Cut on a word boundary — a caption ending mid-word reads as a render bug.
    expect(meta).not.toMatch(/\s…$/);
    expect(meta.slice(0, -1)).toBe(meta.slice(0, -1).trimEnd());
  });

  it("leaves a caption that already fits completely untouched", () => {
    const detail = validateGroundedDetail(
      grounded({ resources: [{ ref: 1, why: "the canonical reference on state identity" }] }),
      DOCS
    );
    expect(detail!.resources[0].meta).toBe(
      "react.dev · the canonical reference on state identity"
    );
  });
});

describe("validateGroundedDetail — rejections", () => {
  it("rejects a reference past the end of the supplied list", () => {
    // Not clamped to the last document: a model citing #9 of 3 has misunderstood
    // the task, and silently reading that as #3 would hand the user a link for a
    // reason the model never gave about it.
    expect(validateGroundedDetail(grounded({ resources: [{ ref: 9, why: "x" }] }), DOCS))
      .toBeNull();
  });

  it("rejects a zero or negative reference", () => {
    expect(validateGroundedDetail(grounded({ resources: [{ ref: 0, why: "x" }] }), DOCS)).toBeNull();
    expect(validateGroundedDetail(grounded({ resources: [{ ref: -1, why: "x" }] }), DOCS)).toBeNull();
  });

  it("rejects a non-integer reference", () => {
    expect(validateGroundedDetail(grounded({ resources: [{ ref: 1.5, why: "x" }] }), DOCS)).toBeNull();
    expect(validateGroundedDetail(grounded({ resources: [{ ref: "1", why: "x" }] }), DOCS)).toBeNull();
  });

  it("rejects the same document cited twice", () => {
    // One document occupying two slots of a ranked list is the duplication the
    // corpus's `url unique` constraint prevents at curation time.
    expect(
      validateGroundedDetail(
        grounded({ resources: [{ ref: 2, why: "a" }, { ref: 2, why: "b" }] }),
        DOCS
      )
    ).toBeNull();
  });

  it("rejects more references than documents supplied", () => {
    const one = [DOCS[0]];
    expect(
      validateGroundedDetail(
        grounded({ resources: [{ ref: 1, why: "a" }, { ref: 1, why: "b" }] }),
        one
      )
    ).toBeNull();
  });

  // NOT a rejection — this used to be one, and that was the bug. See below.
  it("ACCEPTS an empty selection: the model declining every document is an answer", () => {
    // Regression. The prompt tells the model to be selective ("never pad the
    // list"), so when retrieval surfaced one marginal document for "Monorepo vs
    // Polyrepo strategies" the model correctly returned zero resources — and the
    // validator threw the whole generation away, burned a retry getting the same
    // honest answer, and metered both as `invalid`. Instructing a model to
    // exercise judgement and then treating its judgement as malformed output is
    // a contradiction in the design.
    const detail = validateGroundedDetail(grounded({ resources: [] }), DOCS);
    expect(detail).not.toBeNull();
    expect(detail!.resources).toHaveLength(0);
    // The ROUTE is what turns this into "fall back to ungrounded" — the
    // validator's job is only to say the response was well-formed.
  });

  it("rejects a missing 'why', or one so long the model answered a different question", () => {
    expect(validateGroundedDetail(grounded({ resources: [{ ref: 1 }] }), DOCS)).toBeNull();
    expect(
      validateGroundedDetail(
        grounded({ resources: [{ ref: 1, why: "x".repeat(GROUNDED_LIMITS.whyMax + 1) }] }),
        DOCS
      )
    ).toBeNull();
  });

  it("rejects a corpus kind it has no chip for, rather than guessing one", () => {
    // A kind this map doesn't know means the corpus and the app have drifted.
    // That is our bug; guessing a tag would hide it behind plausible output.
    const odd: GroundingDoc[] = [{ title: "t", url: "https://x.test/a", kind: "podcast" }];
    expect(validateGroundedDetail(grounded(), odd)).toBeNull();
  });

  it("returns null when there were no documents at all", () => {
    // The route never calls it in this state, but a validator that "succeeds"
    // with nothing to ground would be a silent path to resource-less detail.
    expect(validateGroundedDetail(grounded(), [])).toBeNull();
  });

  it("still enforces the ungrounded rules on model and exercises", () => {
    expect(validateGroundedDetail(grounded({ model: "too short" }), DOCS)).toBeNull();
    expect(validateGroundedDetail(grounded({ exercises: [] }), DOCS)).toBeNull();
    expect(validateGroundedDetail(grounded({ exercises: [{ title: "t" }] }), DOCS)).toBeNull();
  });

  it("rejects a non-object payload", () => {
    expect(validateGroundedDetail(null, DOCS)).toBeNull();
    expect(validateGroundedDetail([1, 2], DOCS)).toBeNull();
    expect(validateGroundedDetail("nope", DOCS)).toBeNull();
  });
});
