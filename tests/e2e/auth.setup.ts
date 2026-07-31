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

setup("authenticate user A", async ({ page }) => {
  const email = process.env.QA_A_EMAIL;
  const password = process.env.QA_A_PASSWORD;
  if (!email || !password) throw new Error("Set QA_A_EMAIL / QA_A_PASSWORD in .env.test.");
  await loginAndSave(page, email, password, `${AUTH_DIR}/userA.json`);
});

setup("authenticate user B", async ({ page }) => {
  const email = process.env.QA_B_EMAIL;
  const password = process.env.QA_B_PASSWORD;
  if (!email || !password) throw new Error("Set QA_B_EMAIL / QA_B_PASSWORD in .env.test.");
  await loginAndSave(page, email, password, `${AUTH_DIR}/userB.json`);
});
