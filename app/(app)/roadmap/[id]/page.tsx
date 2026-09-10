import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/shell/Header";
import ContentArea from "@/components/shell/ContentArea";
import { createClient } from "@/lib/supabase/server";
import { roadmapStatusMeta } from "@/lib/roadmap/status";
import { deriveStatus, hoursLogged, type SessionRow } from "@/lib/progress/compute";
import { templateMismatch } from "@/lib/seed/catalog";
import type { TopicStatus } from "@/lib/seed/types";
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
    .select("id, title, subtitle, answers, hours_planned, weeks_count, created_at, generated_from")
    .eq("id", id)
    .single();

  if (!roadmap) notFound();

  const [{ data: weeks }, { data: sessionRows }] = await Promise.all([
    supabase
      .from("weeks")
      // `detailSource:detail->>source` extracts ONE string out of the topic's
      // detail jsonb instead of shipping the whole blob. That matters: detail
      // holds a mental model, 2-5 resources and 2 exercises per topic, so a
      // 25-topic roadmap would pull tens of KB across the wire to answer a
      // question that needs one word. Every write path stamps `source`
      // (validate.ts -> 'rag' | 'ai', seed/detail.ts -> 'seed'), so a null here
      // means "no detail row yet", not "detail without a source".
      .select(
        "id, n, title, hours, kill_criterion, topics(id, name, status, position, detailSource:detail->>source)"
      )
      .eq("roadmap_id", id)
      .order("n", { ascending: true }),
    supabase.from("study_sessions").select("minutes, topic_id, logged_at").eq("roadmap_id", id),
  ]);

  type RawTopic = {
    id: string;
    name: string;
    status: string;
    position: number;
    detailSource: string | null;
  };

  const weekData: WeekData[] = (weeks ?? []).map((w) => {
    const topics = ((w.topics ?? []) as RawTopic[]).slice().sort((a, b) => a.position - b.position);
    const mastered = topics.filter((t) => t.status === "mastered").length;
    return {
      id: w.id,
      n: w.n,
      title: w.title,
      hours: w.hours,
      killCriterion: w.kill_criterion,
      mastered,
      total: topics.length,
      withDetail: topics.filter((t) => t.detailSource !== null).length,
      topics: topics.map((t) => ({
        id: t.id,
        name: t.name,
        status: (t.status as TopicStatus) ?? "not_started",
        // Narrow the string PostgREST returns to the union the UI switches on.
        // Anything unexpected reads as "not generated" rather than being rendered
        // raw — an unknown provenance is not a claim we can make about content.
        detailSource:
          t.detailSource === "rag" || t.detailSource === "ai" || t.detailSource === "seed"
            ? t.detailSource
            : null,
      })),
    };
  });

  const allTopics = weekData.flatMap((w) => w.topics);
  const totalTopics = allTopics.length;
  const masteredTopics = allTopics.filter((t) => t.status === "mastered").length;
  const inProgress = allTopics.filter((t) => t.status === "in_progress").length;
  const pct = totalTopics ? Math.round((masteredTopics / totalTopics) * 100) : 0;

  // Status + hours are derived from study_sessions (Phase 3), not read from the
  // vestigial roadmaps.status / roadmaps.hours_logged columns — same reasoning as
  // Library: a stored status goes stale as soon as time passes without a write.
  const sessions: SessionRow[] = (sessionRows ?? []).map((s) => ({
    minutes: s.minutes,
    topicId: s.topic_id,
    loggedAt: new Date(s.logged_at),
  }));
  const logged = hoursLogged(sessions);
  const st = roadmapStatusMeta(
    deriveStatus(
      {
        roadmap: {
          createdAt: new Date(roadmap.created_at),
          weeksCount: roadmap.weeks_count,
          hoursPlanned: roadmap.hours_planned,
        },
        sessions,
        topicCount: totalTopics,
        masteredCount: masteredTopics,
      },
      new Date()
    )
  );

  // Phase 5: the honest-fallback label. True only when the seeded generator
  // actually ran AND the user's role needs a track the seeded catalog is not —
  // i.e. a backend candidate holding the frontend template. See
  // templateMismatch() in lib/seed/catalog.ts and migration 0012.
  const role = ((roadmap.answers ?? {}) as { role?: string }).role ?? "";
  const mismatched = templateMismatch(role, roadmap.generated_from);

  const tiles: StatTile[] = [
    { label: "Progress", value: `${pct}%`, sub: `${masteredTopics} of ${totalTopics} topics mastered` },
    {
      label: "Hours",
      value: `${logged} / ${roadmap.hours_planned}`,
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
          <>
            {/* Phase 5: the export entry point. A plain <Link>, not a button —
                the print view is a real, shareable, bookmarkable URL
                (/roadmap/[id]/print), so it should behave like one: middle-click
                to open in a tab, right-click to copy. */}
            <Link href={`/roadmap/${id}/print`} style={exportLinkStyle}>
              Export / Print
            </Link>
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
          </>
        }
      />
      <ContentArea maxWidth={1000}>
        {mismatched && <TemplateMismatchNotice role={role} />}

        {/* Stat tiles */}
        <div
          className="grid-4"
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

/**
 * "This is the wrong template for your role" (Phase 5).
 *
 * Rule 9 says AI must never hard-block a flow — and it didn't: this roadmap
 * exists and is usable. But "never blocks" is not "never tell them". Adding a
 * backend role to a product whose seeded fallback is a FRONTEND curriculum is
 * only defensible if the fallback is loud, and only loud if the notice outlives
 * the toast that first announced it. Hence a persisted column read on every open
 * rather than a flag in the creation response.
 *
 * Amber, not red: nothing is broken. The plan's structure, hours and pace maths
 * are all correct — the topics are simply from the wrong track.
 */
function TemplateMismatchNotice({ role }: { role: string }) {
  return (
    <div
      data-testid="template-mismatch"
      style={{
        background: "var(--amber-soft)",
        border: "1px solid var(--amber)",
        borderRadius: "12px",
        padding: "16px 18px",
        marginBottom: "18px",
        display: "flex",
        gap: "14px",
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          fontFamily: "'IBM Plex Mono',monospace",
          fontSize: "11px",
          fontWeight: 600,
          color: "var(--amber)",
          background: "var(--bg)",
          border: "1px solid var(--amber)",
          borderRadius: "6px",
          padding: "4px 10px",
          letterSpacing: "0.05em",
          flex: "0 0 auto",
          marginTop: "1px",
          whiteSpace: "nowrap",
        }}
      >
        TEMPLATE MISMATCH
      </div>
      <div style={{ fontSize: "13.5px", lineHeight: 1.6, textWrap: "pretty" }}>
        AI generation wasn&apos;t available when this roadmap was created, so it was built from
        Prep&apos;s seeded <b>frontend</b> curriculum — but you selected <b>{role}</b>. The week
        structure, hours and pace tracking are all real; the <i>topics</i> are from the wrong
        track. Delete it and create a new roadmap to get a generated one.
      </div>
    </div>
  );
}

type StatTile = { label: string; value: string; sub: string };

const exportLinkStyle = {
  fontFamily: "'IBM Plex Mono',monospace",
  fontSize: "11px",
  color: "var(--text-muted)",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-strong)",
  borderRadius: "6px",
  padding: "4px 10px",
  textDecoration: "none",
} as const;
