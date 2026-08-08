"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type TopicOption = { id: string; name: string; weekN: number };

// Log-hours form. Posts to /api/sessions (a server route, not a direct client
// write — see the route's own comment for why) and then calls router.refresh()
// so the server component re-runs its aggregate queries and every number on the
// screen moves at once. No optimistic UI here on purpose: the whole point of
// this screen is that the figures are the DB's, not the browser's guess.
export default function LogHoursForm({
  roadmapId,
  topics,
}: {
  roadmapId: string;
  topics: TopicOption[];
}) {
  const router = useRouter();
  const [minutes, setMinutes] = useState("60");
  const [topicId, setTopicId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = Number(minutes);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1440) {
      setError("Enter a whole number of minutes between 1 and 1440.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roadmapId,
          topicId: topicId || null,
          minutes: parsed,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Could not log those hours.");
        return;
      }

      setMinutes("60");
      setTopicId("");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const fieldStyle = {
    padding: "9px 11px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
    font: "inherit",
    fontSize: "13px",
  } as const;

  return (
    <form
      onSubmit={submit}
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        padding: "18px",
        marginBottom: "22px",
      }}
    >
      <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "14px" }}>Log study time</div>

      <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          <span style={{ fontSize: "11px", color: "var(--text-faint)", fontFamily: "'IBM Plex Mono',monospace" }}>
            MINUTES
          </span>
          <input
            type="number"
            min={1}
            max={1440}
            step={1}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            aria-label="Minutes studied"
            style={{ ...fieldStyle, width: "110px" }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "5px", flex: 1, minWidth: "240px" }}>
          <span style={{ fontSize: "11px", color: "var(--text-faint)", fontFamily: "'IBM Plex Mono',monospace" }}>
            TOPIC (OPTIONAL)
          </span>
          <select
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
            aria-label="Topic studied"
            style={{ ...fieldStyle, width: "100%" }}
          >
            <option value="">Unattributed — counts toward hours only</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                W{t.weekN} · {t.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={busy}
          style={{
            alignSelf: "flex-end",
            padding: "9px 18px",
            borderRadius: "8px",
            border: "1px solid var(--accent)",
            background: busy ? "var(--bg-elevated)" : "var(--accent)",
            color: busy ? "var(--text-faint)" : "oklch(0.99 0 0)",
            font: "inherit",
            fontSize: "13px",
            fontWeight: 600,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "Logging…" : "Log time"}
        </button>
      </div>

      <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "10px" }}>
        Attributing time to a topic fills that week&apos;s bar in the chart. Leaving it
        unattributed still counts toward total hours.
      </div>

      {error && (
        <div role="alert" style={{ fontSize: "12.5px", color: "var(--red)", marginTop: "10px" }}>
          {error}
        </div>
      )}
    </form>
  );
}
