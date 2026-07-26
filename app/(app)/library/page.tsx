import Header from "@/components/shell/Header";
import ContentArea from "@/components/shell/ContentArea";

// Phase 0: empty Library shell. The roadmap grid + 3-creation quota land in
// Phase 1; for now this is the honest empty state from the design.
export default function LibraryPage() {
  return (
    <>
      <Header
        title="Library"
        subtitle="Your roadmaps. No fluff — five questions, then a plan you'll be held to."
      />
      <ContentArea maxWidth={920}>
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
            Build your first plan. Five questions, then a roadmap with kill criteria you can actually be held to.
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
      </ContentArea>
    </>
  );
}
