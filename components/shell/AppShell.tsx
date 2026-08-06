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
    <div style={{ height: "100vh", overflow: "hidden", display: "flex" }}>
      <Sidebar user={user} recallDue={recallDue} />
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {children}
      </main>
    </div>
  );
}
