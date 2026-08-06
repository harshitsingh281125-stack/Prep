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

/* Nav item style — from the design's navStyle(): active gets an elevated bg +
   border + full text color + 600 weight; inactive is muted. */
function navStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 10px",
    borderRadius: "7px",
    border: "1px solid " + (active ? "var(--border)" : "transparent"),
    background: active ? "var(--bg-elevated)" : "transparent",
    color: active ? "var(--text)" : "var(--text-muted)",
    cursor: "pointer",
    font: "inherit",
    fontSize: "13px",
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
];

/* Due-count badge from the design's recallBadgeStyle — mono, pill, accent-soft. */
const badgeStyle: CSSProperties = {
  fontFamily: "'IBM Plex Mono',monospace",
  fontSize: "11px",
  minWidth: "18px",
  textAlign: "center",
  padding: "1px 6px",
  borderRadius: "10px",
  background: "var(--accent-soft)",
  color: "var(--accent)",
  fontWeight: 600,
};

export default function Sidebar({ user, recallDue = 0 }: { user: SidebarUser; recallDue?: number }) {
  const pathname = usePathname();

  return (
    <aside
      style={{
        width: "244px",
        flex: "0 0 244px",
        borderRight: "1px solid var(--border)",
        background: "var(--bg-sunken)",
        display: "flex",
        flexDirection: "column",
        padding: "16px 12px",
      }}
    >
      {/* Logo mark */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 8px 18px" }}>
        <div
          style={{
            width: "30px",
            height: "30px",
            borderRadius: "8px",
            background: "var(--accent)",
            color: "oklch(0.99 0 0)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'IBM Plex Mono',monospace",
            fontWeight: 600,
            fontSize: "16px",
          }}
        >
          P
        </div>
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontWeight: 600, letterSpacing: "-0.01em" }}>Prep</div>
          <div style={{ fontSize: "11px", color: "var(--text-faint)", fontFamily: "'IBM Plex Mono',monospace" }}>
            interview OS
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link key={item.href} href={item.href} style={navStyle(active)}>
              {item.icon}
              <span style={{ flex: 1, textAlign: "left" }}>{item.label}</span>
              {item.href === "/recall" && recallDue > 0 && (
                <span style={badgeStyle} data-testid="recall-due-badge">
                  {recallDue}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* New roadmap (routes to onboarding — a Phase 1 screen; safe placeholder link) */}
      <Link
        href="/onboarding"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "7px",
          width: "100%",
          padding: "9px",
          marginTop: "12px",
          borderRadius: "8px",
          font: "inherit",
          fontSize: "13px",
          fontWeight: 600,
          cursor: "pointer",
          border: "1px solid var(--accent)",
          background: "var(--accent-soft)",
          color: "var(--accent)",
          textDecoration: "none",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path d="M8 3.2v9.6M3.2 8h9.6" />
        </svg>
        New roadmap
      </Link>

      <div style={{ flex: 1 }} />

      {/* Theme toggle */}
      <ThemeToggle />

      {/* User card — real identity + working sign-out */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px", borderTop: "1px solid var(--border)" }}>
        <div
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--text-muted)",
            flex: "0 0 auto",
          }}
        >
          {user.initials}
        </div>
        <div style={{ lineHeight: 1.25, flex: 1, minWidth: 0 }}>
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
              fontSize: "11px",
              color: "var(--text-faint)",
              fontFamily: "'IBM Plex Mono',monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {user.track ?? "no track set"}
          </div>
        </div>
        <SignOutButton />
      </div>
    </aside>
  );
}
