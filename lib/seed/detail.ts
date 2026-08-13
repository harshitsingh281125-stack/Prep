// The seeded topic-detail template (Phase 4).
//
// This used to run at roadmap-creation time inside generateSeedRoadmap(); it
// moved here when Phase 4 made topic detail generated-on-demand. Its job is now
// narrower and more useful: it is Rule 9's fallback for
// /api/topics/[id]/detail — what a topic shows when generation is capped,
// malformed twice, or the provider is down.
//
// Everything it returns is stamped `source: 'seed'` so the screen can say where
// the content came from instead of quietly passing a template off as generation.

import { TOPIC_DETAIL } from "./catalog";
import type { TopicDetail } from "./types";

/**
 * Honest placeholder detail for a topic the catalog has no hand-written entry
 * for. It deliberately doesn't invent specifics it can't know — it pushes the
 * "state the model first" discipline instead, which is true advice for any topic.
 */
function buildFallbackDetail(name: string): TopicDetail {
  return {
    model: `State the one-sentence model for "${name}" before any code — the thing you'd say in the interview first. If you can't say it plainly, you don't own it yet.`,
    resources: [
      { title: `Primary reference for ${name}`, meta: "docs · 25 min", tag: "Docs" },
      { title: `Deep dive: ${name}`, meta: "article · 35 min", tag: "Deep" },
      { title: `Talk: ${name} in practice`, meta: "video · 30 min", tag: "Talk" },
    ],
    exercises: [
      {
        title: "Explain it in 90 seconds",
        desc: `Record yourself explaining ${name} with no notes. Rewatch and cut the hand-waving.`,
      },
      {
        title: "Build the smallest example",
        desc: `Implement the minimal working case for ${name} from scratch, then break one assumption.`,
      },
    ],
  };
}

/**
 * The seeded detail for a topic: the catalog's hand-written entry when there is
 * one, otherwise the generic template. Always returns something — a fallback
 * that can itself fail would defeat the point of having one (Rule 9).
 *
 * Note the seeded resources are NOT marked `unverified`: they're hand-written
 * into lib/seed/catalog.ts from the design source, not recalled by a model.
 */
export function seedTopicDetail(name: string): TopicDetail {
  const base = TOPIC_DETAIL[name] ?? buildFallbackDetail(name);
  return { ...base, source: "seed" };
}
