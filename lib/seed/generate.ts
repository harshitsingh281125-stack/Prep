// The seed roadmap generator (Phase 1). Turns onboarding answers into a full
// roadmap tree (weeks → topics → per-topic detail) by slicing + reordering the
// fixed CATALOG. No AI. In Phase 4 this exact function becomes the schema-valid
// fallback the AI generator falls back to when a generation is malformed (Rule 9),
// which is why it returns the same SeedRoadmap shape the AI path must produce.

import { CATALOG, TOPIC_DETAIL, type CatalogBlock } from "./catalog";
import type { OnboardingAnswers, SeedRoadmap, SeedWeek, TopicDetail } from "./types";

// Pull the first integer out of an answer like "5 weeks" / "12h"; fall back if
// the option has no number ("No date yet", "As much as it takes").
function parseNum(v: string, fallback: number): number {
  const m = String(v).match(/\d+/);
  return m ? Number(m[0]) : fallback;
}

// A topic we don't have hand-written detail for still needs a coherent detail
// blob (the design's topicDetail fallback branch). Honest placeholder copy that
// pushes the "state the model first" discipline.
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

// Order the catalog: blocks matching a weak area first (in the user's pick order),
// then the remaining blocks in their natural curriculum order. Stable + no dupes.
function orderBlocks(weak: string[]): CatalogBlock[] {
  const weakSet = new Set(weak);
  const matched: CatalogBlock[] = [];
  const seen = new Set<CatalogBlock>();

  // Front-load in the order the user picked their weak areas.
  for (const area of weak) {
    for (const block of CATALOG) {
      if (!seen.has(block) && block.weakAreas.includes(area)) {
        matched.push(block);
        seen.add(block);
      }
    }
  }
  // Everything else keeps catalog order.
  const rest = CATALOG.filter((b) => !seen.has(b));
  // If the user picked no weak areas, `matched` is empty and we get natural order.
  void weakSet;
  return [...matched, ...rest];
}

/**
 * Build a seed roadmap from onboarding answers.
 *
 * - weeks_count  = timeline in weeks (3/5/8; "No date yet" → 5), clamped to ≥1.
 * - hours_planned = weeks_count × hours-per-week (from the hours answer).
 * - week ordering = weak areas front-loaded, then natural catalog order.
 * - if the timeline needs MORE weeks than the catalog has (e.g. 8 > 5), we pad
 *   by repeating the front-loaded focus blocks — an honest "spend extra weeks
 *   reinforcing your weak areas" plan, not invented new content.
 */
export function generateSeedRoadmap(answers: OnboardingAnswers): SeedRoadmap {
  const weeksCount = Math.max(1, parseNum(answers.timeline, 5));
  const perWeek = parseNum(answers.hours, 12);

  const ordered = orderBlocks(answers.weak);

  // Take up to weeksCount blocks; if we need more, pad by cycling the ordered list
  // (front-loaded focus first) so the extra weeks reinforce the weak areas.
  const chosen: CatalogBlock[] = [];
  for (let i = 0; i < weeksCount; i++) {
    chosen.push(ordered[i % ordered.length]);
  }

  const weeks: SeedWeek[] = chosen.map((block, i) => ({
    n: i + 1,
    title: block.title,
    hours: perWeek, // the plan holds the user to their stated weekly budget
    killCriterion: block.killCriterion,
    topics: block.topics.map((t) => ({
      name: t.name,
      status: t.status,
      detail: TOPIC_DETAIL[t.name] ?? buildFallbackDetail(t.name),
    })),
  }));

  const timelineLabel = answers.timeline || "no date";
  return {
    title: answers.role || "Frontend track",
    subtitle: `${answers.bar || "Custom bar"} · ${timelineLabel}`,
    weeksCount,
    hoursPlanned: weeksCount * perWeek,
    weeks,
  };
}
