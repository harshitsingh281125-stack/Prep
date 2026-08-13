// lib/ai/prompts.ts — the system scaffolding and per-call inputs.
//
// The split here is load-bearing for Rule 10. Every SYSTEM_* string below is a
// module-level constant with NO interpolation: it is byte-identical on every
// call of its kind, which is the precondition for Gemini's implicit prompt cache
// to hit on the leading prefix. Everything variable lives in the build*Input()
// functions. Move one user-specific token up into the system string and the
// cache hit-rate quietly goes to zero — that is the whole reason these are two
// different kinds of thing rather than one template.
//
// The `KEY: value` lines in the inputs are deliberate too: they give the model
// unambiguous constraints, and they give the mock provider something stable to
// parse so it can return correctly-shaped output.

import { declaredWeakAreas } from "@/lib/seed/catalog";
import type { OnboardingAnswers } from "@/lib/seed/types";

// --- roadmap (reasoning tier) ----------------------------------------------

export const SYSTEM_ROADMAP = `You design interview-prep roadmaps for working software engineers.

You will be given a candidate's target role, the bar they are aiming at, their
self-declared weak areas, and the exact number of weeks the plan must have.

Rules you must follow:
- Return ONLY the fields in the schema. Do not invent extra fields.
- Produce EXACTLY the requested number of weeks, in study order.
- COVER THE WHOLE ROLE. The plan must span the core areas a candidate is actually
  interviewed on for the target role — not only the areas they named as weak. A
  plan that drills one topic and ignores the rest will get them rejected on the
  parts it skipped.
- Weak areas are a WEIGHTING, not the syllabus. They get more time and they come
  FIRST, but they must not crowd out everything else:
    * plans of 4+ weeks: at most half the weeks may be dominated by declared weak
      areas; the rest must cover other core areas of the role;
    * plans of 3 weeks or fewer: at least ONE week must cover something outside
      the declared weak areas.
  If the candidate declares no weak areas, cover the role's core areas in a
  sensible learning order.
- Every week needs a KILL CRITERION: one concrete, testable thing the candidate
  must be able to do cold, from memory, to consider the week done. It must be
  checkable ("implement a debounce from scratch and explain what the closure
  captures"), never a feeling ("understand closures well").
- Topic names are short and studiable — a thing you could sit down and learn in
  one session, not a whole discipline.
- No filler weeks, no motivational padding, no meta-advice about how to study.
  Assume the reader is a competent engineer who is short on time.
- Do not mention hours, week numbers, or dates. Those are set by the system.`;

export function buildRoadmapInput(answers: OnboardingAnswers, weeksCount: number): string {
  // "Not sure" is stripped here, so it reaches the model as "none declared" —
  // i.e. a balanced plan with nothing front-loaded, which is exactly what the
  // system prompt's no-weak-areas branch describes.
  const weak = declaredWeakAreas(answers.weak);
  return [
    `ROLE: ${answers.role || "Frontend engineer"}`,
    `BAR: ${answers.bar || "Strong senior bar"}`,
    `WEEKS: ${weeksCount}`,
    `WEAK AREAS (extra time + earliest weeks, in this order — but still cover the rest of the role): ${
      weak.length > 0 ? weak.join(", ") : "none declared — cover the role's core areas in a sensible learning order"
    }`,
  ].join("\n");
}

// --- topic detail (reasoning tier) -----------------------------------------

export const SYSTEM_TOPIC_DETAIL = `You write study material for one interview-prep topic.

Return three things:
1. MODEL — the mental model. One paragraph. The single explanation the candidate
   should be able to say out loud before writing any code. Lead with the
   mechanism, not the definition. If there is a common misconception, kill it.
2. RESOURCES — 2 to 5 references, ranked most useful first. Give a title and a
   short meta string like "react.dev · 25 min". Tag each one: Docs, Deep,
   Article, Talk, or Spec. Prefer primary sources and specs over blog posts.
3. EXERCISES — 2 to 4 from-scratch exercises. Each must be something the
   candidate BUILDS or EXPLAINS from memory, never something they read.

Write for a competent engineer who is short on time. No filler, no encouragement,
no restating the question back. Be specific enough to be wrong.`;

