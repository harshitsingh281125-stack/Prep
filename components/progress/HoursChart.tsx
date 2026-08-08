import type { WeekBar } from "@/lib/progress/compute";

// Hours logged vs planned, per week. Hand-rolled (Rule 22: no charting library).
//
// Bars are plain divs rather than SVG — they're axis-less rectangles, so the
// simplest thing that matches the design source is a flex row of divs whose
// heights are a percentage of the tallest planned value. The accuracy chart next
// door IS an SVG because it needs a polyline and gridlines.

const CHART_HEIGHT = 120;

export default function HoursChart({ bars }: { bars: WeekBar[] }) {
  // Scale to the largest value present so the tallest bar always fills the box.
  // Guard the all-zero case (a brand-new roadmap) so we never divide by zero.
  const max = Math.max(1, ...bars.map((b) => Math.max(b.loggedHours, b.plannedHours)));

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
        }}
      >
        <div style={{ fontSize: "13px", fontWeight: 600 }}>Hours: logged vs planned</div>
        <div
          style={{
            display: "flex",
            gap: "12px",
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: "11px",
          }}
        >
          <span style={{ color: "var(--accent)" }}>■ logged</span>
          <span style={{ color: "var(--text-faint)" }}>■ planned</span>
        </div>
      </div>

      {bars.length === 0 ? (
        <EmptyChart message="No weeks in this roadmap yet." />
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", gap: "14px", height: "150px" }}>
          {bars.map((b) => (
            <div
              key={b.label}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "6px",
                height: "100%",
                justifyContent: "flex-end",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-end", gap: "3px", height: `${CHART_HEIGHT}px` }}>
                <div
                  title={`${b.loggedHours}h logged`}
                  style={{
                    width: "13px",
                    height: `${Math.max(2, (b.loggedHours / max) * CHART_HEIGHT)}px`,
                    background: "var(--accent)",
                    borderRadius: "3px 3px 0 0",
                  }}
                />
                <div
                  title={`${b.plannedHours}h planned`}
                  style={{
                    width: "13px",
                    height: `${Math.max(2, (b.plannedHours / max) * CHART_HEIGHT)}px`,
                    background: "var(--border-strong)",
                    borderRadius: "3px 3px 0 0",
                  }}
                />
              </div>
              <div
                style={{
                  fontFamily: "'IBM Plex Mono',monospace",
                  fontSize: "11px",
                  color: "var(--text-faint)",
                }}
              >
                {b.label}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EmptyChart({ message }: { message: string }) {
  return (
    <div
      style={{
        height: "150px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        fontSize: "12.5px",
        color: "var(--text-faint)",
        border: "1px dashed var(--border)",
        borderRadius: "8px",
        padding: "0 16px",
      }}
    >
      {message}
    </div>
  );
}
