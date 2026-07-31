import { notFound } from "next/navigation";
import Header from "@/components/shell/Header";
import ContentArea from "@/components/shell/ContentArea";
import { createClient } from "@/lib/supabase/server";
import type { TopicDetail, TopicStatus } from "@/lib/seed/types";
import TopicStudy from "@/components/topic/TopicStudy";

export const dynamic = "force-dynamic";

// Topic (Study) screen — mental model, ranked resources, from-scratch exercises,
// the kill-criterion checkbox that earns mastery (Rule 16), and autosaving notes.
// Server-fetches the topic + its detail + week (for kill criterion) + note body.
export default async function TopicPage({
  params,
}: {
  params: Promise<{ id: string; topicId: string }>;
}) {
  const { id: roadmapId, topicId } = await params;
  const supabase = await createClient();

  // Topic + its week (for the week label + kill criterion). RLS scopes to owner.
  const { data: topic } = await supabase
    .from("topics")
    .select("id, name, status, detail, mastered_at, weeks(n, title, kill_criterion)")
    .eq("id", topicId)
    .single();

  if (!topic) notFound();

  // Supabase types the embedded to-one `weeks` relation as an array; normalise
  // to the single row (or null).
  const weekRel = topic.weeks as unknown as
    | { n: number; title: string; kill_criterion: string }
    | { n: number; title: string; kill_criterion: string }[]
    | null;
  const week = Array.isArray(weekRel) ? weekRel[0] ?? null : weekRel;

  // The note row (created alongside the topic at generation time; upsert-safe if not).
  const { data: note } = await supabase
    .from("notes")
    .select("body")
    .eq("topic_id", topicId)
    .maybeSingle();

  const detail = (topic.detail ?? null) as TopicDetail | null;

  return (
    <>
      <Header title={topic.name} subtitle={week ? `Week ${week.n} · ${week.title}` : undefined} />
      <ContentArea maxWidth={940}>
        <TopicStudy
          roadmapId={roadmapId}
          topicId={topic.id}
          topicName={topic.name}
          status={(topic.status as TopicStatus) ?? "not_started"}
          weekLabel={week ? `Week ${week.n} · ${week.title}` : "—"}
          killCriterion={week?.kill_criterion ?? "No kill criterion set for this week."}
          detail={detail}
          initialNote={note?.body ?? ""}
        />
      </ContentArea>
    </>
  );
}
