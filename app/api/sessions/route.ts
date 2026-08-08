import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/sessions
// Log a block of study time against a roadmap (optionally against a topic).
//
// Why this is a server route and not a direct client write under RLS: the same
// reasoning as recall grading (Architecture §4b). RLS answers "may this user
// write this row?" but it cannot answer "is this a coherent row?" — a client
// writing straight to study_sessions could log minutes against a topic that
// belongs to a *different* roadmap, corrupting the per-week bars that the whole
// Progress screen is derived from. The route re-derives ownership of both the
// roadmap and the topic before inserting. The CHECK constraint on minutes is the
// DB-level backstop underneath this (defence in depth, not a substitute).
//
// Rule 15: logged_at is the DB's now() in UTC; the client never supplies a time.

/** Matches the column's CHECK constraint — keep the two in sync. */
const MIN_MINUTES = 1;
const MAX_MINUTES = 1440;

export async function POST(request: Request) {
  const supabase = await createClient();

  // Rule 1: auth-gated. Identity comes from the session, never from the body.
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

  const { roadmapId, topicId, minutes, note } = (body ?? {}) as {
    roadmapId?: unknown;
    topicId?: unknown;
    minutes?: unknown;
    note?: unknown;
  };

  if (typeof roadmapId !== "string" || roadmapId.length === 0) {
    return NextResponse.json({ error: "roadmapId is required." }, { status: 400 });
  }

  // Integer minutes only. Rejects NaN, Infinity, "45", 45.5, and anything outside
  // the same bounds the column enforces — so a bad value fails with a clear 400
  // rather than a raw constraint-violation 500.
  if (
    typeof minutes !== "number" ||
    !Number.isInteger(minutes) ||
    minutes < MIN_MINUTES ||
    minutes > MAX_MINUTES
  ) {
    return NextResponse.json(
      { error: `minutes must be a whole number between ${MIN_MINUTES} and ${MAX_MINUTES}.` },
      { status: 400 }
    );
  }

  if (topicId !== undefined && topicId !== null && typeof topicId !== "string") {
    return NextResponse.json({ error: "topicId must be a string or null." }, { status: 400 });
  }

  if (note !== undefined && note !== null && typeof note !== "string") {
    return NextResponse.json({ error: "note must be a string or null." }, { status: 400 });
  }

  // Ownership check on the roadmap. Under RLS a stranger's id returns zero rows,
  // so this 404s without leaking whether that roadmap exists — the same
  // "404 is authorization for free" trick as the Phase 1 roadmap pages.
  const { data: roadmap, error: roadmapErr } = await supabase
    .from("roadmaps")
    .select("id")
    .eq("id", roadmapId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (roadmapErr) {
    return NextResponse.json({ error: "Could not load the roadmap." }, { status: 500 });
  }
  if (!roadmap) {
    return NextResponse.json({ error: "Roadmap not found." }, { status: 404 });
  }

  // If a topic was named, it must be the caller's AND belong to THIS roadmap.
  // Without the roadmap_id check a user could log hours against their own topic
  // in roadmap B while claiming the session for roadmap A, and roadmap A's week
  // bars would silently never account for those minutes.
  if (typeof topicId === "string" && topicId.length > 0) {
    const { data: topic, error: topicErr } = await supabase
      .from("topics")
      .select("id")
      .eq("id", topicId)
      .eq("user_id", user.id)
      .eq("roadmap_id", roadmapId)
      .maybeSingle();

    if (topicErr) {
      return NextResponse.json({ error: "Could not load the topic." }, { status: 500 });
    }
    if (!topic) {
      return NextResponse.json(
        { error: "Topic not found in this roadmap." },
        { status: 404 }
      );
    }
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("study_sessions")
    .insert({
      user_id: user.id,
      roadmap_id: roadmapId,
      topic_id: typeof topicId === "string" && topicId.length > 0 ? topicId : null,
      minutes,
      note: typeof note === "string" && note.length > 0 ? note : null,
    })
    .select("id, minutes, topic_id, logged_at")
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json({ error: "Could not log the session." }, { status: 500 });
  }

  return NextResponse.json(
    {
      id: inserted.id,
      minutes: inserted.minutes,
      topicId: inserted.topic_id,
      loggedAt: inserted.logged_at,
    },
    { status: 201 }
  );
}
