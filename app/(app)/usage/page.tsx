import Link from "next/link";
import Header from "@/components/shell/Header";
import ContentArea from "@/components/shell/ContentArea";
import { createClient } from "@/lib/supabase/server";
import { DAILY_CALL_CAP, MODELS, USAGE_WINDOW, billingMode, providerName } from "@/lib/ai/config";
import { summarize, type UsageRow } from "@/lib/ai/cost";
import { startOfUtcDay } from "@/lib/ai/gateway";

export const dynamic = "force-dynamic";

const MONO = "var(--font-mono)";

/**
 * AI usage — the internal cost readout (Phase 4).
 *
 * Deliberately a separate screen from Progress. Progress is the study
 * truth-teller (Rule 19) and putting infrastructure metrics on it would dilute
 * the one screen whose job is to be about the user's own honesty. This screen
 * has a different audience: it's the ops view of what the gateway is spending.
 *
 * Server component reading `ai_usage` under RLS — the SELECT-only policy means
 * this can only ever be the caller's own rows. Every number is computed by the
 * pure functions in lib/ai/cost.ts, so what's on screen is exactly what the unit
 * tests assert.
 *
 * The honesty line this screen has to hold: on the free tier NOTHING WAS
 * CHARGED, so the dollar figures are labelled as a projection at paid-tier rates
 * and shown next to the $0.00 that was actually billed. A dashboard that showed
 * a projection under a "cost" heading would be the exact résumé fiction the
 * project set out not to write.
 */