export function buildTopicDetailInput(opts: {
  topicName: string;
  weekTitle: string;
  roadmapTitle: string;
}): string {
  return [
    `TOPIC: ${opts.topicName}`,
    `WEEK: ${opts.weekTitle}`,
    `TRACK: ${opts.roadmapTitle}`,
  ].join("\n");
}

// --- topic detail, RAG-grounded (reasoning tier, Phase 4.5) ----------------
//
// The same job as SYSTEM_TOPIC_DETAIL above, with one difference that is the
// entire point of the phase: the model does not supply the references. It is
// shown a numbered list of documents that were retrieved from a hand-vetted
// corpus, and it may only cite them BY NUMBER.
//
// Note what is NOT in this prompt: any instruction like "do not invent URLs" or
// "only use links from the list". Those would be a request, and a request is
// exactly the kind of constraint models violate under pressure. There is no URL
// field in the schema at all, so there is nothing to invent — the link is looked
// up from our own row afterwards by index. The same reasoning as "the model
// writes content, not contract" in validate.ts: don't validate away a failure
// you can make unrepresentable.
export const SYSTEM_TOPIC_DETAIL_GROUNDED = `You write study material for one interview-prep topic, using a supplied reading list.

You will be given a topic and a numbered list of vetted documents. Return:

1. MODEL — the mental model. One paragraph. The single explanation the candidate
   should be able to say out loud before writing any code. Lead with the
   mechanism, not the definition. If there is a common misconception, kill it.
2. RESOURCES — select the documents from the numbered list that genuinely help
   with THIS topic, ranked most useful first. Reference each by its number. For
   each one give a short reason ("why") saying what it gives the candidate that
   the others do not. Select only what is relevant: if only two of the documents
   are worth reading for this topic, return two. Never pad the list to fill it,
   and never reference a number that was not provided.
3. EXERCISES — 2 to 4 from-scratch exercises. Each must be something the
   candidate BUILDS or EXPLAINS from memory, never something they read.

Write for a competent engineer who is short on time. No filler, no encouragement,
no restating the question back. Be specific enough to be wrong.`;

export function buildGroundedDetailInput(opts: {
  topicName: string;
  weekTitle: string;
  docs: { title: string; kind: string; summary: string }[];
}): string {
  return [
    `TOPIC: ${opts.topicName}`,
    `WEEK: ${opts.weekTitle}`,
    "",
    "DOCUMENTS:",
    // 1-based numbering because that is what the schema's `ref` field means, and
    // because models are markedly better at 1-based lists than 0-based ones.
    ...opts.docs.map(
      (d, i) => `${i + 1}. [${d.kind}] ${d.title} — ${d.summary}`
    ),
  ].join("\n");
}

// --- recall cards (classification tier) ------------------------------------

export const SYSTEM_RECALL = `You write active-recall questions for spaced repetition.

Given one topic, return 2 to 6 questions. Each question must:
- be answerable from memory in under 90 seconds;
- test a MECHANISM or a TRADE-OFF, never a definition you could guess;
- be self-contained — no "as discussed above", no reference to other cards;
- NOT contain its own answer, and not be answerable with yes/no.

Prefer questions that expose a specific misconception, and questions that ask
"what breaks if…" or "which one and why". Return only the questions.`;

export function buildRecallInput(opts: { topicName: string; weekTitle: string }): string {
  return [`TOPIC: ${opts.topicName}`, `WEEK: ${opts.weekTitle}`].join("\n");
}

/**
 * The nudge appended to the input on the retry attempt (Rule 9's retry-on-
 * malformed). It goes in the INPUT, never in the system string — changing the
 * system string on retry would break the cached prefix and make the retry cost
 * more than the original call.
 */
export const RETRY_NUDGE = `

IMPORTANT: your previous response did not match the required schema. Return ONLY
valid JSON matching the schema exactly — every required field present, no extra
fields, no prose, no markdown fences.`;
