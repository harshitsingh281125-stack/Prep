import { notFound } from "next/navigation";
import Header from "@/components/shell/Header";
import ContentArea from "@/components/shell/ContentArea";
import { createClient } from "@/lib/supabase/server";
import { roadmapStatusMeta } from "@/lib/roadmap/status";
import type { RoadmapStatus, TopicStatus } from "@/lib/seed/types";
import WeekAccordion, { type WeekData } from "@/components/roadmap/WeekAccordion";

export const dynamic = "force-dynamic";

// Roadmap screen — stat tiles + week accordions with kill criteria. Server-fetches
// the whole tree (RLS scopes it to the owner; a stranger's id 404s because the
// query returns nothing). Topic detail is loaded lazily on the Topic screen, not here.
export default async function RoadmapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: roadmap } = await supabase
    .from("roadmaps")
    .select("id, title, subtitle, hours_planned, hours_logged, status")
    .eq("id", id)
    .single();

  if (!roadmap) notFound();

  const { data: weeks } = await supabase
    .from("weeks")
    .select("id, n, title, hours, kill_criterion, topics(id, name, status, position)")
    .eq("roadmap_id", id)
    .order("n", { ascending: true });

  const weekData: WeekData[] = (weeks ?? []).map((w) => {
    const topics = ((w.topics ?? []) as { id: string; name: string; status: string; position: number }[])
      .slice()
      .sort((a, b) => a.position - b.position);
    const mastered = topics.filter((t) => t.status === "mastered").length;
    return {
      id: w.id,
      n: w.n,
      title: w.title,
      hours: w.hours,
      killCriterion: w.kill_criterion,
      mastered,
      total: topics.length,
      topics: topics.map((t) => ({
        id: t.id,
        name: t.name,
        status: (t.status as TopicStatus) ?? "not_started",
      })),
    };
  });

  const allTopics = weekData.flatMap((w) => w.topics);
  const totalTopics = allTopics.length;
  const masteredTopics = allTopics.filter((t) => t.status === "mastered").length;
  const inProgress = allTopics.filter((t) => t.status === "in_progress").length;
  const pct = totalTopics ? Math.round((masteredTopics / totalTopics) * 100) : 0;

  const st = roadmapStatusMeta((roadmap.status as RoadmapStatus) ?? "fresh");

  const tiles: StatTile[] = [
    { label: "Progress", value: `${pct}%`, sub: `${masteredTopics} of ${totalTopics} topics mastered` },
    {
      label: "Hours",
      value: `${roadmap.hours_logged} / ${roadmap.hours_planned}`,
      sub: "logged vs planned",
    },
    { label: "In progress", value: `${inProgress}`, sub: "topics started, not mastered" },
    { label: "Weeks", value: `${weekData.length}`, sub: "kill criteria to clear" },
  ];

  return (
    <>
      <Header
        title={roadmap.title}
        subtitle={roadmap.subtitle ?? undefined}
        tag={
          <span
            style={{
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: "11px",
              color: st.color,
              background: st.soft,
              border: "1px solid " + st.color,
              borderRadius: "6px",
              padding: "4px 10px",
            }}
          >
            {st.label}
          </span>
        }
      />
      <ContentArea maxWidth={1000}>
        {/* Stat tiles */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "12px",
            marginBottom: "22px",
          }}
        >
          {tiles.map((t) => (
            <div
              key={t.label}
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "14px 16px",
              }}
            >
              <div
                style={{
                  fontFamily: "'IBM Plex Mono',monospace",
                  fontSize: "11px",
                  color: "var(--text-faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {t.label}
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "-0.02em", marginTop: "2px" }}>
                {t.value}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>{t.sub}</div>
            </div>
          ))}
        </div>

        {/* Week accordions */}
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {weekData.map((w) => (
            <WeekAccordion key={w.id} roadmapId={id} week={w} defaultOpen={w.n === 1} />
          ))}
        </div>
      </ContentArea>
    </>
  );
}

type StatTile = { label: string; value: string; sub: string };
