// The printed recall schedule (Phase 5).
//
// The Recall SCREEN answers "what is due right now" — it is a queue you work.
// A printed page can't be a queue: by the time it is on paper the queue has
// moved. So the print view answers the question paper is actually good at,
// "when does the work land", by bucketing every scheduled card into four spans
// relative to the moment the page was rendered.
//
// PURITY, same discipline as lib/progress/compute.ts and lib/recall/scheduler.ts:
// `now` is injected and no clock is read here, which is the only reason the
// boundary cases (a card due at 23:59 tonight vs 00:01 tomorrow) are assertable
// in a unit test instead of being a thing you eyeball once and hope about.

/** A scheduled card, as the print page reads it out of recall_cards. */
export type ScheduledCard = {
  topicLabel: string;
  dueAt: Date;
};

export type ScheduleBucketKey = "overdue" | "today" | "week" | "later";

export type ScheduleBucket = {
  key: ScheduleBucketKey;
  label: string;
  count: number;
  /** Distinct topic labels in this bucket, most cards first, then alphabetical. */
  topics: string[];
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Bucket boundaries are CALENDAR days in UTC, not rolling 24-hour windows.
 *
 * Rule 15 puts due-date math in UTC on the server, and the scheduler adds whole
 * days — so "today" has to mean the UTC day, or a card the scheduler placed
 * "+1d" could print under *Today* simply because the page was rendered late in
 * the evening. Deriving the day boundary from epoch milliseconds (rather than
 * setUTCHours on a mutable Date) keeps this DST-proof for the same reason
 * addDays in the scheduler does it that way.
 */
function utcDayIndex(d: Date): number {
  return Math.floor(d.getTime() / MS_PER_DAY);
}

/**
 * Group scheduled cards into overdue / today / next 7 days / later.
 *
 * Empty buckets are RETAINED, deliberately. On screen an empty section is
 * clutter you scroll past; on paper it is the information — "nothing lands in
 * the next week" is a fact about your plan, and dropping the row would let the
 * page imply a fuller schedule than the rows support (Rule 19).
 */
export function recallSchedule(cards: ScheduledCard[], now: Date): ScheduleBucket[] {
  const today = utcDayIndex(now);

  const buckets: Record<ScheduleBucketKey, ScheduledCard[]> = {
    overdue: [],
    today: [],
    week: [],
    later: [],
  };

  for (const card of cards) {
    const day = utcDayIndex(card.dueAt);
    if (day < today) buckets.overdue.push(card);
    else if (day === today) buckets.today.push(card);
    // 1..7 days out. The upper bound is inclusive so "this week" is a full seven
    // days of lead time, matching the +4d/+14d rungs the ladder actually uses.
    else if (day - today <= 7) buckets.week.push(card);
    else buckets.later.push(card);
  }

  const labels: Record<ScheduleBucketKey, string> = {
    overdue: "Overdue",
    today: "Due today",
    week: "Next 7 days",
    later: "Later",
  };

  return (Object.keys(labels) as ScheduleBucketKey[]).map((key) => ({
    key,
    label: labels[key],
    count: buckets[key].length,
    topics: distinctTopics(buckets[key]),
  }));
}

/**
 * Distinct topic labels, heaviest first.
 *
 * Ordering by card count rather than by due date is the point: on paper you want
 * "which topic is about to eat your week", and a topic with six cards coming due
 * is a bigger claim on your time than one with a single card that happens to be
 * due an hour earlier. Ties break alphabetically so the page is stable across
 * renders — a report that reshuffles its own rows between two printings is
 * impossible to diff by eye.
 */
function distinctTopics(cards: ScheduledCard[]): string[] {
  const counts = new Map<string, number>();
  for (const c of cards) counts.set(c.topicLabel, (counts.get(c.topicLabel) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => label);
}
