// The spaced-repetition scheduler (Phase 2) — written by hand, no library
// (Rule 14: it must be derivable from scratch with no notes).
//
// ---------------------------------------------------------------------------
// THE ALGORITHM, IN ONE PARAGRAPH (this is the "explain it cold" version)
// ---------------------------------------------------------------------------
// Each card carries three numbers: `repetitions` (how many times in a row you
// got it right), `intervalDays` (how long the current gap is), and `ease` (how
// easy THIS card is for YOU, 1.3–2.8, starting at 2.5).
//
// Get it RIGHT: you climb a fixed ladder of gaps — 1d, 4d, 14d, 30d — which is
// the cadence the product's UI advertises. `repetitions` is your rung. Ease
// nudges the rung: the interval is `ladder[rung] * (ease / 2.5)`, so a card you
// keep nailing (ease drifting up) stretches past the nominal gap, and a card you
// keep fumbling (ease drifting down) stays tighter than the nominal gap. Past
// the top rung there is no ladder left, so it switches to pure multiplicative
// growth: `previousInterval * ease`. Ease itself moves +0.1 per correct grade.
//
// Get it WRONG: hard reset (Rule 17 — "close enough" is a miss, and a miss is a
// miss). `repetitions` → 0, `intervalDays` → 1, so you see it again tomorrow.
// Ease takes a -0.2 penalty that PERSISTS across the reset — that's the memory
// of the card being hard for you, so a repeatedly-missed card climbs the same
// ladder more slowly the next time round.
//
// WHY THIS VARIANT, NOT TEXTBOOK SM-2: SM-2 derives its intervals purely from
// ease (1, 6, then prev*ease) and grades on a 0–5 scale. Prep self-grades with a
// binary Got it / Missed, which collapses SM-2's ease formula to two cases
// anyway — and SM-2's 1/6/15/38 gaps don't match the +1/+4/+14/+30 schedule the
// Recall screen shows the user. So: keep the ladder the product promises as the
// backbone, keep the per-card adaptivity that makes SM-2 actually work, and be
// explicit that it's a justified variant rather than pretending it's SM-2.
// ---------------------------------------------------------------------------

/** The advertised cadence — the chips rendered in the Recall screen's header. */
export const LADDER_DAYS = [1, 4, 14, 30] as const;

/** Ease bounds. 2.5 is the SM-2 starting value; 1.3 its classic floor. */
export const EASE_START = 2.5;
export const EASE_MIN = 1.3;
export const EASE_MAX = 2.8;

/** How much a single grade moves the ease factor. */
export const EASE_RIGHT_STEP = 0.1;
export const EASE_WRONG_PENALTY = 0.2;

export type Grade = "right" | "wrong";

/** The scheduler state stored on a recall_cards row. */
export type CardState = {
  ease: number;
  intervalDays: number;
  repetitions: number;
};

/** What the scheduler decides: the card's next state + when it comes back. */
export type ScheduleResult = CardState & {
  dueAt: Date;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Round to 2dp so `ease` doesn't accumulate float dust in the numeric column. */
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Apply one grade to a card and return its next scheduling state.
 *
 * Pure: no clock reads, no DB. `now` is injected so the caller (and the tests)
 * control time — Rule 15 says due-date math happens in UTC on the server, and a
 * pure function is the only way to assert that math deterministically.
 */
export function schedule(state: CardState, grade: Grade, now: Date): ScheduleResult {
  const prevEase = clamp(state.ease, EASE_MIN, EASE_MAX);
  const prevInterval = Math.max(0, state.intervalDays);
  const prevReps = Math.max(0, state.repetitions);

  let ease: number;
  let intervalDays: number;
  let repetitions: number;

  if (grade === "wrong") {
    // Rule 17: a miss resets to the shortest interval. Never soften this.
    // The ease penalty persists through the reset — the card stays "hard".
    ease = clamp(prevEase - EASE_WRONG_PENALTY, EASE_MIN, EASE_MAX);
    intervalDays = 1;
    repetitions = 0;
  } else {
    ease = clamp(prevEase + EASE_RIGHT_STEP, EASE_MIN, EASE_MAX);
    repetitions = prevReps + 1;

    if (prevReps >= LADDER_DAYS.length) {
      // Past the top rung: no ladder left, so grow multiplicatively (SM-2 style).
      // Guard the degenerate prevInterval === 0 case (a card whose repetitions
      // were advanced without an interval) by falling back to the top rung.
      const base = prevInterval > 0 ? prevInterval : LADDER_DAYS[LADDER_DAYS.length - 1];
      intervalDays = Math.max(1, Math.round(base * ease));
    } else {
      // On the ladder: take the rung for the rep count we just *completed*, and
      // let ease stretch or compress it around the nominal gap.
      const base = LADDER_DAYS[prevReps];
      intervalDays = Math.max(1, Math.round(base * (ease / EASE_START)));
    }
  }

  return {
    ease: round2(ease),
    intervalDays,
    repetitions,
    dueAt: addDays(now, intervalDays),
  };
}

/**
 * Add whole days to an instant. Uses epoch-millisecond arithmetic deliberately:
 * it is DST-proof (a "day" is always 24h of real time) and stays in UTC, which
 * is what Rule 15 requires. Calendar-field math (setDate) would drift by an hour
 * across a DST boundary in a local timezone.
 */
export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/** The starting state for a freshly-seeded card: due immediately, never reviewed. */
export function initialState(): CardState {
  return { ease: EASE_START, intervalDays: 0, repetitions: 0 };
}

/**
 * Human label for a card's next gap, matching the design's "+4d" chip format.
 */
export function intervalLabel(days: number): string {
  return `+${days}d`;
}
