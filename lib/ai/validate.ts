// lib/ai/validate.ts — Rule 9's first half: every structured generation is
// schema-validated before it is allowed anywhere near the database.
//
// Hand-rolled rather than zod/ajv, consistent with the scheduler (Rule 14) and
// the charts (Rule 22): the shapes are three small objects, a validation library
// would be a dependency carrying more surface than the thing it validates, and
// these functions have to do a normalising job a generic validator wouldn't do
// anyway (see below).
//
// ---------------------------------------------------------------------------
// The load-bearing design decision in this file: THE MODEL WRITES CONTENT, NOT
// CONTRACT.
//
// A generated roadmap does not get to choose how many weeks it has, how many
// hours a week costs, or what a week is numbered. Those come from the user's
// onboarding answers and are computed server-side. The model is asked only for
// the things it is actually good at — the curriculum: titles, kill criteria,
// topic names.
//
// Why it matters: "8 weeks, 10h/week" is a promise the user made to themselves,
// and the Phase 3 progress dashboard divides by exactly those numbers. If the
// model returned 6 weeks because it felt tidier, every pace calculation
// downstream would silently be measuring against a plan the user never chose.
// Validating the numbers would only catch it; not asking for them makes it
// impossible. It also cuts output tokens, which is the cheap side benefit.
// ---------------------------------------------------------------------------

import type {
  JsonSchema,
} from "./types";
import type {
  OnboardingAnswers,
  SeedResource,
  SeedRoadmap,
  SeedWeek,
  TopicDetail,
} from "@/lib/seed/types";

// --- small helpers ---------------------------------------------------------

function str(v: unknown, min: number, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length < min || t.length > max) return null;
  return t;
}

function arr(v: unknown, min: number, max: number): unknown[] | null {
  if (!Array.isArray(v)) return null;
  if (v.length < min || v.length > max) return null;
  return v;
}

function obj(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

// --- roadmap ---------------------------------------------------------------

/** What we ask the provider to return. Note: no counts, no hours, no week numbers. */
export const ROADMAP_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short plan title, max 60 chars." },
    subtitle: { type: "string", description: "One clause on focus and bar, max 90 chars." },
    weeks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Theme of the week, max 60 chars." },
          killCriterion: {
            type: "string",
            description:
              "One concrete, testable thing the learner must be able to do cold by the end of the week.",
          },
          topics: {
            type: "array",
            items: { type: "string", description: "A single studiable topic name." },
          },
        },
        required: ["title", "killCriterion", "topics"],
      },
    },
  },
  required: ["title", "subtitle", "weeks"],
};

/** Bounds the validator enforces. Exported so the tests assert the real numbers. */
export const ROADMAP_LIMITS = {
  titleMax: 80,
  subtitleMax: 120,
  weekTitleMax: 80,
  killCriterionMin: 10,
  killCriterionMax: 300,
  topicsPerWeekMin: 2,
  topicsPerWeekMax: 6,
  topicNameMax: 70,
} as const;

/**
 * Validate a generated roadmap and fuse it with the server-owned numbers.
 *
 * `weeksCount` and `perWeekHours` are derived from the user's answers by the
 * caller; this function requires the model to have returned exactly that many
 * weeks and then stamps the numbers on itself. Returns null on anything
 * malformed — the gateway retries once, then the caller falls back to the seed.
 */
export function validateRoadmap(
  raw: unknown,
  opts: { weeksCount: number; perWeekHours: number }
): SeedRoadmap | null {
  const root = obj(raw);
  if (!root) return null;

  const title = str(root.title, 1, ROADMAP_LIMITS.titleMax);
  const subtitle = str(root.subtitle, 1, ROADMAP_LIMITS.subtitleMax);
  if (!title || !subtitle) return null;

  // Exactly the requested number of weeks. Not "at least" — a plan with the
  // wrong length is the failure mode this check exists to catch.
  const rawWeeks = arr(root.weeks, opts.weeksCount, opts.weeksCount);
  if (!rawWeeks) return null;

  const weeks: SeedWeek[] = [];
  for (let i = 0; i < rawWeeks.length; i++) {
    const w = obj(rawWeeks[i]);
    if (!w) return null;

    const wTitle = str(w.title, 1, ROADMAP_LIMITS.weekTitleMax);
    const kill = str(
      w.killCriterion,
      ROADMAP_LIMITS.killCriterionMin,
      ROADMAP_LIMITS.killCriterionMax
    );
    if (!wTitle || !kill) return null;

    const rawTopics = arr(
      w.topics,
      ROADMAP_LIMITS.topicsPerWeekMin,
      ROADMAP_LIMITS.topicsPerWeekMax
    );
    if (!rawTopics) return null;

    const names: string[] = [];
    for (const t of rawTopics) {
      const name = str(t, 1, ROADMAP_LIMITS.topicNameMax);
      if (!name) return null;
      // A week that lists the same topic twice would produce two identical
      // topic rows and (via the recall seeder) duplicate cards.
      if (names.includes(name)) return null;
      names.push(name);
    }

    weeks.push({
      n: i + 1, // position is authoritative; the model is never asked for it
      title: wTitle,
      hours: opts.perWeekHours, // the user's stated budget, not the model's opinion
      killCriterion: kill,
      // Phase 4 ships topics with NO detail — the Topic screen offers an explicit
      // "Generate with AI" button instead (settled 2026-08-08). detail is filled
      // in later by /api/topics/[id]/detail, or never.
      topics: names.map((name) => ({
        name,
        status: "not_started" as const,
        detail: null as unknown as TopicDetail,
      })),
    });
  }

  return {
    title,
    subtitle,
    weeksCount: opts.weeksCount,
    hoursPlanned: opts.weeksCount * opts.perWeekHours,
    weeks,
  };
}

