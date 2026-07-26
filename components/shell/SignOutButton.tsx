"use client";

import { signOut } from "@/app/login/actions";

// Small sign-out control in the sidebar user card. Calls the server action.
export default function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        title="Sign out"
        style={{
          border: "none",
          background: "none",
          color: "var(--text-faint)",
          cursor: "pointer",
          padding: "4px",
          display: "flex",
          borderRadius: "6px",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M6 2.6H3.2v10.8H6" />
          <path d="M9.6 8H13m0 0-2.2-2.2M13 8l-2.2 2.2" />
        </svg>
      </button>
    </form>
  );
}
