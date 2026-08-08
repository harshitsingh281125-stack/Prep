import type { AccuracyPoint } from "@/lib/progress/compute";
import { EmptyChart } from "./HoursChart";

// Recall accuracy trend. Hand-rolled SVG (Rule 22: no charting library) — the
// whole "chart" is a polyline plus gridlines, which is a handful of lines of
// coordinate math and no dependency.
//
// The viewBox is fixed at 320x150 (from the design source) and the SVG scales to
// its container, so the layout is responsive without recomputing anything.

const VB_WIDTH = 320;
const VB_HEIGHT = 150;
const PLOT_LEFT = 20; // y-axis position
const PLOT_RIGHT = 312;
const PLOT_TOP = 20; // y for 100%
const PLOT_BOTTOM = 120; // y for the axis (40%)

// The y-axis is deliberately clipped to 40–100%, matching the design. Recall
// accuracy below 40% is rare enough that a 0-based axis would squash the whole
// series into the top third and hide exactly the movement the chart exists to
// show. Values under 40 are clamped to the axis floor rather than drawn off-chart.
const Y_MIN = 40;
const Y_MAX = 100;

function toY(accuracy: number): number {
  const clamped = Math.min(Y_MAX, Math.max(Y_MIN, accuracy));
  const ratio = (clamped - Y_MIN) / (Y_MAX - Y_MIN);
  return Math.round((PLOT_BOTTOM - ratio * (PLOT_BOTTOM - PLOT_TOP)) * 10) / 10;
}

function toX(index: number, total: number): number {
  if (total <= 1) return PLOT_LEFT;
  const span = PLOT_RIGHT - PLOT_LEFT;
  return Math.round(PLOT_LEFT + index * (span / (total - 1)));
}

export default function AccuracyChart({
  points,
  overall,
  direction,
}: {
  points: AccuracyPoint[];
  overall: number | null;
  direction: "rising" | "falling" | "flat";
}) {
  // Colour follows the number, not the mood: green only when it's genuinely good.
  const color =
    overall === null
      ? "var(--text-faint)"
      : overall >= 80
        ? "var(--green)"
        : overall >= 60
          ? "var(--amber)"
          : "var(--red)";

  const coords = points.map((p) => ({ x: toX(p.index, points.length), y: toY(p.accuracy) }));
  const polyline = coords.map((c) => `${c.x},${c.y}`).join(" ");

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        padding: "18px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "16px",
          gap: "12px",
        }}
      >
        <div style={{ fontSize: "13px", fontWeight: 600 }}>
          Recall accuracy · last {points.length || 0} block{points.length === 1 ? "" : "s"}
        </div>
        <div
          style={{
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: "12px",
            color,
            flex: "0 0 auto",
          }}
        >
          {overall === null ? "—" : `${overall}% · ${direction}`}
        </div>
      </div>

      {points.length < 2 ? (
        <EmptyChart message="Not enough reviews yet — grade a few recall cards and the trend appears here." />
      ) : (
        <svg viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`} style={{ width: "100%", height: "150px", overflow: "visible" }}>
          {/* axes */}
          <line x1={PLOT_LEFT} y1={PLOT_TOP} x2={PLOT_LEFT} y2={PLOT_BOTTOM} stroke="var(--border)" strokeWidth="1" />
          <line x1={PLOT_LEFT} y1={PLOT_BOTTOM} x2={PLOT_RIGHT} y2={PLOT_BOTTOM} stroke="var(--border)" strokeWidth="1" />

          {/* gridlines at 80% and 60% */}
          <line x1={PLOT_LEFT} y1={toY(80)} x2={PLOT_RIGHT} y2={toY(80)} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 4" />
          <line x1={PLOT_LEFT} y1={toY(60)} x2={PLOT_RIGHT} y2={toY(60)} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 4" />

          {/* y labels */}
          {[100, 80, 60].map((v) => (
            <text
              key={v}
              x={PLOT_LEFT - 5}
              y={toY(v) + 3}
              textAnchor="end"
              fontFamily="IBM Plex Mono, monospace"
              fontSize="9"
              fill="var(--text-faint)"
            >
              {v}
            </text>
          ))}

          <polyline points={polyline} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          {coords.map((c, i) => (
            <circle key={i} cx={c.x} cy={c.y} r="2.6" fill={color} />
          ))}
        </svg>
      )}
    </div>
  );
}
