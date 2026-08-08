import { describe, expect, it } from "vitest";
import {
  accuracyTrend,
  buildBlockers,
  daysSinceLastSession,
  deriveStatus,
  expectedHoursByNow,
  hoursLogged,
  observedPace,
  overallAccuracy,
  projectedDaysLate,
  requiredPace,
  trendDirection,
  weekBars,
  weeksElapsed,
  BEHIND_RATIO,
  STALLED_DAYS,
  type ReviewRow,
  type SessionRow,
  type WeekRow,
} from "@/lib/progress/compute";

// Unit tests for the Phase 3 progress aggregation. Every function is pure with
// `now` injected, so the whole dashboard's arithmetic — pace, status thresholds,
// week attribution, the accuracy trend — is testable with no browser and no DB.
// The stateful/RLS side lives in tests/e2e/sessions.spec.ts.

const NOW = new Date("2026-08-08T12:00:00.000Z");

/** A roadmap created `days` before NOW. */
function roadmapCreated(days: number, weeksCount = 5, hoursPlanned = 60) {
  return {
    createdAt: new Date(NOW.getTime() - days * 86_400_000),
    weeksCount,
    hoursPlanned,
  };
}

/** A session logged `daysAgo` before NOW. */
function session(minutes: number, daysAgo = 0, topicId: string | null = null): SessionRow {
  return {
    minutes,
    topicId,
    loggedAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
  };
}

function review(grade: "right" | "wrong", daysAgo: number): ReviewRow {
  return { grade, reviewedAt: new Date(NOW.getTime() - daysAgo * 86_400_000) };
}

