import { describe, expect, it } from "vitest";
import {
  schedule,
  addDays,
  initialState,
  intervalLabel,
  LADDER_DAYS,
  EASE_START,
  EASE_MIN,
  EASE_MAX,
  type CardState,
} from "@/lib/recall/scheduler";

// Unit tests for the hand-written spaced-repetition scheduler (Phase 2, Rule 14).
// Pure function with injected `now`, so the whole algorithm — ladder, ease
// modifier, hard reset — is testable directly with no browser and no DB.
// The stateful/RLS side lives in tests/e2e/recall.spec.ts.

const NOW = new Date("2026-08-01T12:00:00.000Z");

/** Days between `now` and a result's dueAt — the assertion that actually matters. */
function gapDays(dueAt: Date, from: Date = NOW): number {
  return Math.round((dueAt.getTime() - from.getTime()) / 86_400_000);
}

describe("schedule() — the correct-answer ladder", () => {
  it("first correct review schedules +1d (the first rung)", () => {
    const r = schedule(initialState(), "right", NOW);
    expect(r.repetitions).toBe(1);
    expect(r.intervalDays).toBe(1);
    expect(gapDays(r.dueAt)).toBe(1);
  });

  it("walks 1 → 4 → 14 → 30 across four consecutive correct grades", () => {
    // Ease climbs +0.1 each time, so intervals stretch slightly past the nominal
    // rung. Assert the ladder shape by checking each is >= its nominal rung and
    // strictly increasing — the ease modifier is verified separately below.
    let state: CardState = initialState();
    const gaps: number[] = [];

    for (let i = 0; i < 4; i++) {
      const r = schedule(state, "right", NOW);
      gaps.push(r.intervalDays);
      state = { ease: r.ease, intervalDays: r.intervalDays, repetitions: r.repetitions };
    }

    expect(state.repetitions).toBe(4);
    // Each gap is at least its nominal rung (ease only ever climbs on correct).
    gaps.forEach((g, i) => expect(g).toBeGreaterThanOrEqual(LADDER_DAYS[i]));
    // And the sequence is strictly increasing — the whole point of spacing.
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
  });

  it("past the top rung it grows multiplicatively (prevInterval * ease)", () => {
    // repetitions already past the ladder → no rung left, so SM-2-style growth.
    const state: CardState = { ease: 2.5, intervalDays: 30, repetitions: 4 };
    const r = schedule(state, "right", NOW);
    // ease becomes 2.6, so 30 * 2.6 = 78
    expect(r.ease).toBe(2.6);
    expect(r.intervalDays).toBe(78);
    expect(gapDays(r.dueAt)).toBe(78);
  });

  it("a high-ease card stretches past the nominal rung", () => {
    // Second rung is 14d nominal; ease 2.8 → 14 * (2.8/2.5) = 15.68 → 16
    const state: CardState = { ease: EASE_MAX, intervalDays: 4, repetitions: 2 };
    const r = schedule(state, "right", NOW);
    expect(r.intervalDays).toBe(16);
    expect(r.intervalDays).toBeGreaterThan(LADDER_DAYS[2]);
  });

  it("a low-ease card stays tighter than the nominal rung", () => {
    // Same rung (14d nominal) but a card the user keeps fumbling: ease 1.3
    // becomes 1.4 → 14 * (1.4/2.5) = 7.84 → 8. Shorter than nominal, by design.
    const state: CardState = { ease: EASE_MIN, intervalDays: 4, repetitions: 2 };
    const r = schedule(state, "right", NOW);
    expect(r.intervalDays).toBe(8);
    expect(r.intervalDays).toBeLessThan(LADDER_DAYS[2]);
  });
});

describe("schedule() — a miss is a miss (Rule 17)", () => {
  it("resets a long-interval card all the way to +1d", () => {
    // A card 78 days out, 5 reps deep — one miss and it's back to tomorrow.
    const state: CardState = { ease: 2.6, intervalDays: 78, repetitions: 5 };
    const r = schedule(state, "wrong", NOW);
    expect(r.intervalDays).toBe(1);
    expect(r.repetitions).toBe(0);
    expect(gapDays(r.dueAt)).toBe(1);
  });

  it("applies the ease penalty, and the penalty persists past the reset", () => {
    const state: CardState = { ease: 2.5, intervalDays: 14, repetitions: 3 };
    const missed = schedule(state, "wrong", NOW);
    expect(missed.ease).toBe(2.3); // 2.5 - 0.2

    // Re-climbing the ladder from the penalised ease gives a SHORTER first rung
    // than a fresh card would get — the card is remembered as hard.
    const relearned = schedule(
      { ease: missed.ease, intervalDays: missed.intervalDays, repetitions: missed.repetitions },
      "right",
      NOW
    );
    const fresh = schedule(initialState(), "right", NOW);
    expect(relearned.ease).toBeLessThan(fresh.ease);
  });

  it("never schedules a miss further out than one day, whatever the ease", () => {
    for (const ease of [EASE_MIN, 2.0, EASE_START, EASE_MAX]) {
      const r = schedule({ ease, intervalDays: 30, repetitions: 4 }, "wrong", NOW);
      expect(r.intervalDays).toBe(1);
    }
  });
});

