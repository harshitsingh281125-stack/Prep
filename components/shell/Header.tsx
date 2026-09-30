import type { ReactNode } from "react";

type HeaderProps = {
  title: string;
  subtitle?: string;
  /** Right-aligned status tag (e.g. "on track"). Styled by the caller. */
  tag?: ReactNode;
  /** Match the ContentArea below so the title sits on the content's left edge. */
  maxWidth?: number;
  /** Small line above the title — e.g. a back link to the parent screen. */
  eyebrow?: ReactNode;
};

/**
 * Page masthead: serif title + muted subtitle, aligned to the same centred
 * column as the content it introduces. It scrolls with the page (the scroll
 * container is <main>) rather than sitting in a full-width bordered bar — the
 * old bar left the title stranded at the far left of a centred layout.
 */
export default function Header({ title, subtitle, tag, maxWidth = 1000, eyebrow }: HeaderProps) {
  return (
    <header className="app-header" style={{ flex: "0 0 auto", padding: "44px 28px 28px" }}>
      <div
        style={{
          maxWidth: `${maxWidth}px`,
          margin: "0 auto",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          {eyebrow && <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "14px" }}>{eyebrow}</div>}
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-serif)",
              fontSize: "32px",
              fontWeight: 500,
              lineHeight: 1.15,
              letterSpacing: "-0.015em",
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p style={{ margin: "8px 0 0", fontSize: "14px", color: "var(--text-muted)", maxWidth: "60ch" }}>
              {subtitle}
            </p>
          )}
        </div>
        {tag && <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "0 0 auto" }}>{tag}</div>}
      </div>
    </header>
  );
}
