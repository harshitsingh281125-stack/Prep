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
// rather than a vetted corpus. Nothing in Phase 4 can check whether the document
// exists, so the UI marks it and says so. Phase 4.5's RAG grounding is what
// clears the flag — resources selected from the curated `resources` table come
// back without it.
export type SeedResource = {
  title: string;
  meta: string; // e.g. "react.dev · 25 min"
  tag: "Docs" | "Deep" | "Article" | "Talk" | "Spec";
  unverified?: boolean;
};

export type SeedExercise = {
  title: string;
  desc: string;
};

// The detail blob stored in topics.detail — the mental model, ranked resources,
// and from-scratch exercises for one topic.
//
// `source` (Phase 4) records which path produced it: a real generation, or the
// seeded template the route falls back to when generation fails (Rule 9). The
// UI shows it, because "the AI was down so this is the template" is information
// the user is entitled to rather than a degradation to hide.
export type TopicDetail = {
  model: string;
  resources: SeedResource[];
  exercises: SeedExercise[];
  source?: "ai" | "seed";
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
