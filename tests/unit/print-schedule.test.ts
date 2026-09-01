import { describe, expect, it } from "vitest";
import { recallSchedule, type ScheduledCard } from "@/lib/print/schedule";

// Unit tests for the printed recall schedule (Phase 5).
//
// The whole reason this logic is a pure function with `now` injected is the day
// boundary: "due today" vs "due tomorrow" is decided by a UTC calendar-day
// comparison, and a boundary you can only check by rendering a page at 23:59 is
// a boundary nobody ever checks. Same discipline as the scheduler and the
// progress aggregation.

const NOW = new Date("2026-08-27T12:00:00.000Z");
const DAY = 86_400_000;

function card(topicLabel: string, offsetMs: number): ScheduledCard {
  return { topicLabel, dueAt: new Date(NOW.getTime() + offsetMs) };
}

/** Pull one bucket out of the result by key. */
function bucket(cards: ScheduledCard[], key: string, now = NOW) {
  const b = recallSchedule(cards, now).find((x) => x.key === key);
  if (!b) throw new Error(`no bucket ${key}`);
  return b;
}

describe("recallSchedule — bucketing", () => {
  it("returns all four buckets, in fixed order, even when empty", () => {
    const buckets = recallSchedule([], NOW);
    expect(buckets.map((b) => b.key)).toEqual(["overdue", "today", "week", "later"]);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
    expect(buckets.every((b) => b.topics.length === 0)).toBe(true);
  });

  it("keeps empty buckets rather than dropping them", () => {
    // On paper "0 · Next 7 days" is information; a missing row would let the
    // page imply a fuller schedule than the rows support (Rule 19).
    const buckets = recallSchedule([card("A", -DAY)], NOW);
    expect(buckets).toHaveLength(4);
    expect(buckets.find((b) => b.key === "today")!.count).toBe(0);
  });

  it("puts a card due yesterday in overdue", () => {
    expect(bucket([card("A", -DAY)], "overdue").count).toBe(1);
  });

  it("puts a card due later today in today", () => {
    expect(bucket([card("A", 6 * 3600_000)], "today").count).toBe(1);
  });

  it("puts a card due EARLIER today in today, not overdue", () => {
    // The bucket boundary is the calendar day, not the instant. A card that came
    // due at 09:00 and is being printed at 12:00 is still today's work.
    expect(bucket([card("A", -3 * 3600_000)], "today").count).toBe(1);
    expect(bucket([card("A", -3 * 3600_000)], "overdue").count).toBe(0);
  });

  it("puts a card due in 3 days in the next-7-days bucket", () => {
    expect(bucket([card("A", 3 * DAY)], "week").count).toBe(1);
  });

  it("treats day 7 as inside the week bucket and day 8 as later (inclusive bound)", () => {
    expect(bucket([card("A", 7 * DAY)], "week").count).toBe(1);
    expect(bucket([card("A", 8 * DAY)], "later").count).toBe(1);
  });
});

describe("recallSchedule — day boundaries (why `now` is injected)", () => {
  it("a card due 23:59 tonight is today, not next-7-days", () => {
    const lateToday = new Date("2026-08-27T23:59:00.000Z");
    const b = recallSchedule([{ topicLabel: "A", dueAt: lateToday }], NOW);
    expect(b.find((x) => x.key === "today")!.count).toBe(1);
    expect(b.find((x) => x.key === "week")!.count).toBe(0);
  });

  it("a card due 00:01 tomorrow is NOT today, even though it is 12 hours away", () => {
    const earlyTomorrow = new Date("2026-08-28T00:01:00.000Z");
    const b = recallSchedule([{ topicLabel: "A", dueAt: earlyTomorrow }], NOW);
    expect(b.find((x) => x.key === "today")!.count).toBe(0);
    expect(b.find((x) => x.key === "week")!.count).toBe(1);
  });

  it("rendering at 23:00 does not reclassify a card the scheduler put at +1d", () => {
    // A rolling 24h window would call this "today" because it is 2 hours away.
    // The scheduler added a whole DAY, so the print-out must not contradict it.
    const lateNow = new Date("2026-08-27T23:00:00.000Z");
    const plusOneDay = new Date("2026-08-28T01:00:00.000Z");
    const b = recallSchedule([{ topicLabel: "A", dueAt: plusOneDay }], lateNow);
    expect(b.find((x) => x.key === "today")!.count).toBe(0);
    expect(b.find((x) => x.key === "week")!.count).toBe(1);
  });

  it("a card due exactly at `now` counts as today", () => {
    const b = recallSchedule([{ topicLabel: "A", dueAt: new Date(NOW) }], NOW);
    expect(b.find((x) => x.key === "today")!.count).toBe(1);
  });
});

describe("recallSchedule — topic rollup", () => {
  it("counts every card but lists each topic once", () => {
    const cards = [card("Event loop", DAY), card("Event loop", 2 * DAY), card("Closures", DAY)];
    const b = bucket(cards, "week");
    expect(b.count).toBe(3);
    expect(b.topics).toEqual(["Event loop", "Closures"]);
  });

  it("orders topics by card count, heaviest first", () => {
    const cards = [
      card("Light", DAY),
      card("Heavy", DAY),
      card("Heavy", DAY),
      card("Heavy", 2 * DAY),
    ];
    expect(bucket(cards, "week").topics).toEqual(["Heavy", "Light"]);
  });

  it("breaks count ties alphabetically so the page is stable between printings", () => {
    const cards = [card("Zebra", DAY), card("Alpha", DAY), card("Mango", DAY)];
    expect(bucket(cards, "week").topics).toEqual(["Alpha", "Mango", "Zebra"]);
  });

  it("keeps buckets independent — the same topic can appear in several", () => {
    const cards = [card("Event loop", -DAY), card("Event loop", 3 * DAY)];
    expect(bucket(cards, "overdue").topics).toEqual(["Event loop"]);
    expect(bucket(cards, "week").topics).toEqual(["Event loop"]);
  });

  it("handles a large deck without losing cards", () => {
    const cards: ScheduledCard[] = [];
    for (let i = 0; i < 200; i++) cards.push(card(`T${i % 7}`, (i % 40) * DAY - 5 * DAY));
    const buckets = recallSchedule(cards, NOW);
    expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(200);
  });
});
