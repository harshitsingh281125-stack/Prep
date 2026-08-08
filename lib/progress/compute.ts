// The progress aggregation (Phase 3) — every number the dashboard shows is
// derived here, from real rows. Nothing on the Progress screen is hard-coded.
//
// ---------------------------------------------------------------------------
// THE MODEL, IN ONE PARAGRAPH (the "explain it cold" version)
// ---------------------------------------------------------------------------
// A roadmap is a promise: `hoursPlanned` hours spread over `weeksCount` weeks.
// Pace asks one question — given how long the plan has been running, how much of
// that promise should already be paid? We measure elapsed time in WHOLE WEEKS
// since the roadmap was created, cap it at the plan's length, and multiply by the
// weekly rate. Everything else (the banner, the status chip, the blockers) is a
// comparison between that expectation and what the study_sessions rows actually
// say. Rule 19: the headline is honest pace-vs-plan, including "behind".
//
// WHY WHOLE ELAPSED WEEKS, NOT A CONTINUOUS FRACTION: the plan is authored in
// week-sized blocks with week-sized kill criteria, so a person is "a week
// behind", never "0.42 weeks behind". Prorating by the hour would also declare
// you behind pace a few hours after you create a roadmap, which is both useless
// and demoralising — with whole weeks, a fresh roadmap expects 0 hours and
// therefore cannot be behind on day one. See memory.md (2026-08-08).
//
// PURITY: every function here takes `now` (and its data) as arguments and reads
// no clock and no DB — the same discipline as lib/recall/scheduler.ts, and the
// only reason the date-boundary behaviour is assertable in unit tests (Rule 15:
// the math is UTC, done on the server).
// ---------------------------------------------------------------------------

import type { RoadmapStatus } from "@/lib/seed/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** A logged block of study time, as stored (minutes) + where it was spent. */
export type SessionRow = {
  minutes: number;
  /** null when the session was logged against no topic, or its topic was deleted. */
  topicId: string | null;
  loggedAt: Date;
};

/** One grade from recall_reviews — the raw material for the accuracy trend. */
export type ReviewRow = {
  grade: "right" | "wrong";
  reviewedAt: Date;
};

/** A week of the plan, with the topics that resolve sessions onto its bar. */
export type WeekRow = {
  id: string;
  n: number;
  title: string;
  /** The week's planned hours (weeks.hours) — the grey bar. */
  hours: number;
  topicIds: string[];
  masteredCount: number;
  topicCount: number;
};

export type RoadmapRow = {
  createdAt: Date;
  weeksCount: number;
  hoursPlanned: number;
};

// ---------------------------------------------------------------------------
// Pace
// ---------------------------------------------------------------------------

/**
 * Whole weeks elapsed since the roadmap started, capped at the plan's length.
 *
 * Day 0-6 => 0 elapsed weeks (a brand-new roadmap owes nothing yet, so it can
 * never be "behind" on day one). Day 7 => 1. The cap matters because past the
 * final week the expectation is the WHOLE plan, not a number that keeps growing
 * — an abandoned 5-week roadmap is "19 hours short", not "500 hours short".
 *
 * Epoch-millisecond arithmetic, deliberately: DST-proof and UTC-stable, exactly
 * as in the scheduler's addDays.
 */
export function weeksElapsed(createdAt: Date, now: Date, weeksCount: number): number {
  const raw = Math.floor((now.getTime() - createdAt.getTime()) / MS_PER_WEEK);
  const clamped = Math.max(0, raw);
  return Math.min(clamped, Math.max(0, weeksCount));
}

/**
 * The hours that *should* be logged by now — the denominator of the whole
 * dashboard. Guards weeksCount === 0 so a malformed roadmap can't divide by zero.
 */
export function expectedHoursByNow(roadmap: RoadmapRow, now: Date): number {
  if (roadmap.weeksCount <= 0) return 0;
  const perWeek = roadmap.hoursPlanned / roadmap.weeksCount;
  return round1(weeksElapsed(roadmap.createdAt, now, roadmap.weeksCount) * perWeek);
}

