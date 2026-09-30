"use client";

import { useState, useActionState, type CSSProperties } from "react";
import ThemeToggle from "@/components/shell/ThemeToggle";
import { createClient } from "@/lib/supabase/client";
import { signIn, signUp, type AuthResult } from "./actions";

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: "13px",
  fontWeight: 500,
  color: "var(--text-muted)",
  marginBottom: "6px",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid var(--border-strong)",
  background: "var(--panel)",
  color: "var(--text)",
  font: "inherit",
  fontSize: "14.5px",
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

  const [googlePending, setGooglePending] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  // OAuth is a browser redirect flow: the client kicks it off, the user bounces
  // to Google, then Supabase redirects back to /auth/callback (our route handler)
  // which exchanges the code for a session cookie. redirectTo uses the current
  // origin so this works on both localhost and the Vercel URL.
  async function signInWithGoogle() {
    setGoogleError(null);
    setGooglePending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setGoogleError(error.message);
      setGooglePending(false);
    }
    // On success the browser navigates away to Google — no further code runs.
  }
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

      <div style={{ width: "100%", maxWidth: "380px" }}>
        {/* Wordmark */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "48px" }}>
          <span style={{ fontFamily: "var(--font-serif)", fontSize: "26px", fontWeight: 500, letterSpacing: "-0.02em" }}>
            Prep
          </span>
          <span style={{ fontSize: "12.5px", color: "var(--text-faint)" }}>interview notebook</span>
        </div>

        <div>
          <h1 style={{ margin: 0, fontFamily: "var(--font-serif)", fontSize: "34px", fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
            {title}
          </h1>
          <div style={{ color: "var(--text-muted)", fontSize: "14.5px", marginTop: "10px", lineHeight: 1.55 }}>{subtitle}</div>

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
                marginTop: "20px",
                padding: "11px",
                borderRadius: "8px",
                border: "1px solid var(--ink)",
                background: "var(--ink)",
                color: "var(--on-ink)",
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
            <span style={{ fontSize: "12.5px", color: "var(--text-faint)" }}>or</span>
            <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
          </div>

          <button
            type="button"
            onClick={signInWithGoogle}
            disabled={googlePending}
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: "8px",
              border: "1px solid var(--border-strong)",
              background: "transparent",
              color: "var(--text)",
              font: "inherit",
              fontSize: "13.5px",
              fontWeight: 500,
              cursor: googlePending ? "wait" : "pointer",
              opacity: googlePending ? 0.7 : 1,
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
            {googlePending ? "Connecting…" : "Continue with Google"}
          </button>

          {googleError && (
            <div
              style={{
                marginTop: "12px",
                padding: "9px 12px",
                borderRadius: "8px",
                background: "var(--red-soft)",
                border: "1px solid var(--red)",
                color: "var(--red)",
                fontSize: "12.5px",
                lineHeight: 1.4,
              }}
            >
              {googleError}
            </div>
          )}
        </div>

        <div style={{ marginTop: "28px", fontSize: "13.5px", color: "var(--text-muted)" }}>
          {switchPrompt}{" "}
          <button
            onClick={() => setIsSignup((v) => !v)}
            style={{
              border: "none",
              background: "none",
              color: "var(--text)",
              fontSize: "13.5px",
              fontWeight: 600,
              textDecoration: "underline",
              textUnderlineOffset: "3px",
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
