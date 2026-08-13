// Shared types for the seed roadmap generator (Phase 1) — and, later, the shape
// the AI generator (Phase 4) must also satisfy so the seed stays a drop-in
// fallback (Rule 9). Keep this the single source of truth for the roadmap tree.

export type TopicStatus = "not_started" | "in_progress" | "mastered";
export type RoadmapStatus = "fresh" | "ontrack" | "behind" | "stalled" | "done";

// Raw onboarding answers — the exact shape the wizard collects (matches the
// design's obAnswers). `weak` is multi-select; the rest are single-choice.
export type OnboardingAnswers = {
  role: string;
  bar: string;
  timeline: string;
  hours: string;
  weak: string[];
};

// A resource shown on the Topic screen (ranked list). `tag` drives the chip
// color.
//
// `unverified` (Phase 4): true when the resource came out of a model's memory
// rather than a vetted corpus. Nothing in Phase 4 could check whether the
// document existed, so the UI marks it and says so.
//
// `url` (Phase 4.5): present ONLY on resources retrieved from the curated
// `resources` corpus. The two flags are two halves of one fact and are set
// together — a corpus resource has a url and no `unverified`; a generated one
// has `unverified: true` and no url. That is why the UI can treat "is a link" and
// "is vetted" as the same question: a model-recalled URL never gets stored,
// because the grounded generator is never asked for one (see validate.ts).
export type SeedResource = {
  title: string;
  meta: string; // e.g. "react.dev · 25 min"
  tag: "Docs" | "Deep" | "Article" | "Talk" | "Spec";
  url?: string;
  unverified?: boolean;
};

export type SeedExercise = {
  title: string;
  desc: string;
};

// The detail blob stored in topics.detail — the mental model, ranked resources,
// and from-scratch exercises for one topic.
//
// `source` records which path produced it. The UI shows it, because "the AI was
// down so this is the template" is information the user is entitled to rather
// than a degradation to hide. Three values, in descending order of grounding:
//   'rag'  (Phase 4.5) — resources selected from the curated corpus; links are real
//   'ai'   (Phase 4)   — fully generated; resources are model-recalled, unverified
//   'seed' (Phase 1)   — the hand-written template, used when generation fails
export type TopicDetail = {
  model: string;
  resources: SeedResource[];
  exercises: SeedExercise[];
  source?: "rag" | "ai" | "seed";
};

// Phase 4: `detail` is null on a freshly generated roadmap. Topics no longer
// ship with pre-filled content — the Topic screen offers an explicit "Generate
// with AI" button instead, so nothing burns the daily cap just by existing and
// the AI path and its fallback produce identically-shaped trees.
export type SeedTopic = {
  name: string;
  status: TopicStatus;
  detail: TopicDetail | null;
};

export type SeedWeek = {
  n: number;
  title: string;
  hours: number;
  killCriterion: string;
  topics: SeedTopic[];
};

// The full generated roadmap tree, ready to persist.
export type SeedRoadmap = {
  title: string;
  subtitle: string;
  weeksCount: number;
  hoursPlanned: number;
  weeks: SeedWeek[];
};
