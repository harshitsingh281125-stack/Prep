import { test as setup, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";

// Auth setup project — runs before the E2E suite. Logs the two test users in
// through the real /login form (genuine end-to-end auth) and saves each session to
// tests/e2e/.auth/ for the specs to reuse (so we don't log in per test).
//
// Note: the login form posts through a Next Server Action whose id is a build-time
// hash. If you see "Server Action … not found", the dev server has a stale .next —
// stop all dev servers, `rm -rf .next`, start one, and re-run. (Not a test bug.)
//
// Creds come from .env.test (gitignored). Create the two users once in Supabase
// (see tests/README.md), Auto-Confirmed.

const AUTH_DIR = "tests/e2e/.auth";
if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });

async function loginAndSave(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
  file: string
) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  // Successful sign-in lands in the app (Library). If creds are wrong, the form
  // shows an inline error instead of navigating — surface that clearly.
  try {
    await page.waitForURL(/\/library\/?$/, { timeout: 15_000 });
  } catch {
    const err = await page
      .locator("text=/invalid|incorrect|confirm|required/i")
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(
      err
        ? `Login failed for ${email}: "${err.trim()}" (check .env.test creds / Auto-Confirm).`
        : `Login for ${email} did not reach /library. If the screenshot shows "Server Action not found", the dev server .next is stale — restart it clean.`
    );
  }

  await expect(page).not.toHaveURL(/\/login/);
  await page.context().storageState({ path: file });
}

/**
 * Delete every roadmap this test user still owns.
 *
 * WHY THIS RUNS BEFORE EVERY SUITE. Specs clean up their own roadmaps in
 * `afterEach`, which is correct — right up until a run does not finish. An
 * interrupted or crashed run leaves rows behind, the next run starts at the
 * 3-roadmap quota (Rule 18), and `generateRoadmap` returns **403**.
 *
 * That failure does not look like a quota failure. It surfaces as specs timing
 * out waiting for cards or dashboard rows that were never created — which is how
 * a leftover-rows problem once presented as "the app got 6x slower", with a
 * 20-minute run and seven red tests across three spec files. It has now bitten
 * this project three times (Phase 2, and twice in Phase 4.5; see memory.md).
 *
 * Per-test cleanup handles the happy path; this handles the aborted one. The two
 * QA accounts are dedicated to the suite (tests/README.md), so clearing their
 * roadmaps at setup is safe — and it makes an interrupted run self-healing
 * instead of something that silently poisons the next one.
 *
 * Reads through PostgREST under the user's own session, so RLS still scopes it to
 * that user: this cannot touch anyone else's data even by mistake.
 */
async function clearRoadmaps(page: import("@playwright/test").Page, label: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return;

  const cookies = await page.context().cookies();
  const parts = cookies
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => c.value);
  if (parts.length === 0) return;

  let raw = decodeURIComponent(parts.join(""));
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64").toString("utf8");
  let token = "";
  try {
    token = JSON.parse(raw)?.access_token ?? "";
  } catch {
    return;
  }
  if (!token) return;

  const headers = { apikey: key, Authorization: `Bearer ${token}` };
  const listed = await page.request.get(`${url}/rest/v1/roadmaps?select=id`, { headers });
  if (!listed.ok()) return;

  const rows = (await listed.json()) as { id: string }[];
  if (rows.length === 0) return;

  // Deleting a roadmap cascades its weeks, topics, notes, cards and sessions.
  await page.request.delete(`${url}/rest/v1/roadmaps?id=not.is.null`, { headers });
  console.log(`[setup] cleared ${rows.length} leftover roadmap(s) for ${label}`);
}

setup("authenticate user A", async ({ page }) => {
  const email = process.env.QA_A_EMAIL;
  const password = process.env.QA_A_PASSWORD;
  if (!email || !password) throw new Error("Set QA_A_EMAIL / QA_A_PASSWORD in .env.test.");
  await loginAndSave(page, email, password, `${AUTH_DIR}/userA.json`);
  await clearRoadmaps(page, "user A");
});

setup("authenticate user B", async ({ page }) => {
  const email = process.env.QA_B_EMAIL;
  const password = process.env.QA_B_PASSWORD;
  if (!email || !password) throw new Error("Set QA_B_EMAIL / QA_B_PASSWORD in .env.test.");
  await loginAndSave(page, email, password, `${AUTH_DIR}/userB.json`);
  await clearRoadmaps(page, "user B");
});
