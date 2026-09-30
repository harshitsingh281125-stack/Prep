import Link from "next/link";
import Header from "@/components/shell/Header";
import ContentArea from "@/components/shell/ContentArea";
import HoursChart from "@/components/progress/HoursChart";
import AccuracyChart from "@/components/progress/AccuracyChart";
import LogHoursForm, { type TopicOption } from "@/components/progress/LogHoursForm";
import { createClient } from "@/lib/supabase/server";
import { roadmapStatusMeta } from "@/lib/roadmap/status";
import {
  accuracyTrend,
  buildBlockers,
  daysSinceLastSession,
  deriveStatus,
  expectedHoursByNow,
  hoursLogged,
  observedPace,
  overallAccuracy,
  projectedDaysLate,
  requiredPace,
  trendDirection,
  weekBars,
  weeksElapsed,
  type ReviewRow,
  type SessionRow,
  type WeekRow,
} from "@/lib/progress/compute";

export const dynamic = "force-dynamic";

/**
 * Progress screen — the pace-vs-plan truth-teller (Rule 19).
 *
 * Server component: it fetches the roadmap tree, the study_sessions rows, and the
 * recall_reviews log (all scoped by RLS to the caller), then hands them to the
 * pure functions in lib/progress/compute.ts. Nothing on this screen is
 * hard-coded — the banner, every stat tile, both charts and the blockers list are
 * derived from rows. If they're wrong, the data is wrong, which is the point.
 *
 * It reports on the most recent roadmap. Multi-roadmap selection isn't in the
 * Phase 3 spec, so it isn't built (simplicity first).
 */
