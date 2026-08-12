import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete } from "@/lib/ai/gateway";
import { SYSTEM_TOPIC_DETAIL, buildTopicDetailInput } from "@/lib/ai/prompts";
import { TOPIC_DETAIL_SCHEMA, validateTopicDetail } from "@/lib/ai/validate";
import { seedTopicDetail } from "@/lib/seed/detail";
import type { TopicDetail } from "@/lib/seed/types";

// POST /api/topics/[id]/detail
// Generate the study material for one topic — mental model, ranked resources,
// from-scratch exercises — and persist it to topics.detail.
//
// Triggered by an explicit button on the Topic screen, never automatically
// (settled 2026-08-08). Auto-generating on first open would spend one AI call
// per topic just for browsing a roadmap, which at 15-25 topics would exhaust the
// daily cap (Rule 3) before the user studied anything. Explicit also means the
// user can SEE the difference between generated and template content, which is
// what makes the Rule 9 fallback demoable instead of invisible.
//
// Rule 9: a capped, unreachable, or twice-malformed generation falls back to the
// seeded template and still returns 200. The topic always ends up with usable
// detail; `detail.source` records which path produced it and the UI says so.
//
// Resources generated here are flagged `unverified` — Phase 4 has no corpus to
// check them against. Phase 4.5's RAG grounding is what clears that flag.

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
  // for topics they don't own.
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

  const generated = await complete<TopicDetail>({
    tier: "reasoning", // rare per topic, and it's the content the user actually studies
    route: "/api/topics/detail",
    userId: user.id,
    system: SYSTEM_TOPIC_DETAIL,
    input: buildTopicDetailInput({
      topicName: topic.name,
      weekTitle: week?.title ?? "—",
      roadmapTitle: roadmap?.title ?? "—",
    }),
    jsonSchema: TOPIC_DETAIL_SCHEMA,
    validate: validateTopicDetail,
  });

  const detail: TopicDetail = generated.ok ? generated.data : seedTopicDetail(topic.name);

  const { error: saveErr } = await supabase
    .from("topics")
    .update({ detail })
    .eq("id", topicId)
    .eq("user_id", user.id);

  if (saveErr) {
    return NextResponse.json({ error: "Could not save the generated detail." }, { status: 500 });
  }

  return NextResponse.json({
    detail,
    source: detail.source ?? "seed",
    // Surfaced so the UI can distinguish "the AI is over its daily cap" from
    // "the AI produced junk" — different messages, different user action.
    reason: generated.ok ? null : generated.reason,
  });
}
