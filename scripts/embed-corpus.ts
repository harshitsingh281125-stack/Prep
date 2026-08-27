import { config as loadEnv } from "dotenv";

// `.env.local` explicitly — NOT the bare `dotenv/config` import, which only
// reads `.env`. This project keeps every real value in `.env.local` (gitignored;
// `.env.example` is the committed template), so the convenient import silently
// loads nothing and the script fails on a missing variable that is in fact
// sitting right there. playwright.config.ts loads the path explicitly for the
// same reason.
loadEnv({ path: ".env.local" });

// scripts/embed-corpus.ts — the one-off corpus backfill.
//
//   npm run embed:corpus            # embed every row that has no vector yet
//   npm run embed:corpus -- --all   # re-embed everything (after a model change)
//
// 0008_resources_seed.sql inserts the curated rows with `embedding` NULL, and
// this fills them in. Splitting it that way is deliberate: the corpus stays
// reviewable as plain SQL in git instead of as 48 unreadable 1536-float
// literals, and re-embedding after a model or dimension change is a re-run
// rather than a new migration.
//
// It goes through gateway.embed() rather than calling the provider directly,
// which is Rule 7 applied to our own tooling — the script has no idea which
// provider is configured, so `AI_PROVIDER=mock` embeds the corpus locally with
// no network and no spend, and switching providers later needs no edit here.
//
// ---------------------------------------------------------------------------
// TWO OPERATOR DECISIONS THAT LOOK LIKE RULE VIOLATIONS AND AREN'T
//
// 1. THE DAILY CAP IS BYPASSED (injected `countToday: () => 0`).
//    Rule 3's cap protects a USER's share of the provider quota. A corpus
//    backfill is not user traffic: it is one bounded operator action, run by
//    whoever holds the service-role key, whose size is known in advance
//    (currently 48 embeddings) and visible in a checked-in migration. Letting a
//    25/day user cap govern it would mean the corpus could only ever be
//    half-embedded, and half a corpus is worse than none — retrieval would
//    silently return only whatever happened to be embedded first.
//
// 2. IT STILL METERS (Rule 11), under an OPERATOR identity.
//    `CORPUS_EMBED_USER_ID` names the account the spend is attributed to. It has
//    to be a real auth.users id because ai_usage.user_id is a foreign key — and
//    attributing it deliberately rather than skipping the rows keeps the total
//    provider spend honest. The consequence is understood and accepted: those
//    rows appear in that account's /usage readout. Use your own admin account,
//    not a QA account whose readout you want clean.
// ---------------------------------------------------------------------------
//
// Requires (all already in .env.local except the last):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY,
//   CORPUS_EMBED_USER_ID

import { WebSocket as UndiciWebSocket } from "undici";

import { EMBEDDING_DIM } from "@/lib/ai/config";
import { embed } from "@/lib/ai/gateway";
import { createAdminClient } from "@/lib/supabase/admin";

// supabase-js constructs a RealtimeClient eagerly inside createClient(), and
// that constructor requires a global WebSocket. Node 18 has none (it landed as a
// global in Node 21+), while Next.js's server runtime polyfills one — which is
// why lib/supabase/admin.ts works perfectly in the app and throws here.
//
// Nothing in this project uses realtime; the client is REST-only. So the fix is
// to satisfy the constructor rather than to configure a transport we will never
// open, and to do it HERE rather than in admin.ts — product code should not
// carry a workaround for a script's runtime. Same family of constraint as the
// Next 15 and Playwright 1.47 pins: this machine is on Node 18.19.1. When Node
// goes to 22, delete these three lines.
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as { WebSocket?: unknown }).WebSocket = UndiciWebSocket;
}

const REEMBED_ALL = process.argv.includes("--all");

/**
 * Scale a vector to unit length.
 *
 * Gemini returns 3072-dimension embeddings at unit length, but a Matryoshka
 * truncation to 1536 is NOT unit length — measured at 0.7023 on a real response
 * (2026-08-13). Under `vector_cosine_ops` this genuinely does not matter, since
 * cosine divides the magnitudes out and both the ranking and the similarity
 * floor are scale-invariant. It is done anyway because it costs one pass over
 * 1536 floats, once, and it removes a trap: the day someone switches the index
 * to inner-product or L2 — for which magnitude very much does matter — the
 * stored vectors are already in the form those operators assume.
 */
function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((a, v) => a + v * v, 0));
  return norm === 0 ? vector : vector.map((v) => v / norm);
}

async function main() {
  const userId = process.env.CORPUS_EMBED_USER_ID;
  if (!userId) {
    console.error(
      "CORPUS_EMBED_USER_ID is not set. It must be a real auth.users id — the\n" +
        "account the corpus embedding spend is metered against. See tests/phase-4.5-rag.md."
    );
    process.exit(1);
  }

  const admin = createAdminClient();

  const query = admin.from("resources").select("id, title, summary, kind, topic_area");
  const { data: rows, error } = REEMBED_ALL
    ? await query
    : await query.is("embedding", null);

  if (error) {
    console.error("Could not read the corpus:", error.message);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log("Nothing to embed — every corpus row already has a vector.");
    return;
  }

  console.log(
    `Embedding ${rows.length} corpus row(s) at ${EMBEDDING_DIM} dimensions` +
      (REEMBED_ALL ? " (--all: re-embedding rows that already had vectors)" : "") +
      "…\n"
  );

  let done = 0;
  let failed = 0;

  for (const row of rows) {
    // Embed the SAME text the retrieval query will be compared against: the
    // summary carries the subject matter, and the title is prepended because it
    // names the technology in words a topic name would use ("useMemo",
    // "Intersection Observer") that a prose summary may only paraphrase.
    const input = `${row.title}. ${row.summary}`;

    const result = await embed(
      {
        route: "scripts/embed-corpus",
        userId,
        input,
        // 'document', not 'query' — this is the indexed side of the pair. Getting
        // this backwards degrades retrieval quietly rather than loudly: the
        // search still returns rows, they are just worse ones.
        purpose: "document",
      },
      // See decision 1 in the header. Everything else — the provider binding,
      // the width check, the ai_usage row — is left as the real implementation.
      { countToday: async () => 0 }
    );

    if (!result.ok) {
      failed += 1;
      console.error(`  ✗ ${row.title} — ${result.reason}`);
      continue;
    }

    const { error: writeErr } = await admin
      .from("resources")
      // pgvector's text input format is a bracketed list, which is what the
      // driver will send this string as.
      .update({ embedding: JSON.stringify(normalize(result.vector)) })
      .eq("id", row.id);

    if (writeErr) {
      failed += 1;
      console.error(`  ✗ ${row.title} — write failed: ${writeErr.message}`);
      continue;
    }

    done += 1;
    console.log(`  ✓ [${row.topic_area}] ${row.title}`);
  }

  console.log(`\nEmbedded ${done} row(s), ${failed} failed.`);
  if (failed > 0) {
    // A partially-embedded corpus is a real state, not a crash: match_resources()
    // ignores NULL-embedding rows, so retrieval degrades to a smaller corpus
    // rather than returning documents with no demonstrated relevance. Re-running
    // is safe and picks up exactly the rows that failed.
    console.log("Re-run `npm run embed:corpus` to retry only the rows that failed.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
