import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { WebSocket as UndiciWebSocket } from "undici";
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as { WebSocket?: unknown }).WebSocket = UndiciWebSocket;
}

// scripts/probe-retrieval.ts — the calibration tool for the similarity floor.
//
//   npm run probe:retrieval
//
// Prints the top 5 corpus matches with raw similarities for a fixed set of
// topics, with NO floor applied, marking which ones the current floor would
// admit. Two jobs:
//
//   1. CALIBRATE THE FLOOR. This is how DEFAULT_RAG_MIN_SIMILARITY was set, and
//      how it must be re-set after any change to the embedding model, the
//      embedding width, or the corpus. The first guessed value (0.55) would have
//      grounded backend topics on React documentation, because Gemini
//      embeddings are not zero-centred — unrelated text scores ~0.55, so the
//      threshold has to be found by measuring the gap between the in-domain and
//      OFF-DOMAIN cases below, never by picking a number that sounds strict.
//
//   2. JUDGE RANKING QUALITY. No automated test asserts that the right document
//      comes first — the E2E suite runs on the mock provider, whose lexical
//      embeddings share no vector space with the corpus's real ones. Reading
//      this output is how a human checks that retrieval is actually good, and it
//      is what manual suite RAG (tests/phase-4.5-rag.md) asks you to run.
//
// The OFF-DOMAIN cases at the end of the list are the important ones: they are
// subjects from adjacent engineering disciplines this corpus deliberately does
// not cover, so every one of their scores must fall BELOW the floor. If any
// passes, the floor is too low and out-of-scope topics are being grounded on
// whatever happens to be nearest. KEEP THIS LIST IN STEP WITH THE CORPUS — see
// the note on OFF_DOMAIN below for the false alarm that happens when you do not.

import { embed } from "@/lib/ai/gateway";
import { ragMinSimilarity } from "@/lib/ai/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildRetrievalQuery } from "@/lib/rag/query";

const IN_DOMAIN: [string, string][] = [
  // Frontend — the original corpus.
  ["Reconciliation & keys", "React Internals"],
  ["Event loop & microtasks", "Core JS & Async"],
  ["debounce / throttle from scratch", "Coding & Communication"],
  ["Realtime: WS vs SSE", "Frontend System Design"],
  ["Reflow vs repaint", "Browser & Rendering"],
  ["STAR behavioral stories", "Coding & Communication"],
  ["Content Security Policy (CSP)", "Web Security"],
  ["Utility types (ReturnType, Omit, Pick)", "TypeScript"],
  // Backend, DSA and distributed systems — added by 0011. These MUST be in this
  // list, not in OFF_DOMAIN, or the probe measures a boundary that no longer
  // exists (which is exactly the bug this list once had).
  ["Postgres query planner internals", "Databases"],
  ["Kafka consumer group rebalancing", "Messaging"],
  ["Circuit Breaker Pattern", "Microservices & Resiliency"],
  ["JWT Structure and Security", "Authentication"],
  ["Tree and Graph traversals (DFS, BFS)", "Algorithms"],
  ["Consistent Hashing", "Scaling & Distributed Data"],
  ["Distributed Tracing and OpenTelemetry", "Observability"],
];

/**
 * Subjects the corpus deliberately does not cover. All must fall below the floor.
 *
 * THIS LIST HAS TO BE MAINTAINED WITH THE CORPUS, and forgetting that produced a
 * false alarm worth recording. It originally held "Postgres query planner
 * internals" and "Kafka consumer group rebalancing", which were genuinely
 * off-domain against a frontend-only corpus. Migration 0011 then added Postgres
 * and Kafka documentation on purpose — and this probe promptly reported
 * "FLOOR IS TOO LOW: raise it above 0.744", because a deliberately-added
 * document matched a query still labelled off-domain. The floor was fine; the
 * FIXTURE was stale.
 *
 * So the entries below are chosen to be real engineering topics from adjacent
 * disciplines this interview-prep corpus has no business covering — not
 * nonsense, which would be too easy a test, and not anything a future expansion
 * is likely to add.
 */
