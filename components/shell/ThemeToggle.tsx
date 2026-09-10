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

  const label = theme === "dark" ? "☾ Dark" : "☀ Light";

  return (
    <button
      type="button"
      className="app-theme"
      onClick={toggle}
      // The visible label is "☾ Dark" — a STATE, not an action, which is
      // ambiguous read aloud ("dark… button" could mean either). aria-label says
      // what pressing it does; aria-pressed says which state it is in.
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      aria-pressed={theme === "light"}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        padding: "8px",
        marginBottom: "12px",
        border: "1px solid var(--border)",
        background: "transparent",
        color: "var(--text-muted)",
        borderRadius: "8px",
        cursor: "pointer",
        fontFamily: "'IBM Plex Mono',monospace",
        fontSize: "12px",
      }}
    >
      {label}
    </button>
  );
}
