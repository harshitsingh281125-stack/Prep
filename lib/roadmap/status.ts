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
