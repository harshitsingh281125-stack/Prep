"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

function getInitialTheme(): Theme {
  if (typeof document !== "undefined") {
    const t = document.documentElement.getAttribute("data-theme");
    if (t === "light" || t === "dark") return t;
  }
  return "dark";
}

/**
 * Flips `data-theme` on <html> and persists to localStorage.
 * The no-flash script in app/layout.tsx applies the saved value before paint;
 * this just toggles it thereafter. Matches the theme button in the design.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  // Sync state to whatever the no-flash script already set on <html>.
  useEffect(() => {
    setTheme(getInitialTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("prep-theme", next);
    } catch {
      /* storage unavailable — theme still applies for the session */
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      className="app-theme nav-link"
      onClick={toggle}
      // Icon-only: aria-label says what pressing it does; aria-pressed says
      // which state it is in. `title` gives mouse users the same hint.
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      aria-pressed={theme === "light"}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "28px",
        height: "28px",
        padding: 0,
        border: "none",
        background: "transparent",
        color: "var(--text-faint)",
        borderRadius: "6px",
        cursor: "pointer",
        flex: "0 0 auto",
      }}
    >
      {theme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <circle cx="8" cy="8" r="2.8" />
          <path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1" />
        </svg>
      )}
    </button>
  );
}
