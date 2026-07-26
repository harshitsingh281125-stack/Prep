/** Honest "not built yet" panel for routes whose real screen lands in a later
 *  phase. Keeps the nav navigable in Phase 0 without faking functionality. */
export default function PhasePlaceholder({ phase, blurb }: { phase: string; blurb: string }) {
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
          fontFamily: "'IBM Plex Mono',monospace",
          fontSize: "11px",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-faint)",
          marginBottom: "10px",
        }}
      >
        {phase}
      </div>
      <div style={{ fontSize: "19px", fontWeight: 600, letterSpacing: "-0.015em" }}>Coming soon</div>
      <div style={{ color: "var(--text-muted)", marginTop: "6px", maxWidth: "48ch" }}>{blurb}</div>
    </div>
  );
}
