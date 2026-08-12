import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { weakAreasForRole } from "@/lib/seed/catalog";
import { generateSeedRoadmap } from "@/lib/seed/generate";
import { seedCardsForTopic } from "@/lib/seed/recall";
import { complete } from "@/lib/ai/gateway";
import { SYSTEM_ROADMAP, buildRoadmapInput } from "@/lib/ai/prompts";
import { ROADMAP_SCHEMA, planContract, validateRoadmap } from "@/lib/ai/validate";
import type { OnboardingAnswers, SeedRoadmap } from "@/lib/seed/types";

// POST /api/roadmaps/generate
// Onboarding answers → a roadmap tree, persisted. Server-side because three
// things must be trusted and can't live in the client: the quota check
// (Rule 18), the AI call itself (Rules 1 & 2 — the provider key never reaches
// the browser), and the daily AI cap (Rule 3).
//
// Phase 4 put the real generation in front of the seed generator. The ORDER of
// the two quota-ish checks matters and is deliberate:
//
//   1. the ROADMAP quota (Rule 18) is checked first, because a user at their
//      3-roadmap limit must not be able to spend an AI call discovering that;
//   2. the AI daily cap (Rule 3) is checked inside the gateway, before dispatch.
//
// Rule 9 is the shape of the whole handler: a capped, unreachable or
// twice-malformed generation is NOT an error the user sees. It falls through to
// generateSeedRoadmap() and the flow completes normally. The response reports
// which path ran so the UI can be honest about it, but the roadmap is real
// either way.
//
// Returns { id, source } of the new roadmap on success so the client can route
// to it and say where the content came from.

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
  // Phase 4: the valid set depends on the ROLE, so it's resolved per answer rather
  // than read off a fixed list. "Not sure" is one of the valid picks — it means
  // "nothing to front-load", which the generators handle via declaredWeakAreas().
  const weakOptions = weakAreasForRole(answers.role);
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

  // --- generation (Rule 9: AI first, seed as the validated-failure fallback) ---
  //
  // The contract — how many weeks, how many hours a week — is computed here from
  // the user's own answers and handed to the validator. The model is never asked
  // for those numbers and can't change them (see lib/ai/validate.ts). That is
  // what makes the AI path and the seed path interchangeable: whichever runs,
  // the roadmap the user gets has the shape the user asked for, and the Phase 3
  // pace maths downstream divides by the same denominators either way.
  const contract = planContract(answers);

  const generated = await complete<SeedRoadmap>({
    tier: "reasoning", // rare, high-value call — see the routing note in lib/ai/config.ts
    route: "/api/roadmaps/generate",
    userId: user.id,
    system: SYSTEM_ROADMAP,
    input: buildRoadmapInput(answers, contract.weeksCount),
    jsonSchema: ROADMAP_SCHEMA,
    validate: (raw) => validateRoadmap(raw, contract),
  });

  const seed: SeedRoadmap = generated.ok ? generated.data : generateSeedRoadmap(answers);
  const source: "ai" | "seed" = generated.ok ? "ai" : "seed";

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
    // Phase 2: seed the recall queue alongside the tree. A roadmap whose timeline
    // is longer than the catalog repeats blocks (see generateSeedRoadmap), so the
    // same topic name can appear in several weeks — dedupe by name and bind each
    // card to the FIRST topic row of that name, or the queue would carry copies.
    //
    // Phase 4 note: RECALL_SEED is keyed by catalog topic name, so an AI-generated
    // roadmap (whose topic names are the model's own) matches nothing here and
    // starts with an empty queue. That is intentional rather than an oversight —
    // generating cards for every topic at creation time would spend one AI call
    // per topic (15-25 of them) and blow the daily cap on a single onboarding.
    // Cards are generated per topic, on demand, from the Topic screen via
    // /api/recall/generate.
    const seededTopicNames = new Set<string>();
    const cardRows: {
      user_id: string;
      topic_id: string;
      roadmap_id: string;
      topic_label: string;
      question: string;
    }[] = [];

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

      // Collect this week's recall cards (first occurrence of each topic wins).
      week.topics.forEach((t, i) => {
        if (seededTopicNames.has(t.name)) return;
        const cards = seedCardsForTopic(t.name);
        if (cards.length === 0) return;
        seededTopicNames.add(t.name);
        for (const card of cards) {
          cardRows.push({
            user_id: user.id,
            topic_id: insertedTopics[i].id,
            roadmap_id: roadmap.id,
            topic_label: card.topicLabel,
            question: card.question,
          });
        }
      });
    }

    // All cards start due now (interval 0, ease 2.5) — the column defaults handle
    // the scheduler state, so the queue is immediately reviewable after onboarding.
    if (cardRows.length > 0) {
      const { error: cErr } = await supabase.from("recall_cards").insert(cardRows);
      if (cErr) throw new Error(cErr.message);
    }
  } catch {
    // Roll back the whole tree (cascade removes any children already written).
    await supabase.from("roadmaps").delete().eq("id", roadmap.id);
    return NextResponse.json({ error: "Could not build the roadmap. Try again." }, { status: 500 });
  }

  // `source` tells the client whether this came from the model or the seeded
  // template. Reported, not stored: it's true at creation time and the /usage
  // readout is the durable audit trail (every dispatch, and how it ended).
  return NextResponse.json({ id: roadmap.id, source }, { status: 201 });
}
