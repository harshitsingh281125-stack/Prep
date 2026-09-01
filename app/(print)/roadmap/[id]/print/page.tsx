import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PrintButton from "@/components/print/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { templateMismatch } from "@/lib/seed/catalog";
import { recallSchedule, type ScheduledCard } from "@/lib/print/schedule";
import {
  buildBlockers,
  deriveStatus,
  expectedHoursByNow,
  hoursLogged,
  observedPace,
  overallAccuracy,
  projectedDaysLate,
  requiredPace,
  weekBars,
  weeksElapsed,
  type ReviewRow,
  type SessionRow,
  type WeekRow,
} from "@/lib/progress/compute";
import type { TopicStatus } from "@/lib/seed/types";

export const dynamic = "force-dynamic";

/**
 * The printable roadmap (Phase 5) — `/roadmap/[id]/print`.
 *
 * This is the same truth the Roadmap and Progress screens tell, laid out for
 * paper: it reuses lib/progress/compute.ts wholesale rather than recomputing
 * anything, so a printed page and the dashboard can never disagree. If they
 * ever did, the print-out is the copy that gets carried into a room and quoted.
 *
 * Layout order is design.md §8: header → behind-pace banner → 4 stat tiles →
 * week cards with kill criteria → recall schedule + blockers footer.
 *
 * WHAT IT DELIBERATELY OMITS: notes, mental models, exercises, resource links.
 * A roadmap export is the PLAN — the thing you pin up and get held to. Study
 * material is per-topic, lives behind a generate call, and would turn a
 * two-page contract into a forty-page dump nobody prints twice.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("roadmaps").select("title").eq("id", id).single();

  // The browser prints this string into the PDF's filename and page header, so
  // it is the closest thing this feature has to naming the exported file.
  return { title: data?.title ? `${data.title} — Prep` : "Roadmap — Prep" };
}

export default async function RoadmapPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const now = new Date();

  const { data: roadmap } = await supabase
    .from("roadmaps")
    .select("id, title, subtitle, answers, hours_planned, weeks_count, created_at, generated_from")
    .eq("id", id)
    .single();

  // RLS scopes the select to the owner, so another user's id returns no row and
  // lands here — a stranger gets a 404, never a page with somebody's plan on it.
  if (!roadmap) notFound();

  const [{ data: weekRows }, { data: sessionRows }, { data: reviewRows }, { data: cardRows }] =
    await Promise.all([
      supabase
        .from("weeks")
        .select("id, n, title, hours, kill_criterion, topics(id, name, status, position)")
        .eq("roadmap_id", id)
        .order("n", { ascending: true }),
      supabase.from("study_sessions").select("minutes, topic_id, logged_at").eq("roadmap_id", id),
      supabase.from("recall_reviews").select("grade, reviewed_at"),
      supabase.from("recall_cards").select("topic_label, due_at").eq("roadmap_id", id),
    ]);

  type RawTopic = { id: string; name: string; status: string; position: number };

  const rawWeeks = (weekRows ?? []).map((w) => ({
    id: w.id,
    n: w.n,
    title: w.title,
    hours: w.hours,
    killCriterion: w.kill_criterion,
    topics: ((w.topics ?? []) as RawTopic[])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((t) => ({ id: t.id, name: t.name, status: (t.status as TopicStatus) ?? "not_started" })),
  }));

  const weeks: WeekRow[] = rawWeeks.map((w) => ({
    id: w.id,
    n: w.n,
    title: w.title,
    hours: w.hours,
    topicIds: w.topics.map((t) => t.id),
    masteredCount: w.topics.filter((t) => t.status === "mastered").length,
    topicCount: w.topics.length,
  }));

  const sessions: SessionRow[] = (sessionRows ?? []).map((s) => ({
    minutes: s.minutes,
    topicId: s.topic_id,
    loggedAt: new Date(s.logged_at),
  }));

  const reviews: ReviewRow[] = (reviewRows ?? []).map((r) => ({
    grade: r.grade as "right" | "wrong",
    reviewedAt: new Date(r.reviewed_at),
  }));

  const cards: ScheduledCard[] = (cardRows ?? []).map((c) => ({
    topicLabel: c.topic_label,
    dueAt: new Date(c.due_at),
  }));

  const plan = {
    createdAt: new Date(roadmap.created_at),
    weeksCount: roadmap.weeks_count,
    hoursPlanned: roadmap.hours_planned,
  };

  const topicCount = weeks.reduce((n, w) => n + w.topicCount, 0);
  const masteredCount = weeks.reduce((n, w) => n + w.masteredCount, 0);

  const logged = hoursLogged(sessions);
  const expected = expectedHoursByNow(plan, now);
  const pace = observedPace(sessions, plan, now);
  const required = requiredPace(plan);
  const elapsed = weeksElapsed(plan.createdAt, now, plan.weeksCount);
  const daysLate = projectedDaysLate(sessions, plan, now);
  const status = deriveStatus({ roadmap: plan, sessions, topicCount, masteredCount }, now);
  const accuracy = overallAccuracy(reviews);
  const bars = weekBars(weeks, sessions);
  const blockers = buildBlockers({ roadmap: plan, weeks, sessions, reviews }, now);
  const buckets = recallSchedule(cards, now);

  const behind = status === "behind" || status === "stalled";
  const masteredPct = topicCount > 0 ? Math.round((masteredCount / topicCount) * 100) : 0;

  const answers = (roadmap.answers ?? {}) as { role?: string; bar?: string; hours?: string };
  const role = answers.role ?? "";
  const mismatched = templateMismatch(role, roadmap.generated_from);

  const trackLine = [role || roadmap.title, answers.bar, `${plan.weeksCount}-week plan`, `${required}h/week`]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <>
      {/* Screen-only toolbar. `.print-bar` is display:none in @media print. */}
      <div className="print-bar">
        <Link href={`/roadmap/${id}`} className="print-back">
          ← Back to roadmap
        </Link>
        <div className="print-bar-actions">
          <span style={{ color: "var(--pk-muted)" }}>
            Print at A4/Letter, margins 0.7in, background graphics ON.
          </span>
          <PrintButton />
        </div>
      </div>

      <main className="print-sheet">
        {/* --- header ---------------------------------------------------- */}
        <header className="print-head">
          <div>
            <div className="print-logo">
              <div className="print-logo-mark">P</div>
              <div>
                <div style={{ fontWeight: 600, letterSpacing: "-0.01em" }}>Prep</div>
                <div className="print-mono" style={{ fontSize: "9.5px", color: "var(--pk-faint)" }}>
                  interview OS
                </div>
              </div>
            </div>
            <h1 className="print-title">{roadmap.title}</h1>
            <div className="print-track">{trackLine}</div>
          </div>
          <div className="print-meta">
            <div>
              Exported {now.toISOString().slice(0, 10)}
            </div>
            <div>Started {plan.createdAt.toISOString().slice(0, 10)}</div>
            <div>
              Week {Math.min(elapsed + 1, plan.weeksCount)} of {plan.weeksCount}
            </div>
          </div>
        </header>

        {/* --- honesty banners -------------------------------------------- */}
        {/* Rule 19 on paper: if the plan is behind, the export says so at the
            top. An export that quietly dropped the bad news would be the one
            document a person actually shows other people. */}
        {behind && (
          <div className="print-banner">
            <span className="print-eyebrow print-eyebrow-red">
              {status === "stalled" ? "Stalled" : "Behind pace"}
            </span>
            Logged <b>{logged}h</b> of {plan.hoursPlanned} planned ({expected}h expected by now).
            {pace !== null && (
              <>
                {" "}
                Current pace <b>{pace}h/week</b> against {required} planned.
              </>
            )}
            {daysLate !== null && (
              <>
                {" "}
                At this rate you finish <b>~{daysLate} days past</b> target.
              </>
            )}
          </div>
        )}

        {/* The Phase 5 honesty label. A backend candidate holding a frontend
            template must be able to see that on the printed copy too — a notice
            that only exists on screen is a notice that disappears exactly when
            the plan is being taken seriously. */}
        {mismatched && (
          <div className="print-banner print-banner-amber">
            <span className="print-eyebrow print-eyebrow-amber">Template mismatch</span>
            AI generation was unavailable when this roadmap was created, so it was built from
            Prep&apos;s seeded <b>frontend</b> curriculum — but you selected <b>{role}</b>. The
            structure is sound; the topics are not your track. Regenerate when the model is
            available.
          </div>
        )}

        {/* --- stat tiles -------------------------------------------------- */}
        <section className="print-stats">
          <div className="print-stat">
            <div className="print-stat-label">Hours logged</div>
            <div className={`print-stat-value${behind ? " print-red" : ""}`}>{logged}</div>
            <div className="print-stat-sub">of {plan.hoursPlanned} planned</div>
          </div>
          <div className="print-stat">
            <div className="print-stat-label">Pace</div>
            <div className={`print-stat-value${pace !== null && pace < required ? " print-red" : ""}`}>
              {pace === null ? "—" : pace}
            </div>
            <div className="print-stat-sub">
              {pace === null ? "less than a week in" : `hrs/wk · need ${required}`}
            </div>
          </div>
          <div className="print-stat">
            <div className="print-stat-label">Recall accuracy</div>
            <div className="print-stat-value">{accuracy === null ? "—" : `${accuracy}%`}</div>
            <div className="print-stat-sub">
              {accuracy === null ? "no reviews yet" : `across ${reviews.length} reviews`}
            </div>
          </div>
          <div className="print-stat">
            <div className="print-stat-label">Topics mastered</div>
            <div className="print-stat-value">
              {masteredCount} / {topicCount}
            </div>
            <div className="print-stat-sub">{masteredPct}%</div>
          </div>
        </section>

        {/* --- week cards --------------------------------------------------- */}
        <h2 className="print-section">The plan</h2>
        {rawWeeks.length === 0 ? (
          <p style={{ fontSize: "11.5px", color: "var(--pk-muted)" }}>
            This roadmap has no weeks. Nothing to print.
          </p>
        ) : (
          rawWeeks.map((w, i) => (
            <article key={w.id} className="print-week">
              <div className="print-week-head">
                <span className="print-week-n">W{w.n}</span>
                <span className="print-week-title">{w.title}</span>
                <span className="print-week-meta">
                  {bars[i] ? `${bars[i].loggedHours}h / ` : ""}
                  {w.hours}h · {w.topics.filter((t) => t.status === "mastered").length}/
                  {w.topics.length} mastered
                </span>
              </div>
              <ul className="print-topics">
                {w.topics.map((t) => (
                  <li key={t.id} className="print-topic">
                    <span
                      className={
                        "print-box" +
                        (t.status === "mastered"
                          ? " print-box-done"
                          : t.status === "in_progress"
                            ? " print-box-wip"
                            : "")
                      }
                    />
                    <span className="print-topic-name">{t.name}</span>
                    <span className="print-topic-status">
                      {t.status === "mastered"
                        ? "mastered"
                        : t.status === "in_progress"
                          ? "in progress"
                          : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="print-kill">
                <span className="print-eyebrow print-eyebrow-red">Kill criterion</span>
                {w.killCriterion}
              </div>
            </article>
          ))
        )}

        {/* --- footer: recall schedule + blockers --------------------------- */}
        <div className="print-footer">
          <section>
            <h2 className="print-section">Recall schedule</h2>
            <ul className="print-list">
              {buckets.map((b) => (
                <li key={b.key}>
                  <span className="print-bucket-count">{b.count}</span> · {b.label}
                  {b.topics.length > 0 && (
                    <div style={{ color: "var(--pk-muted)", fontSize: "10.5px" }}>
                      {b.topics.slice(0, 4).join(", ")}
                      {b.topics.length > 4 ? ` +${b.topics.length - 4} more` : ""}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="print-section">What&apos;s blocking you</h2>
            {blockers.length === 0 ? (
              <p style={{ fontSize: "11.5px", color: "var(--pk-muted)", margin: 0 }}>
                Nothing is blocking you — {elapsed} week{elapsed === 1 ? "" : "s"} in with {logged}h
                logged against {expected}h expected.
              </p>
            ) : (
              <ul className="print-list">
                {blockers.map((b) => (
                  <li key={b.head}>
                    <b>{b.head}</b>{" "}
                    <span style={{ color: "var(--pk-muted)" }}>{b.body}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="print-sign">
          <span>
            Mastery is earned: a topic counts only when its kill criterion is checked.
          </span>
          <span className="print-mono">prep · {roadmap.id.slice(0, 8)}</span>
        </div>
      </main>
    </>
  );
}
