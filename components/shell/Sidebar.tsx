"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import ThemeToggle from "./ThemeToggle";
import SignOutButton from "./SignOutButton";

export type SidebarUser = {
  displayName: string;
  track: string | null;
  initials: string;
};

/* Nav item style: no bordered pill. Active reads as full-strength text on a
   faint page-coloured lift; inactive is muted and brightens on hover (.nav-link). */
function navStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "7px 10px",
    borderRadius: "6px",
    background: active ? "var(--bg)" : "transparent",
    boxShadow: active ? "0 0 0 1px var(--border)" : "none",
    color: active ? "var(--text)" : "var(--text-muted)",
    cursor: "pointer",
    font: "inherit",
    fontSize: "13.5px",
    fontWeight: active ? 600 : 500,
    textDecoration: "none",
  };
}

type NavItem = { href: string; label: string; icon: ReactNode };

// Phase 0 nav = the screens that exist as real routes (phases.md). Roadmap/Study
// are per-roadmap context and appear once a roadmap is opened (later phases).
const NAV: NavItem[] = [
  {
    href: "/library",
    label: "My roadmaps",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <rect x="2.4" y="2.4" width="4.8" height="4.8" rx="1" />
        <rect x="8.8" y="2.4" width="4.8" height="4.8" rx="1" />
        <rect x="2.4" y="8.8" width="4.8" height="4.8" rx="1" />
        <rect x="8.8" y="8.8" width="4.8" height="4.8" rx="1" />
      </svg>
    ),
  },
  {
    href: "/recall",
    label: "Recall",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path d="M13 8a5 5 0 1 1-1.6-3.7" />
        <path d="M13 3v2.3h-2.3" />
      </svg>
    ),
  },
  {
    href: "/progress",
    label: "Progress",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path d="M2.5 13h11" />
        <rect x="3.2" y="8.5" width="2.4" height="3.2" />
        <rect x="6.8" y="5.5" width="2.4" height="6.2" />
        <rect x="10.4" y="3.2" width="2.4" height="8.5" />
      </svg>
    ),
  },
  {
    // Phase 4: the internal cost readout. Kept off /progress on purpose — that
    // screen is about study honesty (Rule 19), this one is about spend.
    href: "/usage",
    label: "AI usage",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path d="M2.5 11.2l3.4-3.9 2.6 2.3 4.9-5.4" />
        <path d="M10.6 4.2h2.9v2.9" />
      </svg>
    ),
  },
];

/* Due-count: a bare number in the accent colour — a count, not a pill. */
const badgeStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "11.5px",
  color: "var(--accent)",
  fontWeight: 500,
};

export default function Sidebar({ user, recallDue = 0 }: { user: SidebarUser; recallDue?: number }) {
  const pathname = usePathname();

  return (
    <aside
      className="app-sidebar"
      aria-label="Main"
      style={{
        width: "244px",
        flex: "0 0 244px",
        borderRight: "1px solid var(--border)",
        background: "var(--bg-sunken)",
        display: "flex",
        flexDirection: "column",
        padding: "22px 12px 14px",
      }}
    >
      {/* Wordmark — typographic, no logo tile. */}
      <Link
        href="/library"
        className="app-brand"
        style={{ display: "flex", alignItems: "baseline", gap: "8px", padding: "4px 10px 22px", color: "var(--text)" }}
      >
        <span style={{ fontFamily: "var(--font-serif)", fontSize: "24px", fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1 }}>
          Prep
        </span>
        <span style={{ fontSize: "12px", color: "var(--text-faint)" }}>interview notebook</span>
      </Link>

      {/* Nav */}
      <nav className="app-nav" style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              // aria-current tells a screen reader which nav item is the current
              // page. Until Phase 5 "active" was communicated purely by colour and
              // background — information a sighted mouse user gets for free and a
              // screen-reader user got not at all.
              aria-current={active ? "page" : undefined}
              className="nav-link"
              style={navStyle(active)}
            >
              {item.icon}
              <span style={{ flex: 1, textAlign: "left" }}>{item.label}</span>
              {item.href === "/recall" && recallDue > 0 && (
                <span style={badgeStyle} data-testid="recall-due-badge">
                  {recallDue}
                  <span
                    style={{
                      position: "absolute",
                      width: "1px",
                      height: "1px",
                      overflow: "hidden",
                      clip: "rect(0 0 0 0)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {" "}
                    cards due
                  </span>
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* New roadmap — a quiet row under the nav, not a second primary button. */}
      <Link
        href="/onboarding"
        className="app-new-roadmap nav-link"
        style={{ ...navStyle(pathname === "/onboarding"), marginTop: "14px" }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M8 3.2v9.6M3.2 8h9.6" />
        </svg>
        New roadmap
      </Link>

      <div className="app-spacer" style={{ flex: 1 }} />

      {/* User row — identity, theme, sign-out on one line. */}
      <div className="app-user" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 6px 2px 10px", borderTop: "1px solid var(--border)" }}>
        <div
          style={{
            width: "26px",
            height: "26px",
            borderRadius: "50%",
            background: "var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--text-muted)",
            flex: "0 0 auto",
          }}
        >
          {user.initials}
        </div>
        <div style={{ lineHeight: 1.3, flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "13px",
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {user.displayName}
          </div>
          <div
            style={{
              fontSize: "11.5px",
              color: "var(--text-faint)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {user.track ?? "No track set"}
          </div>
        </div>
        <ThemeToggle />
        <SignOutButton />
      </div>
    </aside>
  );
}
