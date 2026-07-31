import Header from "@/components/shell/Header";
import ContentArea from "@/components/shell/ContentArea";
import { createClient } from "@/lib/supabase/server";
import { roadmapStatusMeta } from "@/lib/roadmap/status";
import type { RoadmapStatus } from "@/lib/seed/types";
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
    .select("id, title, subtitle, hours_planned, hours_logged, status, created_at, topics(status)")
    .order("created_at", { ascending: false });

  const cards: RoadmapCardData[] = (roadmaps ?? []).map((r) => {
    const topics = (r.topics ?? []) as { status: string }[];
    const total = topics.length;
    const mastered = topics.filter((t) => t.status === "mastered").length;
    const st = roadmapStatusMeta((r.status as RoadmapStatus) ?? "fresh");
    const pct = r.hours_planned ? Math.round((r.hours_logged / r.hours_planned) * 100) : 0;
    return {
      id: r.id,
      title: r.title,
      subtitle: r.subtitle ?? "",
      statusLabel: st.label,
      statusColor: st.color,
      statusSoft: st.soft,
      pct,
      hoursLogged: r.hours_logged,
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
      <Header
        title="Library"
        subtitle="Your roadmaps. No fluff — five questions, then a plan you'll be held to."
        tag={
          used > 0 ? (
            <span
              style={{
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: "11px",
                color: canCreate ? "var(--text-muted)" : "var(--red)",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                padding: "4px 10px",
              }}
            >
              {used} / {maxRoadmaps} used
            </span>
          ) : undefined
        }
      />
      <ContentArea maxWidth={920}>
        {cards.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "14px" }}>
              {cards.map((c) => (
                <RoadmapCard key={c.id} data={c} />
              ))}
            </div>
            <div
              style={{
                marginTop: "18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  fontFamily: "'IBM Plex Mono',monospace",
                  fontSize: "12px",
                  color: "var(--text-faint)",
                }}
              >
                {used} of {maxRoadmaps} roadmap creations used
              </div>
              <NewRoadmapButton canCreate={canCreate} />
            </div>
          </>
        )}
      </ContentArea>
    </>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        padding: "70px 24px",
        border: "1px dashed var(--border-strong)",
        borderRadius: "16px",
        background: "var(--bg-sunken)",
      }}
    >
      <div
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "12px",
          background: "var(--accent-soft)",
          border: "1px solid var(--accent-line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "18px",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" strokeWidth={1.5}>
          <rect x="2.4" y="2.4" width="4.8" height="4.8" rx="1" />
          <rect x="8.8" y="2.4" width="4.8" height="4.8" rx="1" />
          <rect x="2.4" y="8.8" width="4.8" height="4.8" rx="1" />
          <rect x="8.8" y="8.8" width="4.8" height="4.8" rx="1" />
        </svg>
      </div>
      <div style={{ fontSize: "19px", fontWeight: 600, letterSpacing: "-0.015em" }}>No roadmaps yet</div>
      <div style={{ color: "var(--text-muted)", marginTop: "6px", maxWidth: "44ch" }}>
        Build your first plan. Five questions, then a roadmap with kill criteria you can actually be
        held to.
      </div>
      <a
        href="/onboarding"
        style={{
          marginTop: "22px",
          padding: "11px 20px",
          borderRadius: "9px",
          border: "1px solid var(--accent)",
          background: "var(--accent)",
          color: "oklch(0.99 0 0)",
          font: "inherit",
          fontSize: "14px",
          fontWeight: 600,
          cursor: "pointer",
          textDecoration: "none",
        }}
      >
        Create your first roadmap →
      </a>
    </div>
  );
}
