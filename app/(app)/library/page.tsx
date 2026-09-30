import Header from "@/components/shell/Header";
import ContentArea from "@/components/shell/ContentArea";
import { createClient } from "@/lib/supabase/server";
import { roadmapStatusMeta } from "@/lib/roadmap/status";
import { deriveStatus, hoursLogged, type SessionRow } from "@/lib/progress/compute";
import RoadmapCard, { type RoadmapCardData } from "@/components/library/RoadmapCard";
import NewRoadmapButton from "@/components/library/NewRoadmapButton";

export const dynamic = "force-dynamic"; // per-user data; never statically cached

// Library — the honest home. Real roadmaps from the DB (RLS scopes to the user),
// or the design's dashed empty state. Quota (Rule 18) reflected in the UI; the
// server route is what actually enforces it.
export default async function LibraryPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Cap for the quota line. Defensive default matches the profiles column default.
  const { data: profile } = await supabase
    .from("profiles")
    .select("max_roadmaps")
    .eq("id", user?.id ?? "")
    .single();
  const maxRoadmaps = profile?.max_roadmaps ?? 3;

  // Roadmaps + their topics' status, in one round-trip via an embedded select.
  // RLS already scopes both tables to the user, so no explicit user_id filter needed.
  const { data: roadmaps } = await supabase
    .from("roadmaps")
    .select("id, title, subtitle, hours_planned, weeks_count, created_at, topics(status)")
    .order("created_at", { ascending: false });

  // Hours + status are DERIVED from study_sessions (Phase 3), not read from the
  // roadmaps.hours_logged / roadmaps.status columns. Those columns are vestigial:
  // nothing writes them, and a stored status would go stale the moment time passed
  // without a write (a roadmap would only decay into "stalled" when you touched
  // it — backwards). One fetch of the user's sessions covers every card.
  const { data: sessionRows } = await supabase
    .from("study_sessions")
    .select("roadmap_id, minutes, topic_id, logged_at");

  const sessionsByRoadmap = new Map<string, SessionRow[]>();
  for (const s of sessionRows ?? []) {
    const list = sessionsByRoadmap.get(s.roadmap_id) ?? [];
    list.push({ minutes: s.minutes, topicId: s.topic_id, loggedAt: new Date(s.logged_at) });
    sessionsByRoadmap.set(s.roadmap_id, list);
  }

  const now = new Date();

  const cards: RoadmapCardData[] = (roadmaps ?? []).map((r) => {
    const topics = (r.topics ?? []) as { status: string }[];
    const total = topics.length;
    const mastered = topics.filter((t) => t.status === "mastered").length;
    const sessions = sessionsByRoadmap.get(r.id) ?? [];
    const roadmap = {
      createdAt: new Date(r.created_at),
      weeksCount: r.weeks_count,
      hoursPlanned: r.hours_planned,
    };
    const logged = hoursLogged(sessions);
    const st = roadmapStatusMeta(
      deriveStatus({ roadmap, sessions, topicCount: total, masteredCount: mastered }, now)
    );
    const pct = r.hours_planned ? Math.round((logged / r.hours_planned) * 100) : 0;
    return {
      id: r.id,
      title: r.title,
      subtitle: r.subtitle ?? "",
      statusLabel: st.label,
      statusColor: st.color,
      statusSoft: st.soft,
      pct,
      hoursLogged: logged,
      hoursPlanned: r.hours_planned,
      mastered,
      total,
      createdAt: r.created_at,
    };
  });

  const used = cards.length;
  const canCreate = used < maxRoadmaps;

  return (
    <>
      <Header maxWidth={920}
        title="Library"
        subtitle="Your roadmaps. No fluff — five questions, then a plan you'll be held to."
        tag={
          used > 0 ? (
            <>
              <span
                style={{ fontSize: "13px", color: canCreate ? "var(--text-faint)" : "var(--red)" }}
                title={`${used} of ${maxRoadmaps} roadmap creations used`}
              >
                {used} / {maxRoadmaps} used
              </span>
              <NewRoadmapButton canCreate={canCreate} />
            </>
          ) : undefined
        }
      />
      <ContentArea maxWidth={920}>
        {cards.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ borderTop: "1px solid var(--border)", margin: "0 -12px" }}>
            {cards.map((c) => (
              <RoadmapCard key={c.id} data={c} />
            ))}
          </div>
        )}
      </ContentArea>
    </>
  );
}

function EmptyState() {
  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "56px 0 24px" }}>
      <div style={{ fontFamily: "var(--font-serif)", fontSize: "24px", fontWeight: 500, letterSpacing: "-0.01em" }}>
        No roadmaps yet.
      </div>
      <p style={{ color: "var(--text-muted)", margin: "10px 0 0", fontSize: "15px", lineHeight: 1.6, maxWidth: "52ch" }}>
        Build your first plan. Five questions, then a roadmap with kill criteria you can actually be
        held to.
      </p>
      <a
        href="/onboarding"
        className="btn-ink"
        style={{
          display: "inline-block",
          marginTop: "24px",
          padding: "10px 18px",
          borderRadius: "8px",
          background: "var(--ink)",
          color: "var(--on-ink)",
          fontSize: "14px",
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Create your first roadmap →
      </a>
    </div>
  );
}
