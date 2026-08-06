import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { schedule, type Grade } from "@/lib/recall/scheduler";

// POST /api/recall/[cardId]/grade
// Apply one self-grade to a card: run the scheduler, write the card's next state,
// and append a row to the review log.
//
// This is a SERVER route rather than a direct client write (Architecture §1's
// rule-of-thumb) for one reason: the scheduler's output must be trusted. A client
// that computed its own due_at could hand itself a 3650-day interval and quietly
// opt out of the retention loop the product exists to enforce — the row is
// user-owned, but the *decision* is not the user's to make. RLS still backstops
// ownership; this route adds the integrity the browser can't guarantee.
//
// Rule 15: due-date math runs here, on the server, in UTC.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cardId: string }> }
) {
  const { cardId } = await params;
  const supabase = await createClient();

  // Rule 1: auth-gated. Never trust the client for identity.
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

  // Rule 17: the grade is binary. "close enough" is not a third option — the
  // client can only ever say right or wrong, and anything else is rejected.
  const grade = (body as { grade?: unknown } | null)?.grade;
  if (grade !== "right" && grade !== "wrong") {
    return NextResponse.json(
      { error: "grade must be 'right' or 'wrong'." },
      { status: 400 }
    );
  }

  // Load the card's current scheduler state. The .eq('user_id') is belt-and-braces
  // on top of RLS: under RLS another user's id already returns zero rows, so this
  // 404s rather than leaking whether the card exists (same trick as Phase 1's
  // roadmap pages — 404 is authorization for free).
  const { data: card, error: loadErr } = await supabase
    .from("recall_cards")
    .select("id, ease, interval_days, repetitions")
    .eq("id", cardId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (loadErr) {
    return NextResponse.json({ error: "Could not load the card." }, { status: 500 });
  }
  if (!card) {
    return NextResponse.json({ error: "Card not found." }, { status: 404 });
  }

  const now = new Date();
  const next = schedule(
    {
      ease: Number(card.ease),
      intervalDays: card.interval_days,
      repetitions: card.repetitions,
    },
    grade as Grade,
    now
  );

  const { error: updErr } = await supabase
    .from("recall_cards")
    .update({
      ease: next.ease,
      interval_days: next.intervalDays,
      repetitions: next.repetitions,
      due_at: next.dueAt.toISOString(),
      last_reviewed_at: now.toISOString(),
    })
    .eq("id", cardId)
    .eq("user_id", user.id);

  if (updErr) {
    return NextResponse.json({ error: "Could not save the grade." }, { status: 500 });
  }

  // Append-only review log — this is what session accuracy and the Phase 3
  // accuracy trend read from. A failure here must not undo the card update
  // (the schedule is the user-visible truth), so it's logged, not surfaced.
  await supabase.from("recall_reviews").insert({
    card_id: cardId,
    user_id: user.id,
    grade,
    interval_after: next.intervalDays,
    ease_after: next.ease,
  });

  return NextResponse.json({
    intervalDays: next.intervalDays,
    ease: next.ease,
    repetitions: next.repetitions,
    dueAt: next.dueAt.toISOString(),
  });
}
