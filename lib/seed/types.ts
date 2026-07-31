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

// A resource link shown on the Topic screen (ranked list). `tag` drives the
// chip color. In Phase 4.5 these become RAG-grounded; for now they're seeded.
export type SeedResource = {
  title: string;
  meta: string; // e.g. "react.dev · 25 min"
  tag: "Docs" | "Deep" | "Article" | "Talk" | "Spec";
};

export type SeedExercise = {
  title: string;
  desc: string;
};

// The detail blob stored in topics.detail — the mental model, ranked resources,
// and from-scratch exercises for one topic.
export type TopicDetail = {
  model: string;
  resources: SeedResource[];
  exercises: SeedExercise[];
};

export type SeedTopic = {
  name: string;
  status: TopicStatus;
  detail: TopicDetail;
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
