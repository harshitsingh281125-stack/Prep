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

// --- topic detail, RAG-grounded (Phase 4.5) --------------------------------

/**
 * The grounded schema. Compare it to TOPIC_DETAIL_SCHEMA above: the resource
 * objects have lost `title`, `meta` and `tag`, and gained `ref` — a 1-based
 * index into the documents the retrieval step supplied.
 *
 * THAT SUBSTITUTION IS THE WHOLE PHASE. Phase 4's resources were whatever the
 * model remembered, so their titles could name documents that never existed and
 * (had we asked for links) their URLs could point nowhere. Here the model is
 * never asked for a title, a source or a URL — only for which of OUR documents
 * to rank and why. A hallucinated citation is not rejected by validation; it is
 * not expressible. The only thing left to check is that the number is in range.
 *
 * The corresponding cost, stated honestly: the model can no longer suggest a
 * genuinely better resource that isn't in the corpus. That is a real loss and it
 * is the trade being made — a smaller set of references that are all real beats
 * a longer list where some fraction are fiction, for a study tool whose users
 * will click the links.
 */
export const GROUNDED_DETAIL_SCHEMA: JsonSchema = {
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
          ref: {
            type: "integer",
            description:
              "The number of a document from the supplied DOCUMENTS list, 1-based. Never a number that was not supplied.",
          },
          why: {
            type: "string",
            description:
              "Short reason this document earns its place for this topic — what it gives that the others don't.",
          },
        },
        required: ["ref", "why"],
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

export const GROUNDED_LIMITS = {
  /**
   * ZERO is a legitimate answer, and making it one fixed a real bug.
   *
   * This was 1 ("at least one selected document, else there was no point
   * grounding"). But the prompt tells the model to *be selective* — "if only two
   * of the documents are worth reading, return two; never pad the list". So when
   * retrieval surfaced one marginal document for "Monorepo vs Polyrepo
   * strategies", the model correctly judged it irrelevant and returned an empty
   * selection — and the validator threw the entire generation away, spent a
   * retry getting the same honest answer, and metered both as `invalid`.
   *
   * Instructing a model to exercise judgement and then treating its judgement as
   * malformed output is a contradiction in the design, not a model failure. An
   * empty selection means "none of the retrieved documents earn a place here",
   * which is the same *situation* as empty retrieval — so it is parsed
   * successfully and the ROUTE routes it to the ungrounded path, instead of
   * being punished as a schema violation.
   */
  resourcesMin: 0,
  /**
   * Hard reject above this. Deliberately generous: a `why` this long means the
   * model misunderstood the field (it wrote a summary, not a caption), which is
   * worth failing on. Anything shorter is a formatting problem, not a
   * correctness one — see `condenseWhy`.
   */
  whyMax: 400,
  /** Display budget for the caption inside the resource row's meta line. */
  whyDisplayMax: 110,
} as const;

/** corpus `kind` → the resource chip the Topic screen already renders. */
const KIND_TO_TAG: Record<string, SeedResource["tag"]> = {
  doc: "Docs",
  deep: "Deep",
  article: "Article",
  talk: "Talk",
  spec: "Spec",
};

/**
 * Trim the model's caption to something that fits the resource row.
 *
 * THIS FUNCTION EXISTS BECAUSE OF A REAL BUG, and the reasoning is the reusable
 * part. `whyMax` was originally 90 characters — a number I picked from how long I
 * thought a caption should be. Real Gemini output writes 200–220 characters here
 * (measured: 223, 212, 206 on the first live topic). So every grounded
 * generation failed validation, was retried, failed again, and fell through to
 * the ungrounded path: the feature was 100% broken against the real provider
 * while both test suites were green, because the mock provider and my unit
 * fixtures used short strings I had written myself.
 *
 * The fix is not just a bigger number, it is the right FAILURE SEMANTICS. The
 * value of a grounded resource is the vetted link; the caption is decoration.
 * Throwing away a real link because its annotation is thirty characters too long
 * is a terrible trade. So: reject what is load-bearing (a `ref` outside the
 * supplied range means the WRONG LINK), normalise what is cosmetic. The prompt
 * asks for at most 12 words, this enforces it for display, and `whyMax` still
 * rejects the case where the model clearly answered a different question.
 *
 * Cuts on a word boundary — a caption ending mid-word reads as a rendering bug.
 */
function condenseWhy(why: string): string {
  if (why.length <= GROUNDED_LIMITS.whyDisplayMax) return why;
  const cut = why.slice(0, GROUNDED_LIMITS.whyDisplayMax);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, "") + "…";
}

/** The hostname, as the resource's source label. Never model-supplied. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** The subset of a retrieved corpus row this validator needs. */
export type GroundingDoc = {
  title: string;
  url: string;
  kind: string;
};

/**
 * Validate a grounded generation and fuse it with the retrieved documents.
 *
 * Every field a user could act on — the title, the link, the tag — is copied
 * from `docs`, i.e. from a row a human curated and whose URL was checked. The
 * model contributes the mental model, the ordering, the `why` line and the
 * exercises. Returns null on anything malformed, and the gateway then retries
 * once before the route falls back (Rule 9).
 */
export function validateGroundedDetail(
  raw: unknown,
  docs: GroundingDoc[]
): TopicDetail | null {
  const root = obj(raw);
  if (!root || docs.length === 0) return null;

  const model = str(root.model, TOPIC_DETAIL_LIMITS.modelMin, TOPIC_DETAIL_LIMITS.modelMax);
  if (!model) return null;

  // Never more references than documents supplied — a model returning eight
  // picks from five documents is repeating itself or inventing.
  const rawResources = arr(root.resources, GROUNDED_LIMITS.resourcesMin, docs.length);
  if (!rawResources) return null;

  const resources: SeedResource[] = [];
  const seen = new Set<number>();

  for (const r of rawResources) {
    const o = obj(r);
    if (!o) return null;

    // The reference must be an integer inside the supplied range. Not clamped,
    // not coerced: a model that cites document 9 out of 5 has misunderstood the
    // task, and quietly reading that as document 5 would hand the user a link
    // for a reason the model never actually gave.
    const ref = typeof o.ref === "number" && Number.isInteger(o.ref) ? o.ref : null;
    if (ref === null || ref < 1 || ref > docs.length) return null;
    // The same document twice would occupy two slots in a ranked list of five
    // with one document — the duplication the corpus's `url unique` constraint
    // prevents at curation time, prevented again at selection time.
    if (seen.has(ref)) return null;
    seen.add(ref);

    const why = str(o.why, 1, GROUNDED_LIMITS.whyMax);
    if (!why) return null;

    const doc = docs[ref - 1];
    const tag = KIND_TO_TAG[doc.kind];
    // An unmappable kind means the corpus and this map have drifted apart. That
    // is our bug, not the model's, and guessing a tag would hide it.
    if (!tag) return null;

    const caption = condenseWhy(why);
    const host = hostOf(doc.url);
    resources.push({
      title: doc.title,
      meta: host ? `${host} · ${caption}` : caption,
      tag,
      url: doc.url,
      // No `unverified` flag: this URL came out of the curated corpus. The flag's
      // absence is load-bearing, so it is left absent rather than set to false —
      // `unverified: false` and "no flag" would be two encodings of one fact.
    });
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

  return { model, resources, exercises, source: "rag" };
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