export default async function ProgressPage() {
  const supabase = await createClient();
  const now = new Date();

  const { data: roadmapRow } = await supabase
    .from("roadmaps")
    .select("id, title, subtitle, hours_planned, weeks_count, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!roadmapRow) {
    return (
      <>
        <Header maxWidth={1000} title="Progress" subtitle="Honest pace vs. plan — including when you're behind." />
        <ContentArea maxWidth={1000}>
          <EmptyState />
        </ContentArea>
      </>
    );
  }

  const roadmapId = roadmapRow.id;

  const [{ data: weekRows }, { data: sessionRows }, { data: reviewRows }] = await Promise.all([
    supabase
      .from("weeks")
      .select("id, n, title, hours, topics(id, name, status)")
      .eq("roadmap_id", roadmapId)
      .order("n", { ascending: true }),
    supabase
      .from("study_sessions")
      .select("minutes, topic_id, logged_at")
      .eq("roadmap_id", roadmapId),
    supabase.from("recall_reviews").select("grade, reviewed_at").order("reviewed_at", { ascending: true }),
  ]);

  const weeks: WeekRow[] = (weekRows ?? []).map((w) => {
    const topics = (w.topics ?? []) as { id: string; name: string; status: string }[];
    return {
      id: w.id,
      n: w.n,
      title: w.title,
      hours: w.hours,
      topicIds: topics.map((t) => t.id),
      masteredCount: topics.filter((t) => t.status === "mastered").length,
      topicCount: topics.length,
    };
  });

  const sessions: SessionRow[] = (sessionRows ?? []).map((s) => ({
    minutes: s.minutes,
    topicId: s.topic_id,
    loggedAt: new Date(s.logged_at),
  }));

  const reviews: ReviewRow[] = (reviewRows ?? []).map((r) => ({
    grade: r.grade as "right" | "wrong",
    reviewedAt: new Date(r.reviewed_at),
  }));

  const roadmap = {
    createdAt: new Date(roadmapRow.created_at),
    weeksCount: roadmapRow.weeks_count,
    hoursPlanned: roadmapRow.hours_planned,
  };

  const topicCount = weeks.reduce((n, w) => n + w.topicCount, 0);
  const masteredCount = weeks.reduce((n, w) => n + w.masteredCount, 0);

  // --- every displayed number, derived ------------------------------------
  const logged = hoursLogged(sessions);
  const expected = expectedHoursByNow(roadmap, now);
  const pace = observedPace(sessions, roadmap, now);
  const required = requiredPace(roadmap);
  const elapsed = weeksElapsed(roadmap.createdAt, now, roadmap.weeksCount);
  const daysLate = projectedDaysLate(sessions, roadmap, now);
  const idleDays = daysSinceLastSession(sessions, now);
  const status = deriveStatus({ roadmap, sessions, topicCount, masteredCount }, now);
  const bars = weekBars(weeks, sessions);
  const points = accuracyTrend(reviews);
  const accuracy = overallAccuracy(reviews);
  const direction = trendDirection(points);
  const blockers = buildBlockers({ roadmap, weeks, sessions, reviews }, now);
  const st = roadmapStatusMeta(status);

  const plannedPct = roadmap.hoursPlanned > 0 ? Math.round((logged / roadmap.hoursPlanned) * 100) : 0;
  const masteredPct = topicCount > 0 ? Math.round((masteredCount / topicCount) * 100) : 0;
  const behind = status === "behind" || status === "stalled";

  const topicOptions: TopicOption[] = (weekRows ?? []).flatMap((w) =>
    ((w.topics ?? []) as { id: string; name: string }[]).map((t) => ({
      id: t.id,
      name: t.name,
      weekN: w.n,
    }))
  );

  return (
    <>
      <Header maxWidth={1000}
        title="Progress"
        subtitle={roadmapRow.title}
        tag={
          <span style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "13px", color: st.color }}>
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: st.color }} />
            {st.label}
          </span>
        }
      />
      <ContentArea maxWidth={1000}>
        {behind && (
          <PaceBanner
            logged={logged}
            planned={roadmap.hoursPlanned}
            plannedPct={plannedPct}
            pace={pace}
            required={required}
            daysLate={daysLate}
            stalled={status === "stalled"}
            idleDays={idleDays}
          />
        )}

        {/* Stat row — figures in the serif, hairline dividers, no boxes. */}
        <div
          className="grid-4 stat-row"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            borderTop: "1px solid var(--border)",
            borderBottom: "1px solid var(--border)",
            marginBottom: "48px",
          }}
        >
          <StatTile
            first
            testId="stat-hours"
            label="Hours logged"
            value={`${logged}`}
            sub={`of ${roadmap.hoursPlanned} planned`}
            subColor={behind ? "var(--red)" : "var(--text-muted)"}
          />
          <StatTile
            testId="stat-pace"
            label="Pace"
            value={pace === null ? "—" : `${pace}`}
            sub={pace === null ? "less than a week in" : `hrs/wk · need ${required}`}
            valueColor={pace !== null && pace < required ? "var(--red)" : undefined}
            subColor={pace !== null && pace < required ? "var(--red)" : "var(--text-muted)"}
          />
          <StatTile
            testId="stat-accuracy"
            label="Recall accuracy"
            value={accuracy === null ? "—" : `${accuracy}%`}
            sub={accuracy === null ? "no reviews yet" : `${direction} over ${points.length} blocks`}
            valueColor={
              accuracy === null
                ? undefined
                : accuracy >= 80
                  ? "var(--green)"
                  : accuracy >= 60
                    ? "var(--amber)"
                    : "var(--red)"
            }
          />
          <StatTile
            testId="stat-mastered"
            label="Topics mastered"
            value={`${masteredCount} / ${topicCount}`}
            sub={`${masteredPct}%`}
          />
        </div>

        {/* Charts */}
        <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "48px", marginBottom: "48px" }}>
          <HoursChart bars={bars} />
          <AccuracyChart points={points} overall={accuracy} direction={direction} />
        </div>

        {/* Blockers */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
          <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}>
            What&apos;s actually blocking you
          </div>
          {blockers.length === 0 ? (
            <div style={{ fontFamily: "var(--font-serif)", fontSize: "18px", color: "var(--text-muted)", lineHeight: 1.55 }}>
              Nothing is blocking you right now — you&apos;re {elapsed} week
              {elapsed === 1 ? "" : "s"} in with {logged}h logged against {expected}h expected.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {blockers.map((b) => (
                <div key={b.head} data-testid="blocker" style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "var(--red)",
                      marginTop: "7px",
                      flex: "0 0 auto",
                    }}
                  />
                  <div style={{ fontSize: "15px", lineHeight: 1.55 }}>
                    <b style={{ fontWeight: 600 }}>{b.head}</b> <span style={{ color: "var(--text-muted)" }}>{b.body}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <LogHoursForm roadmapId={roadmapId} topics={topicOptions} />
      </ContentArea>
    </>
  );
}

function PaceBanner({
  logged,
  planned,
  plannedPct,
  pace,
  required,
  daysLate,
  stalled,
  idleDays,
}: {
  logged: number;
  planned: number;
  plannedPct: number;
  pace: number | null;
  required: number;
  daysLate: number | null;
  stalled: boolean;
  idleDays: number | null;
}) {
  return (
    <div
      data-testid="pace-banner"
      style={{
        background: "var(--red-soft)",
        borderLeft: "2px solid var(--red)",
        borderRadius: "0 10px 10px 0",
        padding: "16px 20px",
        marginBottom: "36px",
      }}
    >
      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--red)", marginBottom: "4px" }}>
        {stalled ? "Stalled" : "Behind pace"}
      </div>
      <div style={{ fontFamily: "var(--font-serif)", fontSize: "18px", lineHeight: 1.5, textWrap: "pretty" }}>
        You&apos;ve logged <b>{logged} of {planned}</b> planned hours ({plannedPct}%).
        {pace !== null && (
          <>
            {" "}Current pace is <b>{pace} hrs/week</b> against {required} planned.
          </>
        )}
        {daysLate !== null && (
          <>
            {" "}At this rate you finish <b>~{daysLate} days past</b> your target.
          </>
        )}
        {stalled && idleDays !== null && (
          <>
            {" "}Nothing has been logged in <b>{idleDays} days</b>.
          </>
        )}
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  valueColor,
  subColor,
  testId,
  first,
}: {
  first?: boolean;
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
  subColor?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        padding: first ? "18px 20px 18px 0" : "18px 20px",
        borderLeft: first ? "none" : "1px solid var(--border)",
      }}
    >
      <div style={{ fontSize: "13px", color: "var(--text-muted)", fontWeight: 500 }}>{label}</div>
      <div
        data-testid={testId ? `${testId}-value` : undefined}
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "34px",
          fontWeight: 500,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          marginTop: "6px",
          color: valueColor,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: "12.5px", marginTop: "4px", color: subColor ?? "var(--text-faint)" }}>{sub}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        padding: "48px 0",
        maxWidth: "56ch",
      }}
    >
      <div style={{ fontFamily: "var(--font-serif)", fontSize: "24px", marginBottom: "8px" }}>No roadmap to report on yet.</div>
      <div style={{ fontSize: "15px", color: "var(--text-muted)", marginBottom: "24px", lineHeight: 1.6 }}>
        Progress is measured against a plan. Create a roadmap and log some study time,
        and this screen will tell you the truth about your pace.
      </div>
      <Link
        href="/onboarding"
        className="btn-ink"
        style={{
          padding: "10px 18px",
          borderRadius: "8px",
          background: "var(--ink)",
          color: "var(--on-ink)",
          fontSize: "14px",
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Create a roadmap →
      </Link>
    </div>
  );
}
