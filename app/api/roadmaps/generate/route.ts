import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ONBOARDING_STEPS } from "@/lib/seed/catalog";
import { generateSeedRoadmap } from "@/lib/seed/generate";
import type { OnboardingAnswers } from "@/lib/seed/types";

// POST /api/roadmaps/generate
// Onboarding answers → a seeded roadmap tree, persisted. Server-side because two
// things must be trusted and can't live in the client: the quota check (Rule 18)
// and, later, the AI generation (Rule 1). The seed generator stands in for AI now.
//
// Returns { id } of the new roadmap on success so the client can route to it.

// Validate the posted body is a well-formed answers object. We don't hard-reject
// unknown option strings (the seed generator degrades gracefully — unknown weak
// areas just don't front-load anything), but the shape must be right.
function parseAnswers(body: unknown): OnboardingAnswers | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const single = (v: unknown) => (typeof v === "string" ? v : "");
  const weak = Array.isArray(b.weak) ? b.weak.filter((x): x is string => typeof x === "string") : [];
  return {
    role: single(b.role),
    bar: single(b.bar),
    timeline: single(b.timeline),
    hours: single(b.hours),
    weak,
  };
}

export async function POST(request: Request) {
  const supabase = await createClient();

  // Rule 1/6: auth-gated. Never trust the client for identity.
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

  const answers = parseAnswers(body);
  if (!answers) return NextResponse.json({ error: "Malformed answers." }, { status: 400 });

  // The one required answer: at least one weak area (matches the wizard's CTA gate).
  const weakOptions = ONBOARDING_STEPS.find((s) => s.id === "weak")?.options ?? [];
  const validWeak = answers.weak.filter((w) => weakOptions.includes(w));
  if (validWeak.length === 0) {
    return NextResponse.json({ error: "Pick at least one weak area." }, { status: 400 });
  }
  answers.weak = validWeak;

  // Rule 18: quota is real and enforced server-side, not just hidden in the UI.
  // Read the user's cap from their profile; count existing roadmaps; reject at limit.
  const { data: profile } = await supabase
    .from("profiles")
    .select("max_roadmaps")
    .eq("id", user.id)
    .single();
  const maxRoadmaps = profile?.max_roadmaps ?? 3;

  const { count, error: countErr } = await supabase
    .from("roadmaps")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (countErr) {
    return NextResponse.json({ error: "Could not check your quota." }, { status: 500 });
  }
  if ((count ?? 0) >= maxRoadmaps) {
    return NextResponse.json(
      { error: `Roadmap limit reached (${maxRoadmaps}). Delete one to create another.` },
      { status: 403 }
    );
  }

  // Generate the seed tree (Phase 4: this is the AI-failure fallback).
  const seed = generateSeedRoadmap(answers);

  // Persist: roadmap → weeks → topics → notes. If any step fails, remove the
  // roadmap so we never leave a half-built tree (the FK cascade cleans children).
  const { data: roadmap, error: rErr } = await supabase
    .from("roadmaps")
    .insert({
      user_id: user.id,
      title: seed.title,
      subtitle: seed.subtitle,
      answers,
      weeks_count: seed.weeksCount,
      hours_planned: seed.hoursPlanned,
      status: "fresh",
    })
    .select("id")
    .single();

  if (rErr || !roadmap) {
    return NextResponse.json({ error: "Could not create the roadmap." }, { status: 500 });
  }

  try {
    for (const week of seed.weeks) {
      const { data: weekRow, error: wErr } = await supabase
        .from("weeks")
        .insert({
          roadmap_id: roadmap.id,
          user_id: user.id,
          n: week.n,
          title: week.title,
          hours: week.hours,
          kill_criterion: week.killCriterion,
        })
        .select("id")
        .single();
      if (wErr || !weekRow) throw new Error(wErr?.message ?? "week insert failed");

      const topicRows = week.topics.map((t, i) => ({
        week_id: weekRow.id,
        roadmap_id: roadmap.id,
        user_id: user.id,
        name: t.name,
        position: i,
        status: t.status,
        detail: t.detail,
      }));
      const { data: insertedTopics, error: tErr } = await supabase
        .from("topics")
        .insert(topicRows)
        .select("id");
      if (tErr || !insertedTopics) throw new Error(tErr?.message ?? "topic insert failed");

      // One empty note row per topic — the autosave target on the Topic screen.
      const noteRows = insertedTopics.map((t) => ({
        topic_id: t.id,
        user_id: user.id,
        body: "",
      }));
      const { error: nErr } = await supabase.from("notes").insert(noteRows);
      if (nErr) throw new Error(nErr.message);
    }
  } catch {
    // Roll back the whole tree (cascade removes any children already written).
    await supabase.from("roadmaps").delete().eq("id", roadmap.id);
    return NextResponse.json({ error: "Could not build the roadmap. Try again." }, { status: 500 });
  }

  return NextResponse.json({ id: roadmap.id }, { status: 201 });
}
