import type { ReactNode } from "react";

type HeaderProps = {
  title: string;
  subtitle?: string;
  /** Right-aligned status tag (e.g. "on track"). Styled by the caller. */
  tag?: ReactNode;
};

/** Header bar from the design: screenTitle + screenSubtitle + right status tag. */
export default function Header({ title, subtitle, tag }: HeaderProps) {
  return (
    <header
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        padding: "16px 28px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: "16px",
            fontWeight: 600,
            letterSpacing: "-0.01em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: "12.5px", color: "var(--text-muted)", marginTop: "1px" }}>{subtitle}</div>
        )}
      </div>
      {tag && <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "0 0 auto" }}>{tag}</div>}
    </header>
  );
}
