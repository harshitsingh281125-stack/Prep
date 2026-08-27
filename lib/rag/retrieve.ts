import "server-only";

// lib/rag/retrieve.ts — the corpus search half of the RAG pipeline.
//
// One function, and it is thin on purpose: the actual retrieval logic (the
// distance operator, the similarity floor, the ordering, the NULL-embedding
// exclusion) lives in SQL, in match_resources() — see 0007_resources.sql. That
// is Rule 12 applied to the most interesting query in the project rather than to
// only the easy ones. What is left here is the call and the shape translation.

import { RAG_TOP_K, ragMinSimilarity } from "@/lib/ai/config";
import type { RetrievedDoc } from "./query";

/** The row shape match_resources() returns, in the DB's snake_case. */
type MatchRow = {
  id: string;
  topic_area: string;
  title: string;
  url: string;
  kind: string;
  summary: string;
  similarity: number;
};

/**
 * Minimal structural type for the client — avoids importing a Supabase generic
 * that would drag the whole Database type through this module (and makes the
 * function trivially fakeable in a unit test).
 *
 * `PromiseLike`, not `Promise`: supabase-js `.rpc()` returns a thenable query
 * builder that only becomes a promise when awaited, so requiring a real Promise
 * here rejects the actual client.
 */
type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * Find the corpus documents closest to a query vector.
 *
 * Returns `[]` for BOTH "nothing was similar enough" and "the search failed".
 * Collapsing those is deliberate: the caller's behaviour is identical either way
 * — fall back to generated, `unverified`-flagged resources (Rule 9) — and giving
 * the caller a second failure branch it would handle identically is surface
 * without meaning. RAG must never hard-block a topic, and a corpus that is
 * unreachable is indistinguishable, from the user's seat, from a corpus that has
 * nothing for them.
 *
 * The vector is stringified rather than passed as a JS array because pgvector's
 * text input format IS `[0.1,0.2,…]`. Sending the array lets PostgREST decide
 * how to serialise it before Postgres casts it; sending the literal removes that
 * question entirely.
 */
export async function matchResources(
  supabase: RpcClient,
  queryVector: number[]
): Promise<RetrievedDoc[]> {
  const { data, error } = await supabase.rpc("match_resources", {
    query_embedding: JSON.stringify(queryVector),
    match_count: RAG_TOP_K,
    min_similarity: ragMinSimilarity(),
  });

  if (error || !Array.isArray(data)) return [];

  return (data as MatchRow[]).map((r) => ({
    id: r.id,
    topicArea: r.topic_area,
    title: r.title,
    url: r.url,
    kind: r.kind,
    summary: r.summary,
    similarity: r.similarity,
  }));
}
