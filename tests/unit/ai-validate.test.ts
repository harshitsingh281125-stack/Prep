import { describe, expect, it } from "vitest";
import {
  ROADMAP_LIMITS,
  planContract,
  validateRecallQuestions,
  validateRoadmap,
  validateTopicDetail,
} from "@/lib/ai/validate";
import type { OnboardingAnswers } from "@/lib/seed/types";

// Rule 9's first half: nothing a model returns reaches the database without
// passing these. Tested directly (pure functions) rather than through a live
// generation, because the interesting inputs are the ones a real model rarely
// produces on demand — and those are precisely the ones that must be rejected.

const contract = { weeksCount: 3, perWeekHours: 12 };

function goodWeek(i: number) {
  return {
    title: `Week theme ${i}`,
    killCriterion: "Implement it from scratch and explain the trade-off cold.",
    topics: [`Topic ${i}A`, `Topic ${i}B`],
  };
}

function goodRoadmap(weeks = 3) {
  return {
    title: "Frontend SDE-2 plan",
    subtitle: "Big tech bar · 3 weeks",
    weeks: Array.from({ length: weeks }, (_, i) => goodWeek(i + 1)),
  };
}

describe("validateRoadmap", () => {
  it("accepts a well-formed generation and stamps the server-owned numbers", () => {
    const r = validateRoadmap(goodRoadmap(), contract);
    expect(r).not.toBeNull();
    expect(r!.weeksCount).toBe(3);
    expect(r!.hoursPlanned).toBe(3 * 12);
    // Week numbers come from POSITION, never from the model.
    expect(r!.weeks.map((w) => w.n)).toEqual([1, 2, 3]);
    // Hours come from the user's stated budget, on every week.
    expect(r!.weeks.every((w) => w.hours === 12)).toBe(true);
  });

  // The decision this pins: the model writes content, not contract. Even when it
  // volunteers numbers, they are ignored rather than trusted.
  it("ignores week numbers and hours the model tried to supply", () => {
    const raw = goodRoadmap();
    // @ts-expect-error deliberately injecting fields the schema never asks for
    raw.weeks[0].n = 99;
    // @ts-expect-error same
    raw.weeks[0].hours = 400;
    const r = validateRoadmap(raw, contract)!;
    expect(r.weeks[0].n).toBe(1);
    expect(r.weeks[0].hours).toBe(12);
  });

  it("rejects the wrong number of weeks in both directions", () => {
    expect(validateRoadmap(goodRoadmap(2), contract)).toBeNull();
    expect(validateRoadmap(goodRoadmap(4), contract)).toBeNull();
  });

  it("ships topics with no detail — generated on demand instead", () => {
    const r = validateRoadmap(goodRoadmap(), contract)!;
    expect(r.weeks[0].topics[0].detail).toBeNull();
    expect(r.weeks[0].topics[0].status).toBe("not_started");
  });

  it("rejects a missing or empty title/subtitle", () => {
    expect(validateRoadmap({ ...goodRoadmap(), title: "" }, contract)).toBeNull();
    expect(validateRoadmap({ ...goodRoadmap(), subtitle: undefined }, contract)).toBeNull();
  });

  it("rejects a kill criterion that is too short to be testable", () => {
    const raw = goodRoadmap();
    raw.weeks[1].killCriterion = "know it"; // under killCriterionMin
    expect(validateRoadmap(raw, contract)).toBeNull();
  });

  it("rejects a week with too few or too many topics", () => {
    const few = goodRoadmap();
    few.weeks[0].topics = ["only one"];
    expect(validateRoadmap(few, contract)).toBeNull();

    const many = goodRoadmap();
    many.weeks[0].topics = Array.from(
      { length: ROADMAP_LIMITS.topicsPerWeekMax + 1 },
      (_, i) => `T${i}`
    );
    expect(validateRoadmap(many, contract)).toBeNull();
  });

  // A duplicate would create two identical topic rows and, via the recall
  // seeder, duplicate cards in the queue.
  it("rejects a week that repeats a topic name", () => {
    const raw = goodRoadmap();
    raw.weeks[0].topics = ["Event loop", "Event loop"];
    expect(validateRoadmap(raw, contract)).toBeNull();
  });

  it("rejects non-string topics and non-object weeks", () => {
    const badTopic = goodRoadmap();
    // @ts-expect-error deliberate
    badTopic.weeks[0].topics = [{ name: "nope" }, "fine"];
    expect(validateRoadmap(badTopic, contract)).toBeNull();

    const badWeek = goodRoadmap();
    // @ts-expect-error deliberate
    badWeek.weeks[1] = "not an object";
    expect(validateRoadmap(badWeek, contract)).toBeNull();
  });

  it("rejects non-objects, arrays and null outright", () => {
    expect(validateRoadmap(null, contract)).toBeNull();
    expect(validateRoadmap([], contract)).toBeNull();
    expect(validateRoadmap("a roadmap, honest", contract)).toBeNull();
  });

  it("trims whitespace rather than accepting a padded empty string", () => {
    expect(validateRoadmap({ ...goodRoadmap(), title: "   " }, contract)).toBeNull();
  });
});

