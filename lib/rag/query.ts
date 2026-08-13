// lib/rag/query.ts — turning a topic into the text we embed for retrieval.
//
// Pure, so it is unit-testable without a provider or a database, for the same
// reason lib/recall/scheduler.ts and lib/progress/compute.ts are pure. The
// interesting decision here is what to LEAVE OUT, and that decision is only
// arguable if it is written down somewhere a test can pin.

/** One row returned by the corpus search. Shared by the route and the prompt. */
export type RetrievedDoc = {
  id: string;
  topicArea: string;
  title: string;
  url: string;
  kind: string;
  summary: string;
  /** Cosine similarity, 0..1. Above the configured floor by construction. */
  similarity: number;
};

/**
 * Build the string that gets embedded as the retrieval query.
 *
 * Includes the WEEK title because a bare topic name is often ambiguous on its
 * own — "Concurrent features" retrieves better when the query also says "React
 * Internals" — and a retrieval query has no length pressure worth optimising at
 * this size.
 *
 * Deliberately EXCLUDES the roadmap title, which is the one piece of context
 * that looks useful and isn't. Roadmap titles are model-written plan names
 * ("Frontend track — 8 weeks to a senior bar"), not subject descriptors: they
 * contribute words like "weeks", "plan" and "senior" that appear in no technical
 * document's summary, so they pull the query vector away from the corpus without
 * adding any signal about what the user is actually studying. Retrieval quality
 * is dominated by how well the query resembles the DOCUMENTS, not by how much
 * context it carries.
 */
export function buildRetrievalQuery(opts: {
  topicName: string;
  weekTitle: string;
}): string {
  const week = opts.weekTitle.trim();
  const topic = opts.topicName.trim();
  // A week title of "—" is what the route passes when a topic has no week row.
  // Concatenating it would embed a stray dash.
  return week && week !== "—" ? `${topic}. ${week}.` : `${topic}.`;
}