const OFF_DOMAIN: [string, string][] = [
  ["Rust borrow checker and lifetimes", "Systems Programming"],
  ["SwiftUI view lifecycle on iOS", "Mobile"],
  ["Kubernetes operator custom resource definitions", "Platform Engineering"],
  ["Backpropagation in neural networks", "Machine Learning"],
  ["Unity shader graph and render pipelines", "Game Development"],
  ["Embedded C interrupt service routines", "Firmware"],
];

type MatchRow = { title: string; similarity: number; topic_area: string };

async function main() {
  const userId = process.env.CORPUS_EMBED_USER_ID;
  if (!userId) {
    console.error("CORPUS_EMBED_USER_ID is not set — see scripts/embed-corpus.ts.");
    process.exit(1);
  }

  const admin = createAdminClient();
  const floor = ragMinSimilarity();
  console.log(`Current floor: ${floor}\n`);

  let worstInDomain = 1;
  let bestOffDomain = 0;
  // Counted so the summary cannot report a PASS it never measured — see the
  // guard at the end of this function.
  let measuredIn = 0;
  let measuredOff = 0;
  let failures = 0;

  for (const [label, cases] of [
    ["IN-DOMAIN", IN_DOMAIN],
    ["OFF-DOMAIN (every score must be below the floor)", OFF_DOMAIN],
  ] as const) {
    console.log(`\n=== ${label} ===`);

    for (const [topicName, weekTitle] of cases) {
      const res = await embed(
        {
          route: "scripts/probe-retrieval",
          userId,
          input: buildRetrievalQuery({ topicName, weekTitle }),
          purpose: "query",
        },
        // Same operator-job reasoning as the backfill: this is not user traffic.
        { countToday: async () => 0 }
      );

      if (!res.ok) {
        console.log(`\n■ ${topicName} -> EMBED FAILED (${res.reason})`);
        failures += 1;
        continue;
      }

      // Floor of -1 so the raw distribution is visible, not just what passes.
      const { data, error } = await admin.rpc("match_resources", {
        query_embedding: JSON.stringify(res.vector),
        match_count: 5,
        min_similarity: -1,
      } as never);

      if (error) {
        console.log(`\n■ ${topicName} -> RPC ERROR: ${(error as { message: string }).message}`);
        failures += 1;
        continue;
      }

      console.log(`\n■ ${topicName}  (${weekTitle})`);
      for (const r of (data ?? []) as MatchRow[]) {
        const passes = r.similarity >= floor;
        console.log(
          `   ${passes ? "PASS" : "    "} ${r.similarity.toFixed(3)}  [${r.topic_area}] ${r.title}`
        );
        if (label === "IN-DOMAIN") {
          measuredIn += 1;
          if (passes) worstInDomain = Math.min(worstInDomain, r.similarity);
        } else {
          measuredOff += 1;
          bestOffDomain = Math.max(bestOffDomain, r.similarity);
        }
      }
    }
  }

  console.log(
    `\n---\nBest OFF-domain score: ${bestOffDomain.toFixed(3)}` +
      `   Worst admitted in-domain score: ${worstInDomain.toFixed(3)}`
  );

  // A CALIBRATION THAT MEASURED NOTHING MUST NOT REPORT A PASS.
  //
  // This guard exists because the script did exactly that: on a run where the
  // provider was rate-limiting, every embedding failed, both accumulators kept
  // their initial values (0 and 1), and the summary printed
  // "Floor 0.64 separates them. Margin: 0.640." while exiting 0. The numbers
  // were not a measurement, they were the absence of one — and a green tick over
  // an assertion that never ran is the most dangerous result a check can give
  // (the same shape as Phase 4's conditionally-skipped security tests).
  if (failures > 0 || measuredIn === 0 || measuredOff === 0) {
    console.log(
      `\nCALIBRATION DID NOT RUN: ${failures} query/queries failed ` +
        `(${measuredIn} in-domain and ${measuredOff} off-domain measurements taken). ` +
        `The numbers above are NOT a result. Usually the provider is rate-limiting — ` +
        `wait a minute and re-run.`
    );
    process.exit(1);
  }
  if (bestOffDomain >= floor) {
    console.log(
      `FLOOR IS TOO LOW: an off-domain topic would be grounded. Raise it above ${bestOffDomain.toFixed(3)}.`
    );
    process.exit(1);
  }
  console.log(`Floor ${floor} separates them. Margin: ${(floor - bestOffDomain).toFixed(3)}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