describe("planContract", () => {
  const base: OnboardingAnswers = {
    role: "SDE-2",
    bar: "Big tech",
    timeline: "8 weeks",
    hours: "20h",
    weak: ["Async JS"],
  };

  it("reads the numbers out of the answer strings", () => {
    expect(planContract(base)).toEqual({ weeksCount: 8, perWeekHours: 20 });
  });

  // Must match generateSeedRoadmap's defaults exactly, or a fallback would
  // silently build a differently-shaped plan than the AI path would have.
  it("applies the same defaults as the seed generator for non-numeric answers", () => {
    expect(planContract({ ...base, timeline: "No date yet", hours: "As much as it takes" })).toEqual({
      weeksCount: 5,
      perWeekHours: 12,
    });
  });

  it("clamps a degenerate timeline to at least one week", () => {
    expect(planContract({ ...base, timeline: "0 weeks" }).weeksCount).toBe(1);
  });
});

describe("validateTopicDetail", () => {
  const good = {
    model:
      "The event loop drains the microtask queue completely between every macrotask, which is why a promise callback always beats a zero-delay timer.",
    resources: [
      { title: "MDN: Event loop", meta: "mdn · 20 min", tag: "Docs" },
      { title: "Jake Archibald: In the loop", meta: "video · 34 min", tag: "Talk" },
    ],
    exercises: [
      { title: "Predict the order", desc: "Write five queued callbacks and predict the log order." },
      { title: "Build a task queue", desc: "Implement a microtask-vs-macrotask scheduler by hand." },
    ],
  };

  it("accepts good detail and marks every resource unverified", () => {
    const d = validateTopicDetail(good)!;
    expect(d).not.toBeNull();
    expect(d.resources).toHaveLength(2);
    // Phase 4 has no corpus to check these against — the flag says so.
    expect(d.resources.every((r) => r.unverified === true)).toBe(true);
    expect(d.source).toBe("ai");
  });

  it("rejects an unknown resource tag", () => {
    expect(
      validateTopicDetail({
        ...good,
        resources: [{ ...good.resources[0], tag: "Blogpost" }, good.resources[1]],
      })
    ).toBeNull();
  });

  it("rejects a mental model too short to be a real explanation", () => {
    expect(validateTopicDetail({ ...good, model: "It loops." })).toBeNull();
  });

  it("rejects too few resources or exercises", () => {
    expect(validateTopicDetail({ ...good, resources: [good.resources[0]] })).toBeNull();
    expect(validateTopicDetail({ ...good, exercises: [good.exercises[0]] })).toBeNull();
  });

  it("rejects a resource missing a field", () => {
    expect(
      validateTopicDetail({ ...good, resources: [{ title: "No meta", tag: "Docs" }, good.resources[1]] })
    ).toBeNull();
  });
});

describe("validateRecallQuestions", () => {
  const q1 = "Which runs first after an empty stack, a promise callback or setTimeout(0), and why?";
  const q2 = "What exactly does the closure returned by debounce capture between calls?";

  it("accepts a well-formed set", () => {
    expect(validateRecallQuestions({ questions: [q1, q2] })).toEqual([q1, q2]);
  });

  it("rejects fewer than the minimum", () => {
    expect(validateRecallQuestions({ questions: [q1] })).toBeNull();
  });

  it("rejects more than the maximum", () => {
    expect(validateRecallQuestions({ questions: Array.from({ length: 7 }, (_, i) => `${q1} #${i}`) })).toBeNull();
  });

  // A repeated question in one session is a false recall signal: you get it the
  // second time because you just read it (Rule 17's spirit).
  it("rejects duplicates", () => {
    expect(validateRecallQuestions({ questions: [q1, q1] })).toBeNull();
  });

  it("rejects a question too short to be a real prompt", () => {
    expect(validateRecallQuestions({ questions: [q1, "Closures?"] })).toBeNull();
  });

  it("rejects a missing questions key", () => {
    expect(validateRecallQuestions({ items: [q1, q2] })).toBeNull();
  });
});
