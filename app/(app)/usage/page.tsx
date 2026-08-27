import Link from "next/link";
import Header from "@/components/shell/Header";
import ContentArea from "@/components/shell/ContentArea";
import { createClient } from "@/lib/supabase/server";
import { DAILY_CALL_CAP, MODELS, USAGE_WINDOW, billingMode, providerName } from "@/lib/ai/config";
import { summarize, type UsageRow } from "@/lib/ai/cost";
import { startOfUtcDay } from "@/lib/ai/gateway";

export const dynamic = "force-dynamic";

const MONO = "'IBM Plex Mono',monospace";

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
      <Header
        title="AI usage"
        subtitle={
          truncated
            ? `What the gateway spent over the last ${USAGE_WINDOW} calls, and what it would cost on a paid tier.`
            : "What the gateway spent, and what it would cost on a paid tier."
        }
        tag={
          <span
            style={{
              fontFamily: MONO,
              fontSize: "11px",
              color: provider === "none" ? "var(--amber)" : "var(--accent)",
              background: provider === "none" ? "var(--amber-soft)" : "var(--accent-soft)",
              border: "1px solid " + (provider === "none" ? "var(--amber)" : "var(--accent)"),
              borderRadius: "6px",
              padding: "4px 10px",
            }}
          >
            {provider === "none" ? "AI OFF" : `${provider} · ${billing}`}
          </span>
        }
      />
      <ContentArea maxWidth={1000}>
        {/* Daily cap (Rule 3) */}
        <div
          data-testid="cap-meter"
          style={{
            background: "var(--panel)",
            border: "1px solid " + (remaining === 0 ? "var(--red)" : "var(--border)"),
            borderRadius: "12px",
            padding: "18px 20px",
            marginBottom: "22px",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "10px" }}>
            <div style={{ fontSize: "13px", fontWeight: 600 }}>Daily call cap</div>
            <div style={{ fontFamily: MONO, fontSize: "13px", color: remaining === 0 ? "var(--red)" : "var(--text-muted)" }}>
              <span data-testid="cap-used">{usedToday}</span> / {DAILY_CALL_CAP} today
            </div>
          </div>
          <div style={{ height: "8px", borderRadius: "4px", background: "var(--bg-elevated)", overflow: "hidden" }}>
            <div
              style={{
                width: `${capPct}%`,
                height: "100%",
                background: remaining === 0 ? "var(--red)" : capPct > 75 ? "var(--amber)" : "var(--accent)",
              }}
            />
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "8px", lineHeight: 1.5 }}>
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "22px" }}>
              <StatTile
                testId="stat-per-roadmap"
                label="$ / roadmap"
                value={s.costPerRoadmapUsd === null ? "—" : usd(s.costPerRoadmapUsd)}
                sub={s.costPerRoadmapUsd === null ? "none generated yet" : "projected, incl. retries"}
              />
              <StatTile
                testId="stat-cache"
                label="Cache hit-rate"
                value={s.cacheHitRate === null ? "—" : `${Math.round(s.cacheHitRate * 100)}%`}
                sub={`of ${fmt(s.inputTokens)} input tokens`}
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
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "12px",
                padding: "18px 20px",
                marginBottom: "22px",
              }}
            >
              <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "14px" }}>Cost</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
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
                      ? "no spend yet"
                      : `${Math.round(s.cacheSavingRatio * 100)}% off the uncached projection`
                  }
                  valueColor={s.cacheSavingUsd > 0 ? "var(--green)" : undefined}
                />
              </div>
              <div
                style={{
                  fontSize: "12.5px",
                  color: "var(--text-muted)",
                  lineHeight: 1.6,
                  marginTop: "14px",
                  paddingTop: "14px",
                  borderTop: "1px solid var(--border)",
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
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "12px",
                padding: "18px 20px",
                overflowX: "auto",
              }}
            >
              <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "14px" }}>By route</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ color: "var(--text-faint)", fontFamily: MONO, fontSize: "11px", textTransform: "uppercase" }}>
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
      <div style={{ fontFamily: MONO, fontSize: "11px", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div data-testid={testId} style={{ fontSize: "20px", fontWeight: 700, letterSpacing: "-0.02em", marginTop: "4px", color: valueColor }}>
        {value}
      </div>
      <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>{note}</div>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  valueColor,
  testId,
}: {
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "10px", padding: "14px 16px" }}
    >
      <div style={{ fontFamily: MONO, fontSize: "11px", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div
        data-testid={testId ? `${testId}-value` : undefined}
        style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "-0.02em", marginTop: "4px", color: valueColor }}
      >
        {value}
      </div>
      <div style={{ fontSize: "12px", marginTop: "2px", color: "var(--text-muted)" }}>{sub}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ border: "1px dashed var(--border)", borderRadius: "12px", padding: "48px 28px", textAlign: "center" }}>
      <div style={{ fontSize: "15px", fontWeight: 600, marginBottom: "6px" }}>No AI calls yet</div>
      <div style={{ fontSize: "13.5px", color: "var(--text-muted)", marginBottom: "18px", lineHeight: 1.6 }}>
        Every generation writes one row per provider dispatch — including the ones that failed
        validation. Generate a roadmap, or open a topic and generate its study material, and the
        tokens and projected cost show up here.
      </div>
      <Link
        href="/onboarding"
        style={{
          padding: "10px 18px",
          borderRadius: "9px",
          border: "1px solid var(--accent)",
          background: "var(--accent)",
          color: "oklch(0.99 0 0)",
          fontSize: "13.5px",
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Generate a roadmap →
      </Link>
    </div>
  );
}
