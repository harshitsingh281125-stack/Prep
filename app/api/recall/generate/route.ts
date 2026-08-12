import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete } from "@/lib/ai/gateway";
import { SYSTEM_RECALL, buildRecallInput } from "@/lib/ai/prompts";
import { RECALL_SCHEMA, validateRecallQuestions } from "@/lib/ai/validate";
import { seedCardsForTopic } from "@/lib/seed/recall";

// POST /api/recall/generate  { topicId }
// Derive recall cards for one topic and insert them into the queue.
//
// This is the CLASSIFICATION tier, and the contrast with /api/topics/detail
// (reasoning tier) is the whole cost-routing argument made concrete: card
// generation runs once per topic across every roadmap, so it is the frequent
// call and gets the cheap model. Topic detail and roadmap generation are rare
// and get the better one. Cost follows call volume, not perceived importance.
//
// Rule 9: on a capped/unreachable/malformed generation we fall back to the
// seeded questions for that topic name (lib/seed/recall.ts). A topic the seed
// doesn't know produces zero cards — reported honestly as created: 0 rather than
// dressed up, because inventing filler questions would poison the retention loop
// the product exists to run.

/** Cards created per generation, bounded by the validator (RECALL_LIMITS). */
export async function POST(request: Request) {
  const supabase = await createClient();

  // Rule 1: no unauthenticated AI route.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const topicId = (body as { topicId?: unknown } | null)?.topicId;
  if (typeof topicId !== "string" || topicId.length === 0) {
    return NextResponse.json({ error: "topicId is required." }, { status: 400 });
  }

  // Ownership before spend: same reasoning as the detail route — a stranger's
  // topic id must 404 rather than burn a provider call.
  const { data: topic, error: loadErr } = await supabase
    .from("topics")
    .select("id, name, roadmap_id, weeks(title)")
    .eq("id", topicId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (loadErr) {
    return NextResponse.json({ error: "Could not load the topic." }, { status: 500 });
  }
  if (!topic) {
    return NextResponse.json({ error: "Topic not found." }, { status: 404 });
  }

  const weekRel = topic.weeks as unknown as { title: string } | { title: string }[] | null;
  const week = Array.isArray(weekRel) ? weekRel[0] ?? null : weekRel;

  const generated = await complete<string[]>({
    tier: "classification", // frequent, low-value call — the cheap tier belongs here
    route: "/api/recall/generate",
    userId: user.id,
    system: SYSTEM_RECALL,
    input: buildRecallInput({ topicName: topic.name, weekTitle: week?.title ?? "—" }),
    jsonSchema: RECALL_SCHEMA,
    validate: validateRecallQuestions,
  });

  const questions = generated.ok
    ? generated.data
    : seedCardsForTopic(topic.name).map((c) => c.question);
  const source: "ai" | "seed" = generated.ok ? "ai" : "seed";

  // Don't duplicate cards the topic already has. Pressing the button twice is a
  // normal thing for a user to do, and the retention loop degrades badly if the
  // same question shows up twice in one session — you "recall" it the second
  // time because you just read it, which is exactly the false signal Rule 17
  // exists to keep out of the data.
  const { data: existing } = await supabase
    .from("recall_cards")
    .select("question")
    .eq("user_id", user.id)
    .eq("topic_id", topicId);

  const already = new Set((existing ?? []).map((c) => c.question));
  const fresh = questions.filter((q) => !already.has(q));

  if (fresh.length > 0) {
    const { error: insertErr } = await supabase.from("recall_cards").insert(
      fresh.map((question) => ({
        user_id: user.id,
        topic_id: topic.id,
        roadmap_id: topic.roadmap_id,
        topic_label: topic.name,
        question,
      }))
    );
    if (insertErr) {
      return NextResponse.json({ error: "Could not save the cards." }, { status: 500 });
    }
  }

  // New cards keep the column defaults (interval 0, ease 2.5, due now), so they
  // enter today's queue immediately — the same state a Phase 2 seeded card gets.
  return NextResponse.json({
    created: fresh.length,
    duplicates: questions.length - fresh.length,
    source,
    reason: generated.ok ? null : generated.reason,
  });
}
