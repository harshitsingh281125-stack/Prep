// The seed roadmap generator (Phase 1). Turns onboarding answers into a full
// roadmap tree (weeks → topics) by slicing + reordering the fixed CATALOG. No AI.
//
// Phase 4 promoted it to what it was always designed to be: the schema-valid
// fallback /api/roadmaps/generate uses when the model is capped, unreachable, or
// returns malformed JSON twice (Rule 9). It returns the same SeedRoadmap shape
// the AI path produces — including, since Phase 4, `detail: null` on every topic.
// Detail is generated on demand per topic now (lib/seed/detail.ts holds the
// fallback for that call), so the two paths yield structurally identical trees
// and a fallback can never be spotted by the shape of what it built.

import { CATALOG, declaredWeakAreas, type CatalogBlock } from "./catalog";
import { planContract } from "./answers";
import type { OnboardingAnswers, SeedRoadmap, SeedWeek } from "./types";

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
  // Shared with the AI path so a fallback can't reshape the user's plan.
  const { weeksCount, perWeekHours: perWeek } = planContract(answers);

  // "Not sure" is not an area to front-load — it means don't front-load anything.
  const ordered = orderBlocks(declaredWeakAreas(answers.weak));

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
      detail: null, // generated on demand — see lib/seed/detail.ts
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
