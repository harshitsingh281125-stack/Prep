// Turning raw onboarding answers into the numbers that define a plan's contract.
//
// This lives in ONE place because both generation paths must agree exactly. The
// AI path (lib/ai/validate.ts) and the seeded fallback (lib/seed/generate.ts)
// have to produce a roadmap with the same `weeks_count` and `hours_planned`, or
// falling back would silently hand the user a different plan than the one they
// asked for — and the Phase 3 progress dashboard divides by exactly these
// numbers. They used to be two copies of the same parser kept in sync by a unit
// test; one function is better than a test that catches them drifting.

/**
 * Hard ceiling on plan length.
 *
 * Not cosmetic: `timeline` arrives in the POST body and the route validates its
 * *shape*, not its membership in the option list. Without a clamp, a client
 * posting `"9999 weeks"` would ask the model for 9999 weeks and, on the seeded
 * path, insert 9999 weeks + their topics + notes in one request. The option list
 * tops out at 6 months, so 26 is generous headroom for a real answer and a wall
 * for an absurd one.
 */
export const MAX_WEEKS = 26;
export const DEFAULT_WEEKS = 5;
export const DEFAULT_HOURS_PER_WEEK = 12;
/** Sanity ceiling on weekly hours — 60h/week of interview prep is not a real plan. */
export const MAX_HOURS_PER_WEEK = 60;

/**
 * Weeks from a timeline answer.
 *
 * Handles the unit, which a bare "first integer in the string" parser does not:
 * `"6 months"` is 24 weeks, not 6. That was a live bug the moment month-scale
 * options were added — the old parser would have quietly built a six-WEEK plan
 * for someone who said they had six months, and every pace figure on the
 * progress dashboard would have been measured against it.
 */
export function parseTimelineWeeks(timeline: string): number {
  const s = String(timeline);

  const withUnit = s.match(/(\d+)\s*(week|month)/i);
  if (withUnit) {
    const n = Number(withUnit[1]);
    const weeks = /month/i.test(withUnit[2]) ? n * 4 : n;
    return clamp(weeks, 1, MAX_WEEKS);
  }

  // A bare number means weeks ("8"), and anything with no number at all
  // ("No date yet") takes the default.
  const bare = s.match(/\d+/);
  return clamp(bare ? Number(bare[0]) : DEFAULT_WEEKS, 1, MAX_WEEKS);
}

/** Hours per week from an hours answer ("12h" → 12; "As much as it takes" → default). */
export function parseHoursPerWeek(hours: string): number {
  const m = String(hours).match(/\d+/);
  return clamp(m ? Number(m[0]) : DEFAULT_HOURS_PER_WEEK, 1, MAX_HOURS_PER_WEEK);
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * The plan's contract: the numbers the user chose, which the model is never
 * asked for and cannot change (see lib/ai/validate.ts).
 */
export function planContract(answers: { timeline: string; hours: string }): {
  weeksCount: number;
  perWeekHours: number;
} {
  return {
    weeksCount: parseTimelineWeeks(answers.timeline),
    perWeekHours: parseHoursPerWeek(answers.hours),
  };
}
