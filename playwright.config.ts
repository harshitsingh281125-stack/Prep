import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Load test-user creds + Supabase keys from .env.test (gitignored — never commit
// test creds). Falls back to .env.local for the Supabase URL/anon key if present.
loadEnv({ path: ".env.test" });
loadEnv({ path: ".env.local" });

const PORT = process.env.PW_PORT ?? "3001";
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

  // Reuse an already-running dev server if there is one; otherwise start it.
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
