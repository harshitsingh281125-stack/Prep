import type { ReactNode } from "react";
import Sidebar, { type SidebarUser } from "./Sidebar";

/**
 * Full-height app frame from the design: fixed 244px sidebar + a main column
 * whose content area scrolls. Screens supply their own <Header> and content.
 */
export default function AppShell({
  user,
  recallDue = 0,
  children,
}: {
  user: SidebarUser;
  /** Cards due now — rendered as the badge on the Recall nav item. */
  recallDue?: number;
  children: ReactNode;
}) {
  return (
    <div className="app-shell" style={{ height: "100vh", overflow: "hidden", display: "flex" }}>
      {/* Skip link (Phase 5, a11y): the sidebar is ~7 tab stops before the
          content on every screen. Rendered first so it is the first thing a
          keyboard user reaches; visually hidden until focused (globals.css). */}
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Sidebar user={user} recallDue={recallDue} />
      <main
        id="main-content"
        style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}
      >
        {children}
      </main>
    </div>
  );
}
