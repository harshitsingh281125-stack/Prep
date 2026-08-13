import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete, embed } from "@/lib/ai/gateway";
import {
  SYSTEM_TOPIC_DETAIL,
  SYSTEM_TOPIC_DETAIL_GROUNDED,
  buildGroundedDetailInput,
  buildTopicDetailInput,
} from "@/lib/ai/prompts";
import {
  GROUNDED_DETAIL_SCHEMA,
  TOPIC_DETAIL_SCHEMA,
  validateGroundedDetail,
  validateTopicDetail,
} from "@/lib/ai/validate";
import { buildRetrievalQuery } from "@/lib/rag/query";
import { matchResources } from "@/lib/rag/retrieve";
import { seedTopicDetail } from "@/lib/seed/detail";
import type { TopicDetail } from "@/lib/seed/types";

// POST /api/topics/[id]/detail
// Generate the study material for one topic — mental model, ranked resources,
// from-scratch exercises — and persist it to topics.detail.
//
// Triggered by an explicit button on the Topic screen, never automatically
// (settled 2026-08-08). Auto-generating on first open would spend AI calls per
// topic just for browsing a roadmap, which at 15-25 topics would exhaust the
// daily cap (Rule 3) before the user studied anything.
//
// ---------------------------------------------------------------------------
// PHASE 4.5: THIS ROUTE IS THE RAG PIPELINE.
//
//   1. build a retrieval query from the topic + its week    (lib/rag/query.ts)
//   2. embed it                                    (gateway.embed — metered!)
//   3. cosine search the curated corpus            (match_resources, in SQL)
//   4a. hits    -> GROUNDED completion: the model ranks and annotates OUR
//                  documents and is never asked for a URL      -> source 'rag'
//   4b. no hits -> the Phase 4 ungrounded completion, resources flagged
//                  `unverified` because they are model-recalled -> source 'ai'
//   4c. that failing too -> the seeded template                -> source 'seed'
//
// THREE degradation steps, each strictly weaker than the last and each labelled
// in the response so the UI can say which one the user is looking at. Rule 9 is
// not "have a fallback", it is "the flow completes" — and it now has to hold
// across a retrieval step as well as a generation step. Every RAG failure mode
// (embedding capped, embedding provider down, corpus unreachable, corpus simply
// has nothing for this topic) lands on 4b, which is the behaviour this route
// already had before the corpus existed.
//
// Cost note, deliberately visible: a grounded generation spends TWO metered
// calls (one embedding + one completion), an ungrounded one spends a single
// call. /usage shows both, so the price of grounding is a number rather than an
// assumption.
// ---------------------------------------------------------------------------

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: topicId } = await params;
  const supabase = await createClient();

  // Rule 1: no unauthenticated AI route. Identity comes from the session.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  // Load the topic plus the context the prompt needs. The .eq('user_id') on top
  // of RLS means a stranger's topic id returns zero rows and 404s without
  // leaking whether it exists — the same "404 is authorization for free" trick
  // the Phase 1 pages use. It also matters more here than on a read: without it
  // an attacker could otherwise spend *our* provider quota generating content
  // for topics they don't own. Note this still happens BEFORE the embedding
  // call, so an unowned id cannot spend the retrieval call either.
  const { data: topic, error: loadErr } = await supabase
    .from("topics")
    .select("id, name, weeks(title), roadmaps(title)")
    .eq("id", topicId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (loadErr) {
    return NextResponse.json({ error: "Could not load the topic." }, { status: 500 });
  }
  if (!topic) {
    return NextResponse.json({ error: "Topic not found." }, { status: 404 });
  }

  // Supabase types embedded to-one relations as arrays; normalise both.
  const one = <T,>(rel: unknown): T | null =>
    Array.isArray(rel) ? ((rel[0] ?? null) as T | null) : ((rel ?? null) as T | null);
  const week = one<{ title: string }>(topic.weeks);
  const roadmap = one<{ title: string }>(topic.roadmaps);
  const weekTitle = week?.title ?? "—";

  // --- 1-3. retrieve ------------------------------------------------------
  //
  // A failed embedding is not an error branch here, just an empty document set:
  // `docs.length === 0` already means "generate ungrounded", and cap/outage/
  // width failures all deserve exactly that treatment.
  const queryEmbedding = await embed({
    route: "/api/topics/detail",
    userId: user.id,
    input: buildRetrievalQuery({ topicName: topic.name, weekTitle }),
    purpose: "query",
  });

  const docs = queryEmbedding.ok
    ? await matchResources(supabase, queryEmbedding.vector)
    : [];

  // --- 4a. grounded generation -------------------------------------------
  let detail: TopicDetail | null = null;
  let reason: string | null = null;

  if (docs.length > 0) {
    const grounded = await complete<TopicDetail>({
      tier: "reasoning",
      route: "/api/topics/detail",
      userId: user.id,
      system: SYSTEM_TOPIC_DETAIL_GROUNDED,
      input: buildGroundedDetailInput({ topicName: topic.name, weekTitle, docs }),
      jsonSchema: GROUNDED_DETAIL_SCHEMA,
      // The retrieved docs are closed over so the validator can resolve each
      // `ref` back to a real row. This is where a citation becomes a link, and
      // it happens on our side of the boundary — the model never handled a URL.
      validate: (raw) => validateGroundedDetail(raw, docs),
    });
    if (grounded.ok) detail = grounded.data;
    else reason = grounded.reason;
  }

  // --- 4b. ungrounded generation (the Phase 4 path, unchanged) ------------
  //
  // Reached when the corpus had nothing above the similarity floor, when
  // retrieval was unavailable, or when a grounded generation failed twice. The
  // resources it produces are model-recalled and carry `unverified: true`.
  if (!detail) {
    const generated = await complete<TopicDetail>({
      tier: "reasoning",
      route: "/api/topics/detail",
      userId: user.id,
      system: SYSTEM_TOPIC_DETAIL,
      input: buildTopicDetailInput({
        topicName: topic.name,
        weekTitle,
        roadmapTitle: roadmap?.title ?? "—",
      }),
      jsonSchema: TOPIC_DETAIL_SCHEMA,
      validate: validateTopicDetail,
    });
    if (generated.ok) detail = generated.data;
    else reason = generated.reason;
  }

  // --- 4c. seeded template ------------------------------------------------
  const finalDetail: TopicDetail = detail ?? seedTopicDetail(topic.name);

  const { error: saveErr } = await supabase
    .from("topics")
    .update({ detail: finalDetail })
    .eq("id", topicId)
    .eq("user_id", user.id);

  if (saveErr) {
    return NextResponse.json({ error: "Could not save the generated detail." }, { status: 500 });
  }

  return NextResponse.json({
    detail: finalDetail,
    source: finalDetail.source ?? "seed",
    // How many corpus documents grounded this answer. 0 is the honest report of
    // "your topic isn't in the corpus", which is a different situation from a
    // failed generation and the UI says so differently.
    retrieved: docs.length,
    // Surfaced so the UI can distinguish "the AI is over its daily cap" from
    // "the AI produced junk" — different messages, different user action. Null
    // when the path that produced the content succeeded.
    reason: finalDetail.source === "rag" || finalDetail.source === "ai" ? null : reason,
  });
}
