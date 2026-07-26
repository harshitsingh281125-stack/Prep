"use client";

import { useState, useActionState, type CSSProperties } from "react";
import ThemeToggle from "@/components/shell/ThemeToggle";
import { signIn, signUp, type AuthResult } from "./actions";

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: "12px",
  color: "var(--text-muted)",
  marginBottom: "6px",
  fontFamily: "'IBM Plex Mono',monospace",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "9px",
  border: "1px solid var(--border)",
  background: "var(--bg-sunken)",
  color: "var(--text)",
  font: "inherit",
  fontSize: "14px",
  outline: "none",
};

// Email/password wired to server actions (app/login/actions.ts). Google OAuth is
// added in a later step (button stays disabled for now).
export default function LoginPage() {
  const [isSignup, setIsSignup] = useState(false);
  const action = isSignup ? signUp : signIn;
  const [state, formAction, pending] = useActionState<AuthResult, FormData>(action, undefined);

  const title = isSignup ? "Create your account" : "Welcome back";
  const subtitle = isSignup
    ? "No fluff. Five questions after this, then a roadmap you'll actually be held to."
    : "Sign in to pick up where you left off.";
  const cta = isSignup ? "Create account" : "Sign in";
  const switchPrompt = isSignup ? "Already have an account?" : "New here?";
  const switchLabel = isSignup ? "Sign in" : "Create one";
  const errorMsg = state && "error" in state ? state.error : null;

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        position: "relative",
      }}
    >
      <div style={{ position: "absolute", top: "20px", right: "20px" }}>
        <ThemeToggle />
      </div>

      <div style={{ width: "100%", maxWidth: "392px" }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "11px", marginBottom: "26px" }}>
          <div
            style={{
              width: "34px",
              height: "34px",
              borderRadius: "9px",
              background: "var(--accent)",
              color: "oklch(0.99 0 0)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'IBM Plex Mono',monospace",
              fontWeight: 600,
              fontSize: "18px",
            }}
          >
            P
          </div>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontWeight: 600, fontSize: "17px", letterSpacing: "-0.01em" }}>Prep</div>
            <div style={{ fontSize: "11px", color: "var(--text-faint)", fontFamily: "'IBM Plex Mono',monospace" }}>
              interview OS
            </div>
          </div>
        </div>

        {/* Card */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "14px", padding: "28px" }}>
          <div style={{ fontSize: "19px", fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</div>
          <div style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: "5px", lineHeight: 1.5 }}>{subtitle}</div>

          <form action={formAction}>
            <div style={{ display: "flex", flexDirection: "column", gap: "13px", marginTop: "22px" }}>
              {isSignup && (
                <label>
                  <span style={labelStyle}>Name</span>
                  <input name="name" type="text" placeholder="Dana Kim" style={inputStyle} />
                </label>
              )}
              <label>
                <span style={labelStyle}>Work email</span>
                <input name="email" type="email" placeholder="you@company.com" style={inputStyle} required />
              </label>
              <label>
                <span style={labelStyle}>Password</span>
                <input name="password" type="password" placeholder="••••••••" style={inputStyle} required />
              </label>
            </div>

            {errorMsg && (
              <div
                style={{
                  marginTop: "14px",
                  padding: "9px 12px",
                  borderRadius: "8px",
                  background: "var(--red-soft)",
                  border: "1px solid var(--red)",
                  color: "var(--red)",
                  fontSize: "12.5px",
                  lineHeight: 1.4,
                }}
              >
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={pending}
              style={{
                width: "100%",
                marginTop: "18px",
                padding: "11px",
                borderRadius: "9px",
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "oklch(0.99 0 0)",
                font: "inherit",
                fontSize: "14px",
                fontWeight: 600,
                cursor: pending ? "wait" : "pointer",
                opacity: pending ? 0.7 : 1,
              }}
            >
              {pending ? "…" : cta}
            </button>
          </form>

          <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "18px 0" }}>
            <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11px", color: "var(--text-faint)" }}>or</span>
            <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
          </div>

          <button
            disabled
            title="Google OAuth added in a follow-up step"
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: "9px",
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              color: "var(--text-faint)",
              font: "inherit",
              fontSize: "13.5px",
              fontWeight: 500,
              cursor: "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "9px",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 16 16">
              <path fill="currentColor" d="M8 3.2c1.3 0 2.2.55 2.7 1l1.9-1.9C11.4 1.2 9.9.5 8 .5 5.1.5 2.6 2.2 1.4 4.6l2.2 1.7C4.2 4.5 5.9 3.2 8 3.2z" />
              <path fill="currentColor" opacity="0.65" d="M15.3 8.2c0-.5-.05-1-.14-1.5H8v3h4.1c-.18 1-.75 1.8-1.6 2.4l2.15 1.65C14.4 12.3 15.3 10.5 15.3 8.2z" />
              <path fill="currentColor" opacity="0.45" d="M3.6 9.7A4.8 4.8 0 0 1 3.35 8c0-.6.1-1.15.25-1.7L1.4 4.6A7.5 7.5 0 0 0 .6 8c0 1.2.3 2.35.8 3.4l2.2-1.7z" />
              <path fill="currentColor" opacity="0.85" d="M8 15.5c1.9 0 3.5-.63 4.65-1.7l-2.15-1.65c-.6.4-1.4.65-2.5.65-2.1 0-3.8-1.3-4.4-3.1L1.4 11.4C2.6 13.8 5.1 15.5 8 15.5z" />
            </svg>
            Continue with Google
          </button>

          <div
            style={{
              marginTop: "14px",
              fontSize: "11px",
              color: "var(--text-faint)",
              fontFamily: "'IBM Plex Mono',monospace",
              textAlign: "center",
            }}
          >
            Google sign-in added next
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: "18px", fontSize: "13px", color: "var(--text-muted)" }}>
          {switchPrompt}{" "}
          <button
            onClick={() => setIsSignup((v) => !v)}
            style={{
              border: "none",
              background: "none",
              color: "var(--accent)",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              padding: 0,
            }}
          >
            {switchLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
