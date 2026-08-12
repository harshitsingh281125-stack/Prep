import Header from "@/components/shell/Header";
import ContentArea from "@/components/shell/ContentArea";
import RecallQueue, { type DueCard } from "@/components/recall/RecallQueue";
import { createClient } from "@/lib/supabase/server";
import { LADDER_DAYS, EASE_START, intervalLabel } from "@/lib/recall/scheduler";

export const dynamic = "force-dynamic";

/**
 * Recall screen — today's due queue.
 *
 * The query below is THE one Rule 13 is about:
 *
 *   select ... from recall_cards
 *   where user_id = auth.uid() and due_at <= now()
 *   order by due_at asc;
 *
 * It is served by `recall_due_idx (user_id, due_at)`. user_id leads because it's
 * an equality predicate (and the column RLS filters on), so Postgres seeks
 * directly to this user's slice; due_at follows because it's the range filter AND
 * the sort key, so the walk comes out already ordered — an index range scan, no
 * sort node, no full table scan.
 */
export default async function RecallPage() {
  const supabase = await createClient();

  const nowIso = new Date().toISOString();
  const { data: cards } = await supabase
    .from("recall_cards")
    .select("id, topic_label, question, ease, interval_days, repetitions")
    .lte("due_at", nowIso)
    .order("due_at", { ascending: true });

  const rows = cards ?? [];

  // Phase 4: "nothing is DUE" and "you have no cards AT ALL" are different
  // situations and must not share a screen. Before Phase 4 they could never be
  // confused, because onboarding always seeded a queue from the catalog. Now an
  // AI-generated roadmap invents its own topic names, matches no seeded
  // questions, and legitimately starts with an empty deck — at which point the
  // old copy ("Queue clear. Nothing is due right now.") congratulates a user for
  // keeping up with a retention loop they have never started. That's a vanity
  // metric by accident, which is exactly what Rule 19 exists to prevent.
  const { count: totalCards } = await supabase
    .from("recall_cards")
    .select("id", { count: "exact", head: true });

  // The "+4d" chip shows the gap this card earns on a CORRECT grade — i.e. the
  // next rung of the ladder, nudged by the card's own ease. This mirrors
  // schedule()'s right-branch so the preview matches what the server will decide.
  const due: DueCard[] = rows.map((c) => {
    const reps = c.repetitions ?? 0;
    const ease = Number(c.ease ?? EASE_START);
    const projected =
      reps >= LADDER_DAYS.length
        ? Math.max(1, Math.round((c.interval_days || LADDER_DAYS[LADDER_DAYS.length - 1]) * ease))
        : Math.max(1, Math.round(LADDER_DAYS[reps] * (ease / EASE_START)));

    return {
      id: c.id,
      topicLabel: c.topic_label,
      question: c.question,
      projectedLabel: intervalLabel(projected),
    };
  });

  const subtitle =
    (totalCards ?? 0) === 0
      ? "No cards yet"
      : due.length === 0
        ? "Nothing due right now"
        : `${due.length} question${due.length === 1 ? "" : "s"} due today`;

  return (
    <>
      <Header title="Recall" subtitle={subtitle} />
      <ContentArea maxWidth={740}>
        <RecallQueue cards={due} totalCards={totalCards ?? 0} />
      </ContentArea>
    </>
  );
}
