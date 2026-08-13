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
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/.auth/userA.json",
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
  webServer: {
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
    },
  },
});