// --- topic detail ----------------------------------------------------------

const RESOURCE_TAGS: SeedResource["tag"][] = ["Docs", "Deep", "Article", "Talk", "Spec"];

export const TOPIC_DETAIL_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    model: {
      type: "string",
      description:
        "The one-paragraph mental model for this topic — the thing you'd say first in an interview.",
    },
    resources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          meta: { type: "string", description: "e.g. 'react.dev · 25 min'" },
          tag: { type: "string", enum: RESOURCE_TAGS as unknown as string[] },
        },
        required: ["title", "meta", "tag"],
      },
    },
    exercises: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          desc: { type: "string" },
        },
        required: ["title", "desc"],
      },
    },
  },
  required: ["model", "resources", "exercises"],
};

export const TOPIC_DETAIL_LIMITS = {
  modelMin: 40,
  modelMax: 900,
  resourcesMin: 2,
  resourcesMax: 5,
  exercisesMin: 2,
  exercisesMax: 4,
  titleMax: 120,
  metaMax: 60,
  descMax: 400,
} as const;

/**
 * Validate generated topic detail.
 *
 * Every resource comes back flagged `unverified` — Phase 4 generates these from
 * the model's memory, and that is exactly the surface Phase 4.5's RAG exists to
 * fix (Architecture §5b). Flagging them here rather than in the UI means the
 * flag is stored with the data, so when the corpus lands the two kinds of
 * resource are distinguishable in rows that already exist.
 *
 * Worth being precise about what "unverified" claims: these resources carry no
 * URL (the design's resource row is a title + meta + tag chip, not a link), so
 * nothing here can be a dead link. What it warns is narrower and still real —
 * the titles are model-recalled and the document may not exist under that name.
 */
export function validateTopicDetail(raw: unknown): TopicDetail | null {
  const root = obj(raw);
  if (!root) return null;

  const model = str(root.model, TOPIC_DETAIL_LIMITS.modelMin, TOPIC_DETAIL_LIMITS.modelMax);
  if (!model) return null;

  const rawResources = arr(
    root.resources,
    TOPIC_DETAIL_LIMITS.resourcesMin,
    TOPIC_DETAIL_LIMITS.resourcesMax
  );
  if (!rawResources) return null;

  const resources: SeedResource[] = [];
  for (const r of rawResources) {
    const o = obj(r);
    if (!o) return null;
    const title = str(o.title, 1, TOPIC_DETAIL_LIMITS.titleMax);
    const meta = str(o.meta, 1, TOPIC_DETAIL_LIMITS.metaMax);
    const tag = typeof o.tag === "string" ? (o.tag.trim() as SeedResource["tag"]) : null;
    if (!title || !meta || !tag || !RESOURCE_TAGS.includes(tag)) return null;
    resources.push({ title, meta, tag, unverified: true });
  }

  const rawExercises = arr(
    root.exercises,
    TOPIC_DETAIL_LIMITS.exercisesMin,
    TOPIC_DETAIL_LIMITS.exercisesMax
  );
  if (!rawExercises) return null;

  const exercises = [];
  for (const e of rawExercises) {
    const o = obj(e);
    if (!o) return null;
    const title = str(o.title, 1, TOPIC_DETAIL_LIMITS.titleMax);
    const desc = str(o.desc, 1, TOPIC_DETAIL_LIMITS.descMax);
    if (!title || !desc) return null;
    exercises.push({ title, desc });
  }

  return { model, resources, exercises, source: "ai" };
}

// --- recall cards ----------------------------------------------------------

export const RECALL_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "string",
        description:
          "One active-recall question. Must be answerable from memory and must not contain its own answer.",
      },
    },
  },
  required: ["questions"],
};

export const RECALL_LIMITS = {
  min: 2,
  max: 6,
  questionMin: 20,
  questionMax: 400,
} as const;

/** Validate generated recall questions. Returns the deduped list, or null. */
export function validateRecallQuestions(raw: unknown): string[] | null {
  const root = obj(raw);
  if (!root) return null;

  const rawQuestions = arr(root.questions, RECALL_LIMITS.min, RECALL_LIMITS.max);
  if (!rawQuestions) return null;

  const questions: string[] = [];
  for (const q of rawQuestions) {
    const question = str(q, RECALL_LIMITS.questionMin, RECALL_LIMITS.questionMax);
    if (!question) return null;
    if (questions.includes(question)) return null;
    questions.push(question);
  }
  return questions;
}

// --- shared: the numbers the model isn't allowed to pick -------------------

// Re-exported, not reimplemented. The AI path and the seeded fallback must derive
// weeks_count and hours_planned identically or a fallback would quietly change
// the plan the user asked for — so there is exactly one parser, in
// lib/seed/answers.ts, and both paths call it.
export { planContract, MAX_WEEKS } from "@/lib/seed/answers";
