import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { WebSocket as UndiciWebSocket } from "undici";
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as { WebSocket?: unknown }).WebSocket = UndiciWebSocket;
}

// scripts/probe-coverage.ts — "what is my RAG corpus still missing?"
//
//   npm run probe:coverage
//
// Walks every topic in your own roadmaps, runs the REAL retrieval step against
// the corpus, and reports which topics would ground and which would fall back to
// unverified. Ends with a block you can paste straight into Claude to get the
// next corpus migration curated.
//
// WHY THIS EXISTS AS A COMMAND rather than a one-off script:
// the corpus was first curated against lib/seed/catalog.ts — the SEED topic
// names. But the seed is only the Rule 9 fallback; the normal path is an
// AI-generated roadmap, and generated roadmaps range far wider than the catalog.
// That mismatch shipped: real roadmaps produced topics on CSP, TypeScript
// generics, tree-shaking and monorepos, and the corpus had nothing for any of
// them, so the feature silently degraded to unverified for most of a plan.
//
// The general lesson, which is why this is a permanent tool: a retrieval corpus
// must be curated against the DISTRIBUTION OF REAL QUERIES, and that
// distribution changes every time the generator writes a new kind of roadmap.
// Coverage is not a thing you achieve once; it is a thing you re-measure.
//
// Costs one embedding per topic (metered against CORPUS_EMBED_USER_ID, with the
// daily cap injected off — same operator-job reasoning as embed-corpus.ts).

import { embed } from "@/lib/ai/gateway";
import { ragMinSimilarity } from "@/lib/ai/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildRetrievalQuery } from "@/lib/rag/query";

type Row = { topic: string; week: string; roadmap: string; top: number; docs: number; best: string };

async function main() {
  const userId = process.env.CORPUS_EMBED_USER_ID;
  if (!userId) {
    console.error("CORPUS_EMBED_USER_ID is not set — see scripts/embed-corpus.ts.");
    process.exit(1);
  }

  const admin = createAdminClient();
  const floor = ragMinSimilarity();

  const { data: roadmaps } = (await admin
    .from("roadmaps")
    .select("id, title")
    .eq("user_id", userId)) as { data: { id: string; title: string }[] | null };

  if (!roadmaps || roadmaps.length === 0) {
    console.log("No roadmaps found for CORPUS_EMBED_USER_ID. Create one first.");
    return;
  }

  const { data: corpus } = (await admin
    .from("resources")
    .select("topic_area")) as { data: { topic_area: string }[] | null };
  const areas = new Set((corpus ?? []).map((r) => r.topic_area));

  console.log(
    `Corpus: ${(corpus ?? []).length} documents across ${areas.size} areas\n` +
      `Floor:  ${floor}\n` +
      `Roadmaps: ${roadmaps.length}\n`
  );

  const rows: Row[] = [];

  for (const rm of roadmaps) {
    const { data: weeks } = (await admin
      .from("weeks")
      .select("id, title, n")
      .eq("roadmap_id", rm.id)) as { data: { id: string; title: string; n: number }[] | null };
    const wt = new Map((weeks ?? []).map((w) => [w.id, w.title]));

    const { data: topics } = (await admin
      .from("topics")
      .select("name, week_id")
      .eq("roadmap_id", rm.id)) as { data: { name: string; week_id: string }[] | null };

    for (const t of topics ?? []) {
      const week = wt.get(t.week_id) ?? "—";
      const e = await embed(
        {
          route: "scripts/probe-coverage",
          userId,
          input: buildRetrievalQuery({ topicName: t.name, weekTitle: week }),
          purpose: "query",
        },
        { countToday: async () => 0 }
      );
      if (!e.ok) {
        console.error(`  embed failed (${e.reason}) on "${t.name}" — stopping.`);
        process.exit(1);
      }

      const { data } = await admin.rpc("match_resources", {
        query_embedding: JSON.stringify(e.vector),
        match_count: 5,
        min_similarity: -1,
      } as never);

      const m = (data ?? []) as { title: string; similarity: number }[];
      rows.push({
        topic: t.name,
        week,
        roadmap: rm.title,
        top: m[0]?.similarity ?? 0,
        docs: m.filter((r) => r.similarity >= floor).length,
        best: m[0]?.title ?? "-",
      });
    }
  }

  // THIN (exactly one document) is called out separately from MISSING because it
  // is the more dangerous state: one weak match still renders as a vetted link
  // with a green VERIFIED chip, whereas a miss is labelled honestly.
  const missing = rows.filter((r) => r.docs === 0);
  const thin = rows.filter((r) => r.docs === 1);
  const good = rows.filter((r) => r.docs >= 2);

  console.log(`GROUNDED (2+ docs): ${good.length}/${rows.length}`);
  console.log(`THIN     (1 doc)  : ${thin.length}`);
  console.log(`MISSING  (0 docs) : ${missing.length}\n`);

  if (thin.length) {
    console.log("THIN — one weak match, still rendered as VERIFIED. Check these first:");
    for (const r of thin.sort((a, b) => a.top - b.top)) {
      console.log(`   ${r.top.toFixed(3)}  ${r.topic}\n            -> ${r.best}`);
    }
    console.log("");
  }

  if (missing.length === 0 && thin.length === 0) {
    console.log("Every topic grounds on 2+ documents. Nothing to curate right now.");
    return;
  }

  console.log("─".repeat(72));
  console.log("PASTE THE BLOCK BELOW TO CLAUDE:\n");
  console.log("Expand the RAG corpus. These topics from my real roadmaps do not");
  console.log("ground well against the current corpus. Curate a new migration for");
  console.log("them, verify every URL returns 200 at the exact path, then tell me");
  console.log("to apply it and re-run the backfill.\n");
  for (const r of [...missing, ...thin].sort((a, b) => a.top - b.top)) {
    console.log(`  - ${r.topic}   (week: ${r.week}; best now: ${r.best} @ ${r.top.toFixed(3)})`);
  }
  console.log("─".repeat(72));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