// ---------------------------------------------------------------------------
describe("weeksElapsed() — whole weeks, floored and capped", () => {
  it("is 0 for the first six days (a fresh roadmap owes nothing yet)", () => {
    expect(weeksElapsed(roadmapCreated(0).createdAt, NOW, 5)).toBe(0);
    expect(weeksElapsed(roadmapCreated(6).createdAt, NOW, 5)).toBe(0);
  });

  it("ticks to 1 exactly at day 7", () => {
    expect(weeksElapsed(roadmapCreated(7).createdAt, NOW, 5)).toBe(1);
  });

  it("floors partial weeks rather than prorating", () => {
    expect(weeksElapsed(roadmapCreated(13).createdAt, NOW, 5)).toBe(1);
    expect(weeksElapsed(roadmapCreated(14).createdAt, NOW, 5)).toBe(2);
  });

  it("caps at the plan length so an abandoned roadmap doesn't grow forever", () => {
    expect(weeksElapsed(roadmapCreated(365).createdAt, NOW, 5)).toBe(5);
  });

  it("never goes negative for a future-dated roadmap", () => {
    expect(weeksElapsed(new Date(NOW.getTime() + 86_400_000), NOW, 5)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("expectedHoursByNow() — the dashboard's denominator", () => {
  it("expects zero hours on day one, so a new roadmap can never be behind", () => {
    expect(expectedHoursByNow(roadmapCreated(0), NOW)).toBe(0);
  });

  it("expects one week's worth after one elapsed week", () => {
    // 60h over 5 weeks = 12h/week
    expect(expectedHoursByNow(roadmapCreated(7), NOW)).toBe(12);
  });

  it("expects the whole plan once the timeline has run out", () => {
    expect(expectedHoursByNow(roadmapCreated(90), NOW)).toBe(60);
  });

  it("returns 0 rather than dividing by zero on a malformed roadmap", () => {
    expect(expectedHoursByNow({ ...roadmapCreated(30), weeksCount: 0 }, NOW)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("hoursLogged() — integer minutes summed, then converted", () => {
  it("sums minutes exactly and converts once at the end", () => {
    // 3 x 50min = 150min = 2.5h. Summing hours first would give 0.83*3 float dust.
    expect(hoursLogged([session(50), session(50), session(50)])).toBe(2.5);
  });

  it("is 0 for no sessions", () => {
    expect(hoursLogged([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("observedPace() / requiredPace()", () => {
  it("is null before a full week has elapsed (no rate to report yet)", () => {
    expect(observedPace([session(600)], roadmapCreated(3), NOW)).toBeNull();
  });

  it("divides by elapsed weeks, not by weeks in which you studied", () => {
    // 2 weeks elapsed, 10h logged all in week 1 => 5 h/wk, not 10.
    const pace = observedPace([session(600, 10)], roadmapCreated(14), NOW);
    expect(pace).toBe(5);
  });

  it("requiredPace is the plan's own weekly rate", () => {
    expect(requiredPace(roadmapCreated(0))).toBe(12);
    expect(requiredPace({ ...roadmapCreated(0), weeksCount: 0 })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("daysSinceLastSession()", () => {
  it("is null when nothing has ever been logged", () => {
    expect(daysSinceLastSession([], NOW)).toBeNull();
  });

  it("uses the most recent session, not the oldest", () => {
    expect(daysSinceLastSession([session(60, 30), session(60, 2)], NOW)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
describe("projectedDaysLate()", () => {
  it("is null when you're at or above the required rate", () => {
    // 2 weeks elapsed, 24h logged = 12 h/wk = exactly required.
    expect(projectedDaysLate([session(1440, 1)], roadmapCreated(14), NOW)).toBeNull();
  });

  it("projects an overrun when the observed pace can't finish in time", () => {
    // 2 weeks elapsed of a 5-week/60h plan, only 6h logged => 3 h/wk.
    // 54h remaining at 3 h/wk = 18 weeks, vs 3 weeks left => 15 weeks late.
    const late = projectedDaysLate([session(360, 1)], roadmapCreated(14), NOW);
    expect(late).toBe(105);
  });

  it("is null when no pace exists yet", () => {
    expect(projectedDaysLate([], roadmapCreated(2), NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("deriveStatus() — computed on read, never stored", () => {
  const base = { topicCount: 15, masteredCount: 0 };

  it("is 'fresh' when nothing is logged AND nothing is expected yet", () => {
    expect(deriveStatus({ ...base, roadmap: roadmapCreated(2), sessions: [] }, NOW)).toBe("fresh");
  });

  it("is 'behind' — NOT fresh — when hours were expected and none were logged", () => {
    // The important asymmetry: an untouched roadmap that is two weeks old is
    // failing, not new.
    expect(deriveStatus({ ...base, roadmap: roadmapCreated(14), sessions: [] }, NOW)).toBe("behind");
  });

  it("is 'ontrack' when logged hours meet expectation", () => {
    expect(
      deriveStatus({ ...base, roadmap: roadmapCreated(7), sessions: [session(720, 1)] }, NOW)
    ).toBe("ontrack");
  });

  it(`is 'behind' below ${BEHIND_RATIO} of expectation`, () => {
    // 1 week elapsed => 12h expected. 9h = 0.75 < 0.8 threshold.
    expect(
      deriveStatus({ ...base, roadmap: roadmapCreated(7), sessions: [session(540, 1)] }, NOW)
    ).toBe("behind");
  });

  it(`is 'ontrack' at exactly the ${BEHIND_RATIO} boundary (not behind)`, () => {
    // 12h expected * 0.8 = 9.6h. Exactly 9.6h is NOT < threshold.
    //
    // REGRESSION (bug found 2026-08-08): this is the float-boundary case. In
    // IEEE-754, 12 * 0.8 === 9.600000000000001, so an un-rounded comparison
    // declared a user who hit their target exactly to be BEHIND PACE by 1.8e-15
    // hours. deriveStatus now rounds the threshold to the same 1dp as the logged
    // total before comparing. Keep this test: it fails again the moment the
    // rounding is removed.
    expect(
      deriveStatus({ ...base, roadmap: roadmapCreated(7), sessions: [session(576, 1)] }, NOW)
    ).toBe("ontrack");
  });

  it("stays 'behind' a hair below the boundary (the fix didn't just widen it)", () => {
    // 9.5h < 9.6h threshold — still genuinely behind.
    expect(
      deriveStatus({ ...base, roadmap: roadmapCreated(7), sessions: [session(570, 1)] }, NOW)
    ).toBe("behind");
  });

  it(`is 'stalled' after ${STALLED_DAYS} days of silence on a started plan`, () => {
    expect(
      deriveStatus(
        { ...base, roadmap: roadmapCreated(30), sessions: [session(600, STALLED_DAYS)] },
        NOW
      )
    ).toBe("stalled");
  });

  it("prefers 'stalled' over 'behind' — silence is the more specific diagnosis", () => {
    const r = deriveStatus(
      { ...base, roadmap: roadmapCreated(60), sessions: [session(60, 20)] },
      NOW
    );
    expect(r).toBe("stalled");
  });

  it("is 'done' when every topic is mastered, regardless of hours (Rule 16)", () => {
    expect(
      deriveStatus(
        { roadmap: roadmapCreated(60), sessions: [], topicCount: 15, masteredCount: 15 },
        NOW
      )
    ).toBe("done");
  });

  it("is not 'done' for a roadmap with zero topics", () => {
    expect(
      deriveStatus({ roadmap: roadmapCreated(2), sessions: [], topicCount: 0, masteredCount: 0 }, NOW)
    ).toBe("fresh");
  });
});

// ---------------------------------------------------------------------------
describe("weekBars() — attribution by topic, not by calendar", () => {
  const weeks: WeekRow[] = [
    { id: "w1", n: 1, title: "Core JS", hours: 10, topicIds: ["t1", "t2"], masteredCount: 0, topicCount: 2 },
    { id: "w2", n: 2, title: "Browser", hours: 12, topicIds: ["t3"], masteredCount: 0, topicCount: 1 },
  ];

  it("credits a session to the week that owns its topic", () => {
    const bars = weekBars(weeks, [session(120, 0, "t3")]);
    expect(bars[0].loggedHours).toBe(0);
    expect(bars[1].loggedHours).toBe(2);
  });

  it("sums multiple topics within the same week", () => {
    const bars = weekBars(weeks, [session(60, 0, "t1"), session(90, 0, "t2")]);
    expect(bars[0].loggedHours).toBe(2.5);
  });

  it("excludes unattributed sessions from every bar", () => {
    // The deliberate consequence: bars can sum to less than total hours logged.
    const sessions = [session(600, 0, null)];
    const bars = weekBars(weeks, sessions);
    expect(bars.every((b) => b.loggedHours === 0)).toBe(true);
    expect(hoursLogged(sessions)).toBe(10);
  });

  it("ignores a session pointing at an unknown topic rather than throwing", () => {
    const bars = weekBars(weeks, [session(60, 0, "gone")]);
    expect(bars.every((b) => b.loggedHours === 0)).toBe(true);
  });

  it("always emits bars in week order and carries planned hours through", () => {
    const bars = weekBars([weeks[1], weeks[0]], []);
    expect(bars.map((b) => b.label)).toEqual(["W1", "W2"]);
    expect(bars.map((b) => b.plannedHours)).toEqual([10, 12]);
  });
});

// ---------------------------------------------------------------------------
describe("accuracyTrend() — bucketed by count, oldest first", () => {
  it("returns nothing below one full bucket (no misleading 2-point trend)", () => {
    expect(accuracyTrend([review("right", 1), review("right", 2)])).toEqual([]);
  });

  it("buckets three reviews into one point with its percent correct", () => {
    const pts = accuracyTrend([review("right", 3), review("right", 2), review("wrong", 1)]);
    expect(pts).toEqual([{ index: 0, accuracy: 67 }]);
  });

  it("orders oldest-first regardless of input order", () => {
    // First bucket all-wrong (older), second all-right (newer).
    const reviews = [
      review("right", 1),
      review("right", 2),
      review("right", 3),
      review("wrong", 10),
      review("wrong", 11),
      review("wrong", 12),
    ];
    const pts = accuracyTrend(reviews);
    expect(pts.map((p) => p.accuracy)).toEqual([0, 100]);
  });

  it("keeps only the most recent whole buckets", () => {
    const reviews = Array.from({ length: 40 }, (_, i) => review("right", 40 - i));
    expect(accuracyTrend(reviews, 8, 3)).toHaveLength(8);
  });
});

describe("overallAccuracy() / trendDirection()", () => {
  it("overallAccuracy is null with no reviews", () => {
    expect(overallAccuracy([])).toBeNull();
  });

  it("overallAccuracy is percent-correct across all reviews", () => {
    expect(overallAccuracy([review("right", 1), review("wrong", 2)])).toBe(50);
  });

  it("calls a small wobble 'flat' rather than dressing noise as progress", () => {
    expect(trendDirection([{ index: 0, accuracy: 70 }, { index: 1, accuracy: 73 }])).toBe("flat");
  });

  it("calls a >=5 point gain 'rising' and a >=5 point drop 'falling'", () => {
    expect(trendDirection([{ index: 0, accuracy: 60 }, { index: 1, accuracy: 70 }])).toBe("rising");
    expect(trendDirection([{ index: 0, accuracy: 70 }, { index: 1, accuracy: 60 }])).toBe("falling");
  });

  it("is 'flat' with fewer than two points", () => {
    expect(trendDirection([{ index: 0, accuracy: 90 }])).toBe("flat");
  });
});

// ---------------------------------------------------------------------------
describe("buildBlockers() — facts, never encouragement", () => {
  const weeks: WeekRow[] = [
    { id: "w1", n: 1, title: "Core JS", hours: 10, topicIds: ["t1"], masteredCount: 0, topicCount: 1 },
    { id: "w2", n: 2, title: "React Internals", hours: 14, topicIds: ["t2"], masteredCount: 0, topicCount: 1 },
  ];

  it("returns nothing for a healthy, just-started roadmap", () => {
    const blockers = buildBlockers(
      { roadmap: roadmapCreated(1), weeks, sessions: [session(300, 0, "t1")], reviews: [] },
      NOW
    );
    expect(blockers).toEqual([]);
  });

  it("names the heaviest untouched week once the plan has reached it", () => {
    const blockers = buildBlockers(
      { roadmap: roadmapCreated(21), weeks, sessions: [session(300, 0, "t1")], reviews: [] },
      NOW
    );
    expect(blockers[0].head).toContain("Week 2");
    expect(blockers[0].head).toContain("React Internals");
  });

  it("does not flag a week the plan hasn't reached yet", () => {
    const blockers = buildBlockers(
      { roadmap: roadmapCreated(7), weeks, sessions: [session(720, 0, "t1")], reviews: [] },
      NOW
    );
    expect(blockers.some((b) => b.head.includes("Week 2"))).toBe(false);
  });

  it("flags silence of three days or more with the real day count", () => {
    const blockers = buildBlockers(
      { roadmap: roadmapCreated(14), weeks, sessions: [session(600, 5, "t1")], reviews: [] },
      NOW
    );
    expect(blockers.some((b) => b.head === "0 hours logged in the last 5 days.")).toBe(true);
  });

  it("distinguishes 'never logged anything' from 'went quiet'", () => {
    const blockers = buildBlockers(
      { roadmap: roadmapCreated(14), weeks, sessions: [], reviews: [] },
      NOW
    );
    expect(blockers.some((b) => b.head === "No study hours logged at all.")).toBe(true);
  });

  it("flags flat recall accuracy that isn't improving", () => {
    const reviews = [
      review("wrong", 9), review("right", 8), review("wrong", 7),
      review("wrong", 3), review("right", 2), review("wrong", 1),
    ];
    const blockers = buildBlockers(
      { roadmap: roadmapCreated(7), weeks, sessions: [session(720, 0, "t1")], reviews },
      NOW
    );
    expect(blockers.some((b) => b.head.includes("Recall accuracy"))).toBe(true);
  });

  it("does not flag accuracy that is genuinely rising", () => {
    const reviews = [
      review("wrong", 9), review("wrong", 8), review("wrong", 7),
      review("right", 3), review("right", 2), review("right", 1),
    ];
    const blockers = buildBlockers(
      { roadmap: roadmapCreated(7), weeks, sessions: [session(720, 0, "t1")], reviews },
      NOW
    );
    expect(blockers.some((b) => b.head.includes("Recall accuracy"))).toBe(false);
  });

  it("does not flag strong accuracy even when flat", () => {
    const reviews = Array.from({ length: 6 }, (_, i) => review("right", 6 - i));
    const blockers = buildBlockers(
      { roadmap: roadmapCreated(7), weeks, sessions: [session(720, 0, "t1")], reviews },
      NOW
    );
    expect(blockers.some((b) => b.head.includes("Recall accuracy"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("purity — the property that makes all of the above assertable", () => {
  it("does not mutate the arrays it is given", () => {
    const sessions = [session(60, 1, "t1"), session(30, 0, null)];
    const snapshot = JSON.stringify(sessions);
    const weeks: WeekRow[] = [
      { id: "w1", n: 1, title: "W", hours: 10, topicIds: ["t1"], masteredCount: 0, topicCount: 1 },
    ];
    weekBars(weeks, sessions);
    hoursLogged(sessions);
    buildBlockers({ roadmap: roadmapCreated(14), weeks, sessions, reviews: [] }, NOW);
    expect(JSON.stringify(sessions)).toBe(snapshot);
  });

  it("returns the same answer for the same inputs (no clock reads)", () => {
    const args = { ...roadmapCreated(14) };
    expect(expectedHoursByNow(args, NOW)).toBe(expectedHoursByNow(args, NOW));
  });
});
