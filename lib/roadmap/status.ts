// Shared status → label/color mapping for roadmaps and topics (from the design's
// roadmapStatusMeta / statusMeta). Kept in one place so Library, Roadmap, and the
// Topic screen stay consistent. Colors are OKLCH tokens (Rule 21) — no raw hex.

import type { RoadmapStatus, TopicStatus } from "@/lib/seed/types";

export type StatusMeta = { label: string; color: string; soft: string };

export function roadmapStatusMeta(k: RoadmapStatus): StatusMeta {
  const m: Record<RoadmapStatus, StatusMeta> = {
    fresh: { label: "Not started", color: "var(--text-faint)", soft: "var(--bg-elevated)" },
    ontrack: { label: "On track", color: "var(--green)", soft: "var(--green-soft)" },
    behind: { label: "Behind pace", color: "var(--red)", soft: "var(--red-soft)" },
    stalled: { label: "Stalled", color: "var(--red)", soft: "var(--red-soft)" },
    done: { label: "Complete", color: "var(--green)", soft: "var(--green-soft)" },
  };
  return m[k] ?? m.fresh;
}

export function topicStatusMeta(s: TopicStatus): { label: string; color: string } {
  if (s === "mastered") return { label: "Mastered", color: "var(--green)" };
  if (s === "in_progress") return { label: "In progress", color: "var(--amber)" };
  return { label: "Not started", color: "var(--text-faint)" };
}

/**
 * Whether a topic's study material has been generated yet, and how grounded it is
 * (Phase 5). Read from `topics.detail->>source` — see the Roadmap screen's query.
 *
 * This answers a DIFFERENT question from topicStatusMeta(): that one is about the
 * user's progress ("have you mastered this?"), this one is about the content
 * ("does material exist, and can its links be trusted?"). They are rendered
 * differently on purpose — this as a bordered chip, progress as plain text — so
 * two mono labels in the same row don't read as one metric.
 *
 * The three generated values mirror the Topic screen's own provenance ladder
 * exactly (rag > ai > seed), because a marker that graded content on a different
 * scale from the screen it links to would be worse than no marker.
 */
export type DetailSource = "rag" | "ai" | "seed" | null;

export function detailSourceMeta(source: DetailSource): {
  label: string;
  color: string;
  soft: string;
  /** Long form for the row's `title` tooltip — the chip has room for one word. */
  hint: string;
} {
  if (source === "rag")
    return {
      label: "VETTED",
      color: "var(--green)",
      soft: "var(--green-soft)",
      hint: "Study material generated, with resources grounded on the curated corpus — the links are real.",
    };
  if (source === "ai")
    return {
      label: "AI",
      color: "var(--amber)",
      soft: "var(--amber-soft)",
      hint: "Study material generated, but nothing in the corpus matched — its resources are model-recalled and unverified.",
    };
  if (source === "seed")
    return {
      label: "TEMPLATE",
      color: "var(--text-muted)",
      soft: "var(--bg-elevated)",
      hint: "Generation failed, so this topic fell back to the hand-written seeded template.",
    };
  return {
    label: "NO CONTENT",
    color: "var(--text-faint)",
    soft: "transparent",
    hint: "No study material yet. Open the topic and press Generate with AI.",
  };
}
