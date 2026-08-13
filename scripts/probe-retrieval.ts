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
// subjects a frontend-interview corpus genuinely has nothing for, so every one
// of their scores must fall BELOW the floor. If any of them passes, the floor is
// too low and topics outside the corpus are being grounded on whatever happens
// to be nearest.

import { embed } from "@/lib/ai/gateway";
import { ragMinSimilarity } from "@/lib/ai/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildRetrievalQuery } from "@/lib/rag/query";

const IN_DOMAIN: [string, string][] = [
  ["Reconciliation & keys", "React Internals"],
  ["Event loop & microtasks", "Core JS & Async"],
  ["debounce / throttle from scratch", "Coding & Communication"],
  ["Realtime: WS vs SSE", "Frontend System Design"],
  ["Reflow vs repaint", "Browser & Rendering"],
  ["STAR behavioral stories", "Coding & Communication"],
  ["Performance budgets", "Browser & Rendering"],
];

/** Subjects the corpus deliberately does not cover. All must fall below the floor. */
const OFF_DOMAIN: [string, string][] = [
  ["Kubernetes pod autoscaling", "Infrastructure"],
  ["Postgres query planner internals", "Databases"],
  ["Kafka consumer group rebalancing", "Distributed Systems"],
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
        continue;
      }

      console.log(`\n■ ${topicName}  (${weekTitle})`);
      for (const r of (data ?? []) as MatchRow[]) {
        const passes = r.similarity >= floor;
        console.log(
          `   ${passes ? "PASS" : "    "} ${r.similarity.toFixed(3)}  [${r.topic_area}] ${r.title}`
        );
        if (label === "IN-DOMAIN" && passes) worstInDomain = Math.min(worstInDomain, r.similarity);
        if (label !== "IN-DOMAIN") bestOffDomain = Math.max(bestOffDomain, r.similarity);
      }
    }
  }

  console.log(
    `\n---\nBest OFF-domain score: ${bestOffDomain.toFixed(3)}` +
      `   Worst admitted in-domain score: ${worstInDomain.toFixed(3)}`
  );
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