describe("schedule() — ease bounds", () => {
  it("clamps ease at the floor after repeated misses", () => {
    let state: CardState = initialState();
    for (let i = 0; i < 20; i++) {
      const r = schedule(state, "wrong", NOW);
      state = { ease: r.ease, intervalDays: r.intervalDays, repetitions: r.repetitions };
    }
    expect(state.ease).toBe(EASE_MIN);
    expect(state.ease).toBeGreaterThanOrEqual(EASE_MIN);
  });

  it("clamps ease at the ceiling after repeated correct grades", () => {
    let state: CardState = initialState();
    for (let i = 0; i < 20; i++) {
      const r = schedule(state, "right", NOW);
      state = { ease: r.ease, intervalDays: r.intervalDays, repetitions: r.repetitions };
    }
    expect(state.ease).toBe(EASE_MAX);
    expect(state.ease).toBeLessThanOrEqual(EASE_MAX);
  });

  it("clamps an out-of-range stored ease before using it", () => {
    // Defensive: a hand-edited/corrupt row must not produce a wild interval.
    const r = schedule({ ease: 99, intervalDays: 1, repetitions: 0 }, "right", NOW);
    expect(r.ease).toBeLessThanOrEqual(EASE_MAX);
  });
});

describe("schedule() — edge cases", () => {
  it("never returns an interval below 1 day", () => {
    // Degenerate stored state (zero interval past the ladder) must not yield 0.
    const r = schedule({ ease: EASE_MIN, intervalDays: 0, repetitions: 9 }, "right", NOW);
    expect(r.intervalDays).toBeGreaterThanOrEqual(1);
  });

  it("treats negative stored values as zero rather than propagating them", () => {
    const r = schedule({ ease: 2.5, intervalDays: -5, repetitions: -3 }, "right", NOW);
    expect(r.intervalDays).toBeGreaterThanOrEqual(1);
    expect(r.repetitions).toBe(1);
  });

  it("rounds ease to 2dp so the numeric column doesn't accumulate float dust", () => {
    let state: CardState = initialState();
    for (let i = 0; i < 3; i++) {
      const r = schedule(state, "right", NOW);
      state = { ease: r.ease, intervalDays: r.intervalDays, repetitions: r.repetitions };
    }
    expect(state.ease).toBe(Math.round(state.ease * 100) / 100);
  });

  it("is pure — grading twice from the same state gives the same answer", () => {
    const state: CardState = { ease: 2.4, intervalDays: 4, repetitions: 1 };
    const a = schedule(state, "right", NOW);
    const b = schedule(state, "right", NOW);
    expect(a).toEqual(b);
    // and the input object was not mutated
    expect(state).toEqual({ ease: 2.4, intervalDays: 4, repetitions: 1 });
  });
});

describe("addDays() — UTC / DST safety (Rule 15)", () => {
  it("adds exactly 24h per day in epoch terms", () => {
    const from = new Date("2026-08-01T12:00:00.000Z");
    expect(addDays(from, 1).toISOString()).toBe("2026-08-02T12:00:00.000Z");
    expect(addDays(from, 30).toISOString()).toBe("2026-08-31T12:00:00.000Z");
  });

  it("does not drift across a DST boundary", () => {
    // 2026-03-29 is the EU DST switch; epoch math must stay exactly 24h.
    const from = new Date("2026-03-28T12:00:00.000Z");
    const next = addDays(from, 1);
    expect(next.getTime() - from.getTime()).toBe(86_400_000);
    expect(next.toISOString()).toBe("2026-03-29T12:00:00.000Z");
  });
});

describe("intervalLabel()", () => {
  it("formats the design's +Nd chip", () => {
    expect(intervalLabel(1)).toBe("+1d");
    expect(intervalLabel(30)).toBe("+30d");
  });
});