/** Total hours actually logged. Minutes are summed as integers, THEN converted. */
export function hoursLogged(sessions: SessionRow[]): number {
  return round1(sessions.reduce((sum, s) => sum + s.minutes, 0) / 60);
}

/**
 * Observed pace in hours/week, measured over elapsed time — the honest reading.
 *
 * Divides by elapsed weeks, NOT by weeks in which you happened to study: a week
 * where you logged nothing is exactly the week that should drag the average
 * down. Before a full week has elapsed there's no rate to report yet (null),
 * which the UI renders as "—" rather than inventing an infinite pace.
 */
export function observedPace(
  sessions: SessionRow[],
  roadmap: RoadmapRow,
  now: Date
): number | null {
  const elapsed = weeksElapsed(roadmap.createdAt, now, roadmap.weeksCount);
  if (elapsed <= 0) return null;
  return round1(hoursLogged(sessions) / elapsed);
}

/** The plan's required rate, for the "need 12" half of the pace tile. */
export function requiredPace(roadmap: RoadmapRow): number {
  if (roadmap.weeksCount <= 0) return 0;
  return round1(roadmap.hoursPlanned / roadmap.weeksCount);
}

/** Days since the most recent session; null if nothing has ever been logged. */
export function daysSinceLastSession(sessions: SessionRow[], now: Date): number | null {
  if (sessions.length === 0) return null;
  const latest = Math.max(...sessions.map((s) => s.loggedAt.getTime()));
  return Math.max(0, Math.floor((now.getTime() - latest) / MS_PER_DAY));
}

/**
 * Projected overrun: at the observed pace, how many days past the target does
 * the plan finish? Null when there's no pace yet or you're at/ahead of rate
 * (nothing to warn about). This is the banner's "~18 days past" claim.
 */
export function projectedDaysLate(
  sessions: SessionRow[],
  roadmap: RoadmapRow,
  now: Date
): number | null {
  const pace = observedPace(sessions, roadmap, now);
  const required = requiredPace(roadmap);
  if (pace === null || pace <= 0 || required <= 0 || pace >= required) return null;

  const remainingHours = Math.max(0, roadmap.hoursPlanned - hoursLogged(sessions));
  const weeksNeeded = remainingHours / pace;
  const weeksRemainingInPlan = Math.max(
    0,
    roadmap.weeksCount - weeksElapsed(roadmap.createdAt, now, roadmap.weeksCount)
  );
  const overrunWeeks = weeksNeeded - weeksRemainingInPlan;
  if (overrunWeeks <= 0) return null;
  return Math.round(overrunWeeks * 7);
}

// ---------------------------------------------------------------------------
// Status — derived on read, never persisted (settled 2026-08-08)
// ---------------------------------------------------------------------------

/** How far below expectation counts as "behind" rather than noise. */
export const BEHIND_RATIO = 0.8;
/** Silence for this many days with a started plan = stalled, not merely behind. */
export const STALLED_DAYS = 14;

/**
 * Derive a roadmap's status from real data.
 *
 * Order matters, most-specific first:
 *   done    — every topic mastered (Rule 16: mastery is earned, so this is a
 *             real achievement, not a percentage of hours burned).
 *   fresh   — nothing logged AND nothing yet expected: a new roadmap is not
 *             failing, it just hasn't started. (Once hours ARE expected and
 *             none are logged, it is NOT fresh — it falls through to behind.)
 *   stalled — was genuinely started, then went quiet for STALLED_DAYS.
 *   behind  — logged less than BEHIND_RATIO of what was expected by now.
 *   ontrack — everything else.
 *
 * This replaces the roadmaps.status COLUMN, which is left at its default and no
 * longer read: a stored status is a lie the moment time passes without a write —
 * a roadmap would only decay into "stalled" when you touched it, which is
 * precisely backwards. Computing on read cannot go stale.
 */