export default async function UsagePage() {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("ai_usage")
    .select("route, tier, model, input_tokens, output_tokens, cached_input_tokens, cost_usd, status, attempts, created_at")
    .order("created_at", { ascending: false })
    .limit(USAGE_WINDOW);

  const all = (rows ?? []) as (UsageRow & { created_at: string })[];
  const dayStart = startOfUtcDay(new Date()).toISOString();
  const today = all.filter((r) => r.created_at >= dayStart);

  const s = summarize(all);
  // The breakdown below aggregates at most USAGE_WINDOW dispatches, so say so
  // when it is capped rather than letting the figures read as a lifetime total.
  const truncated = all.length >= USAGE_WINDOW;
  const usedToday = today.length;
  const remaining = Math.max(0, DAILY_CALL_CAP - usedToday);
  const capPct = Math.min(100, Math.round((usedToday / DAILY_CALL_CAP) * 100));
  const provider = providerName();
  const billing = billingMode();

  const fallbackRate = s.calls > 0 ? Math.round(((s.invalid + s.error) / s.calls) * 100) : 0;

  return (
    <>
      <Header maxWidth={1000}
        title="AI usage"
        subtitle={
          truncated
            ? `What the gateway spent over the last ${USAGE_WINDOW} calls, and what it would cost on a paid tier.`
            : "What the gateway spent, and what it would cost on a paid tier."
        }
        tag={
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "7px",
              fontSize: "13px",
              color: provider === "none" ? "var(--amber)" : "var(--text-muted)",
            }}
          >
            <span
              style={{
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                background: provider === "none" ? "var(--amber)" : "var(--green)",
              }}
            />
            {provider === "none" ? "AI off" : `${provider} · ${billing}`}
          </span>
        }
      />
      <ContentArea maxWidth={1000}>
        {/* Daily cap (Rule 3) */}
        <div
          data-testid="cap-meter"
          style={{
            borderTop: "1px solid " + (remaining === 0 ? "var(--red)" : "var(--border)"),
            paddingTop: "16px",
            marginBottom: "48px",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "12px" }}>
            <div style={{ fontSize: "14px", fontWeight: 600 }}>Daily call cap</div>
            <div style={{ fontSize: "14px", color: remaining === 0 ? "var(--red)" : "var(--text-muted)" }}>
              <span data-testid="cap-used">{usedToday}</span> / {DAILY_CALL_CAP} today
            </div>
          </div>
          <div style={{ height: "3px", borderRadius: "2px", background: "var(--border)", overflow: "hidden" }}>
            <div
              style={{
                width: `${capPct}%`,
                height: "100%",
                background: remaining === 0 ? "var(--red)" : capPct > 75 ? "var(--amber)" : "var(--ink)",
              }}
            />
          </div>
          <div style={{ fontSize: "13px", color: "var(--text-faint)", marginTop: "10px", lineHeight: 1.5 }}>
            {remaining === 0 ? (
              <>
                Cap reached. Generation falls back to seeded content until midnight UTC — nothing is
                blocked, it just stops being generated.
              </>
            ) : (
              <>
                {remaining} call{remaining === 1 ? "" : "s"} left, resets midnight UTC. Counts provider
                dispatches, so a retried generation spends two.
              </>
            )}
          </div>
        </div>

        {s.calls === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Stat tiles */}
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
                testId="stat-per-roadmap"
                label="$ / roadmap"
                value={s.costPerRoadmapUsd === null ? "—" : usd(s.costPerRoadmapUsd)}
                sub={s.costPerRoadmapUsd === null ? "none generated yet" : "projected, incl. retries"}
              />
              <StatTile
                testId="stat-cache"
                label="Cache hit-rate"
                value={s.cacheHitRate === null ? "—" : `${Math.round(s.cacheHitRate * 100)}%`}
                sub={
                  // Phase 6.1: the rate is over cache-capable dispatches only, so
                  // the caption has to say so the moment a non-caching provider
                  // (Groq) has written rows — otherwise the denominator on screen
                  // is not the denominator in the maths.
                  s.cacheHitRate === null
                    ? "no cache-capable calls yet"
                    : s.cacheCapableCalls === s.calls
                      ? `of ${fmt(s.inputTokens)} input tokens`
                      : `over ${s.cacheCapableCalls} of ${s.calls} cache-capable dispatches`
                }
              />
              <StatTile
                testId="stat-tokens"
                label="Tokens in / out"
                value={`${fmt(s.inputTokens)} / ${fmt(s.outputTokens)}`}
                sub={`over ${s.calls} dispatch${s.calls === 1 ? "" : "es"}`}
              />
              <StatTile
                testId="stat-fallback"
                label="Fallback rate"
                value={`${fallbackRate}%`}
                sub={`${s.invalid} malformed · ${s.error} failed`}
                valueColor={fallbackRate > 25 ? "var(--amber)" : undefined}
              />
            </div>

            {/* The cost panel — actual vs projected, stated plainly */}
            <div
              data-testid="cost-panel"
              style={{
                borderTop: "1px solid var(--border)",
                paddingTop: "16px",
                marginBottom: "48px",
              }}
            >
              <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "16px" }}>Cost</div>
              <div className="grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px" }}>
                <Figure
                  label="Actually charged"
                  value={usd(s.actualUsd)}
                  note={billing === "free" ? "free tier — nothing was billed" : "billed at the rate card"}
                />
                <Figure
                  label="Projected (paid tier)"
                  value={usd(s.projectedUsd)}
                  note="same tokens, paid rates"
                  testId="projected-usd"
                />
                <Figure
                  label="Saved by caching"
                  value={usd(s.cacheSavingUsd)}
                  note={
                    s.cacheSavingRatio === null
                      ? "no cache-capable spend yet"
                      : `${Math.round(s.cacheSavingRatio * 100)}% off the uncached projection`
                  }
                  valueColor={s.cacheSavingUsd > 0 ? "var(--green)" : undefined}
                />
              </div>
              <div
                style={{
                  fontSize: "13.5px",
                  color: "var(--text-muted)",
                  lineHeight: 1.65,
                  marginTop: "20px",
                  padding: "14px 18px",
                  background: "var(--bg-sunken)",
                  borderRadius: "10px",
                  maxWidth: "78ch",
                }}
              >
                <b>Read this carefully.</b> On the free tier the charged column is $0.00 and so is any
                &ldquo;saving&rdquo; in real money. The projection multiplies the <i>real</i> token
                counts by published paid-tier rates ({MODELS.reasoning} / {MODELS.classification}) to
                answer &ldquo;what would this have cost, and how much of that did prompt caching take
                off?&rdquo; It is a projection, computed at read time from the token columns — never a
                stored number, and never presented as money that moved.
              </div>
            </div>

            {/* Per-route breakdown */}
            <div
              style={{
                borderTop: "1px solid var(--border)",
                paddingTop: "16px",
                overflowX: "auto",
              }}
            >
              <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}>By route</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ color: "var(--text-faint)", fontSize: "12.5px" }}>
                    <th style={th}>Route</th>
                    <th style={thRight}>Calls</th>
                    <th style={thRight}>Tokens in</th>
                    <th style={thRight}>Tokens out</th>
                    <th style={thRight}>Projected</th>
                  </tr>
                </thead>
                <tbody>
                  {s.perRoute.map((r) => (
                    <tr key={r.route} data-testid="route-row" style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ ...td, fontFamily: MONO, fontSize: "12px" }}>{r.route}</td>
                      <td style={tdRight}>{r.calls}</td>
                      <td style={tdRight}>{fmt(r.inputTokens)}</td>
                      <td style={tdRight}>{fmt(r.outputTokens)}</td>
                      <td style={tdRight}>{usd(r.projectedUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </ContentArea>
    </>
  );
}

/** Costs here are fractions of a cent, so 2dp would render every row as $0.00. */
function usd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(2)}`;
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

const th: React.CSSProperties = { textAlign: "left", padding: "0 8px 8px 0", fontWeight: 500 };
const thRight: React.CSSProperties = { ...th, textAlign: "right", padding: "0 0 8px 8px" };
const td: React.CSSProperties = { padding: "9px 8px 9px 0" };
const tdRight: React.CSSProperties = { ...td, textAlign: "right", fontFamily: MONO, fontSize: "12.5px", padding: "9px 0 9px 8px" };

function Figure({
  label,
  value,
  note,
  valueColor,
  testId,
}: {
  label: string;
  value: string;
  note: string;
  valueColor?: string;
  testId?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: "13px", color: "var(--text-muted)", fontWeight: 500 }}>{label}</div>
      <div
        data-testid={testId}
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "28px",
          fontWeight: 500,
          letterSpacing: "-0.02em",
          marginTop: "4px",
          color: valueColor,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: "12.5px", color: "var(--text-faint)", marginTop: "2px" }}>{note}</div>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  valueColor,
  testId,
  first,
}: {
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
  testId?: string;
  first?: boolean;
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
          fontSize: "30px",
          fontWeight: 500,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          marginTop: "6px",
          color: valueColor,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: "12.5px", marginTop: "4px", color: "var(--text-faint)" }}>{sub}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "40px 0", maxWidth: "60ch" }}>
      <div style={{ fontFamily: "var(--font-serif)", fontSize: "24px", marginBottom: "8px" }}>No AI calls yet.</div>
      <div style={{ fontSize: "15px", color: "var(--text-muted)", marginBottom: "24px", lineHeight: 1.6 }}>
        Every generation writes one row per provider dispatch — including the ones that failed
        validation. Generate a roadmap, or open a topic and generate its study material, and the
        tokens and projected cost show up here.
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
        Generate a roadmap →
      </Link>
    </div>
  );
}
