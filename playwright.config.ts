import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Load test-user creds + Supabase keys from .env.test (gitignored — never commit
// test creds). Falls back to .env.local for the Supabase URL/anon key if present.
loadEnv({ path: ".env.test" });
loadEnv({ path: ".env.local" });

// Dedicated test port, NOT the dev port (3001).
//
// This used to default to 3001 with `reuseExistingServer: true`, which quietly
// burned real Gemini tokens: if you had your own `npm run dev` running, Playwright
// reused YOUR server — which has your real API key — and the AI_PROVIDER=mock below
// never applied. 26 real calls went out that way before it was spotted in ai_usage.
// A separate port means the test server is always one WE started, with the env
// WE chose.
const PORT = process.env.PW_PORT ?? "3101";
const BASE_URL = `http://localhost:${PORT}`;

// A SECOND test server, on the next port up, that differs from the first in
// exactly one environment variable: the RAG similarity floor (Phase 4.5).
//
// Why a whole second server rather than a flag: Next.js reads env only at
// startup, so one process cannot serve both "the corpus has something for this
// topic" and "the corpus has nothing" — and the fallback branch is the half of
// the RAG pipeline that Rule 9 is actually about. The alternative was to expose
// the floor as a per-request parameter, which would have put a knob in the
// product API purely so a test could turn it, i.e. it would have made the
// product worse to make the test easier.
const NO_CORPUS_PORT = String(Number(PORT) + 1);
const NO_CORPUS_URL = `http://localhost:${NO_CORPUS_PORT}`;

// Playwright config. Pinned to @playwright/test 1.47.2 for Node 18 (newer requires
// Node 20 — same constraint as the Next 15 pin; see memory.md). Runs the P0
// security/RLS/mastery E2E cases from tests/phase-1-roadmaps.md against a real
// dev server + the shared Supabase project, with per-user saved sessions.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // shared DB + quota → serial is safer/less flaky
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,

  // 60s, not Playwright's 30s default — and this is a measurement, not a guess.
  //
  // The suite runs against `next dev`, which compiles each route on its FIRST
  // request. Measured on this machine: an authenticated `/recall` render takes
  // ~7.6s cold and ~0.5s warm. That was comfortably inside 30s until Phase 4.5
  // added a SECOND dev server (see webServer below) — now two Next instances
  // compile the same routes in parallel, and a cold `page.goto("/recall")` can
  // exceed 30s under that contention. Six recall/ai specs failed exactly that
  // way, all with the same `page.goto: Test timeout` signature, while curl
  // against the same app returned 200 in half a second.
  //
  // Raising the budget is the honest fix because the app is not slow — the
  // FIRST COMPILE is, and only in dev. Verified outside the harness before
  // changing anything, per the standing rule in tests/README.md.
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    // 1) Auth setup — logs in users A & B once, saves their storageState.
    { name: "setup", testMatch: /auth\.setup\.ts/ },

    // 2) The real E2E suite — reuses User A's session by default. Specs that need
    //    User B (RLS cross-user) load B's state explicitly.
    {
      name: "chromium",
      testIgnore: /rag-fallback\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/.auth/userA.json",
      },
      dependencies: ["setup"],
    },

    // 3) The RAG fallback project — same suite mechanics, pointed at the server
    //    whose similarity floor nothing can clear. Only one spec runs here.
    {
      name: "chromium-no-corpus",
      testMatch: /rag-fallback\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/.auth/userA.json",
        baseURL: NO_CORPUS_URL,
      },
      dependencies: ["setup"],
    },
  ],

  // Always start our OWN server on the test port. Never reuse.
  //
  // `reuseExistingServer: true` is a false economy here: the saved startup time is
  // worth far less than the guarantee that the server under test has the env this
  // file specifies. It previously cost real API spend (see the PORT note above) and
  // separately wasted a debugging cycle when a stale server ignored two config
  // changes in a row because Next only reads env at startup.
  webServer: [
    {
    command: `npx next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      // Phase 4: the E2E suite runs against the MOCK AI provider, deliberately.
      //
      // Three reasons, in order of how much they hurt when ignored:
      //  1. A suite that depends on a third party's uptime goes red for reasons
      //     that teach you nothing — Phase 4 opened with Gemini returning 429 for
      //     days, which is what prompted this.
      //  2. The daily cap is 25 calls. A full run generates roadmaps and cards
      //     repeatedly; against a real provider the suite would exhaust the user's
      //     own cap partway through and the later tests would fail as "capped"
      //     rather than on their own merits.
      //  3. It costs money once billing is on.
      //
      // The mock still goes through the whole gateway — caps, validation, retry,
      // metering — so everything under test here is ours. The real Gemini adapter
      // (wire format, token accounting, cache hits) is verified by the manual
      // matrix instead: tests/phase-4-ai-gateway.md, suite LIVE.
      //
      // NOTE: `reuseExistingServer` means a dev server you started yourself will
      // be used AS-IS and will not pick this up. Stop it first, or expect the
      // AI-dependent cases to talk to the real provider.
      AI_PROVIDER: "mock",
      // A full run makes well over 25 dispatches. At the product default the
      // suite exhausts its own cap partway through and everything after fails as
      // "capped" instead of on its own merits — an uninformative red. The cap's
      // logic is unit-tested exactly (tests/unit/ai-gateway.test.ts) and its live
      // behaviour is checked manually (suite CAP), so nothing is lost by giving
      // the test server headroom.
      AI_DAILY_CALL_CAP: "500",
      // Phase 4.5: force every retrieval to HIT.
      //
      // The corpus holds real Gemini vectors (written by the backfill), while
      // the mock provider embeds queries lexically — two different vector
      // spaces, so every similarity between them is meaningless noise near
      // zero. A floor of -1 admits everything, which makes the grounded branch
      // reachable without a live provider. What is deliberately NOT claimed by
      // any test on this server: that the RANKING is any good. Ranking quality
      // is a human judgement against real embeddings, and it is manual suite RAG.
      RAG_MIN_SIMILARITY: "-1",
    },
    },

    // The fallback server: a floor no cosine similarity can ever reach (the
    // maximum is 1), so retrieval returns nothing on every topic. That is the
    // "niche topic, thin corpus" case from the phase spec, made deterministic.
    {
      command: `npx next dev -p ${NO_CORPUS_PORT}`,
      url: NO_CORPUS_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        AI_PROVIDER: "mock",
        AI_DAILY_CALL_CAP: "500",
        RAG_MIN_SIMILARITY: "2",
      },
    },
  ],
});