export function deriveStatus(
  input: {
    roadmap: RoadmapRow;
    sessions: SessionRow[];
    topicCount: number;
    masteredCount: number;
  },
  now: Date
): RoadmapStatus {
  const { roadmap, sessions, topicCount, masteredCount } = input;

  if (topicCount > 0 && masteredCount >= topicCount) return "done";

  const logged = hoursLogged(sessions);
  const expected = expectedHoursByNow(roadmap, now);

  if (logged <= 0) return expected <= 0 ? "fresh" : "behind";

  const idle = daysSinceLastSession(sessions, now);
  if (idle !== null && idle >= STALLED_DAYS) return "stalled";

  // Round the threshold to the same 1dp precision as `logged` before comparing.
  // Without this, binary floating point decides the boundary case: 12 * 0.8 is
  // 9.600000000000001, so a user who logged exactly 9.6h against a 12h
  // expectation would be told they are BEHIND PACE by 1.8e-15 hours. Comparing
  // two values rounded to the same precision is the fix; nudging with an epsilon
  // would just move the arbitrary line somewhere less obvious.
  if (expected > 0 && logged < round1(expected * BEHIND_RATIO)) return "behind";

  return "ontrack";
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

export type WeekBar = {
  label: string;
  loggedHours: number;
  plannedHours: number;
};

/**
 * The hours chart: one logged/planned pair per week.
 *
 * A session lands on a week's bar via its topic (topicId -> the week owning that
 * topic), NOT via when it was logged — the chart answers "what did you study",
 * which is what makes a "Week 3 hasn't started" blocker literally true rather
 * than merely suggestive. Sessions with no topic (or whose topic was deleted,
 * hence the `set null` FK) are unattributed: they count in total hours logged
 * but fill no bar, so the bars can legitimately sum to less than the total.
 */
export function weekBars(weeks: WeekRow[], sessions: SessionRow[]): WeekBar[] {
  const minutesByTopic = new Map<string, number>();
  for (const s of sessions) {
    if (!s.topicId) continue;
    minutesByTopic.set(s.topicId, (minutesByTopic.get(s.topicId) ?? 0) + s.minutes);
  }

  return weeks
    .slice()
    .sort((a, b) => a.n - b.n)
    .map((w) => {
      const minutes = w.topicIds.reduce((sum, id) => sum + (minutesByTopic.get(id) ?? 0), 0);
      return {
        label: `W${w.n}`,
        loggedHours: round1(minutes / 60),
        plannedHours: w.hours,
      };
    });
}

export type AccuracyPoint = { index: number; accuracy: number };

/**
 * The recall-accuracy trend: reviews bucketed into equal-sized chunks, oldest
 * first, each plotted as its percent-correct.
 *
 * Bucketing by COUNT rather than by calendar day is deliberate — study is bursty,
 * so day-buckets are mostly empty gaps, whereas "your last N reviews" is a dense
 * series that actually shows whether accuracy is climbing. Needs at least
 * `bucketSize` reviews to plot anything; below that the UI shows an empty state
 * instead of a misleading two-point "trend".
 */
export function accuracyTrend(
  reviews: ReviewRow[],
  bucketCount = 8,
  bucketSize = 3
): AccuracyPoint[] {
  if (reviews.length < bucketSize) return [];

  const ordered = reviews
    .slice()
    .sort((a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime());

  // Keep only the most recent whole buckets.
  const usable = Math.min(Math.floor(ordered.length / bucketSize), bucketCount);
  const tail = ordered.slice(ordered.length - usable * bucketSize);

  const points: AccuracyPoint[] = [];
  for (let i = 0; i < usable; i++) {
    const chunk = tail.slice(i * bucketSize, (i + 1) * bucketSize);
    const right = chunk.filter((r) => r.grade === "right").length;
    points.push({ index: i, accuracy: Math.round((right / chunk.length) * 100) });
  }
  return points;
}

/** Overall percent-correct across every review; null when there are none. */
export function overallAccuracy(reviews: ReviewRow[]): number | null {
  if (reviews.length === 0) return null;
  const right = reviews.filter((r) => r.grade === "right").length;
  return Math.round((right / reviews.length) * 100);
}

/**
 * Describe the trend's direction by comparing the first and last buckets.
 * "flat" is the honest default — a 4-point wobble is not a rise, and Rule 19
 * forbids dressing noise up as progress.
 */
export function trendDirection(points: AccuracyPoint[]): "rising" | "falling" | "flat" {
  if (points.length < 2) return "flat";
  const delta = points[points.length - 1].accuracy - points[0].accuracy;
  if (delta >= 5) return "rising";
  if (delta <= -5) return "falling";
  return "flat";
}

// ---------------------------------------------------------------------------
// Blockers — the "what's actually blocking you" list
// ---------------------------------------------------------------------------

export type Blocker = { head: string; body: string };

/**
 * Build the blockers list from real signals, most-actionable first.
 *
 * Each entry must be a fact traceable to a row, not encouragement — the screen's
 * whole value is that it says the uncomfortable thing (Rule 19). If nothing is
 * genuinely wrong, this returns [] and the UI says so; it never invents a
 * blocker to fill space.
 */
export function buildBlockers(
  input: {
    roadmap: RoadmapRow;
    weeks: WeekRow[];
    sessions: SessionRow[];
    reviews: ReviewRow[];
  },
  now: Date
): Blocker[] {
  const { roadmap, weeks, sessions, reviews } = input;
  const blockers: Blocker[] = [];

  // 1. The heaviest week that has had zero hours spent on it, once the plan is
  //    far enough along that it should have been reached.
  const bars = weekBars(weeks, sessions);
  const untouched = weeks
    .slice()
    .sort((a, b) => a.n - b.n)
    .filter((w, i) => bars[i] && bars[i].loggedHours === 0)
    .sort((a, b) => b.hours - a.hours)[0];

  const elapsed = weeksElapsed(roadmap.createdAt, now, roadmap.weeksCount);
  if (untouched && elapsed >= untouched.n) {
    blockers.push({
      head: `Week ${untouched.n} (${untouched.title}) hasn't started.`,
      body: `It's ${untouched.hours}h of planned work and you're already ${elapsed} week${
        elapsed === 1 ? "" : "s"
      } in. Every day you delay compresses it into less time.`,
    });
  }

  // 2. Silence. Uses the plan's own daily rate so the number is specific to this
  //    roadmap rather than a generic scold.
  const idle = daysSinceLastSession(sessions, now);
  const perWeek = requiredPace(roadmap);
  if (idle !== null && idle >= 3) {
    blockers.push({
      head: `0 hours logged in the last ${idle} days.`,
      body: `Your ${perWeek}h/week plan assumes about ${round1(perWeek / 7)}h a day. That gap has to come out of a later week.`,
    });
  } else if (idle === null && expectedHoursByNow(roadmap, now) > 0) {
    blockers.push({
      head: "No study hours logged at all.",
      body: `This plan expected about ${expectedHoursByNow(roadmap, now)}h by now. Nothing has been logged against it yet.`,
    });
  }

  // 3. Recall accuracy that is not improving — reviewing without learning.
  const points = accuracyTrend(reviews);
  const overall = overallAccuracy(reviews);
  const dir = trendDirection(points);
  if (points.length >= 2 && overall !== null && dir !== "rising" && overall < 80) {
    blockers.push({
      head: `Recall accuracy is ${dir}, not rising.`,
      body: `You're at ${overall}% across ${reviews.length} reviews. Reviewing isn't the same as learning — you're re-missing the same cards.`,
    });
  }

  return blockers;
}

/** Round to 1dp so summed hours don't render as 12.000000000000002. */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
