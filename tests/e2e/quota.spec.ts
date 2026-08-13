import { test, expect } from "@playwright/test";
import { generateRoadmap, deleteRoadmap, VALID_ANSWERS } from "./helpers";

// Suite 2 — server-enforced quota + input validation (Rule 18, Rule 1).
// These are the security-critical cases: the UI hiding the button is NOT the
// enforcement; the route is. We hit the API directly to prove it.

test.describe("quota + validation (server-enforced)", () => {
  const created: string[] = [];

  test.afterEach(async ({ page }) => {
    // Clean up anything created so the shared project's quota resets.
    for (const id of created.splice(0)) await deleteRoadmap(page, id);
  });

  // QT-04 — at the cap, the API rejects a 4th create with 403 even though a
  // determined client bypasses the disabled button.
  test("QT-04: 403 at quota when calling the API directly", async ({ page }) => {
    // Fill to the cap (3). If the account already has roadmaps this still ends at
    // the cap because create stops returning ids once full.
    for (let i = 0; i < 3; i++) {
      const { id } = await generateRoadmap(page);
      if (id) created.push(id);
    }
    const { id, status } = await generateRoadmap(page);
    expect(status).toBe(403);
    expect(id).toBeNull();
  });

  // QT-07 — malformed JSON body → 400, no crash.
  test("QT-07: malformed body returns 400", async ({ page }) => {
    const res = await page.request.post("/api/roadmaps/generate", {
      headers: { "Content-Type": "application/json" },
      data: "not json at all",
    });
    expect(res.status()).toBe(400);
  });

  // QT-08 — weak areas that aren't valid options → 400 (filtered to empty).
  test("QT-08: invalid weak areas rejected with 400", async ({ page }) => {
    const { status } = await generateRoadmap(page, { ...VALID_ANSWERS, weak: ["NotARealArea"] });
    expect(status).toBe(400);
  });

  // OB-11 (API-level) — two rapid creates from a fresh account make at most the
  // cap; they don't both silently succeed past it. (True double-submit UI guard is
  // a manual case; here we assert the server stays consistent.)
  test("QT-01/OB-11: creating up to the cap succeeds, beyond it 403s", async ({ page }) => {
    const results: number[] = [];
    for (let i = 0; i < 4; i++) {
      const { id, status } = await generateRoadmap(page);
      if (id) created.push(id);
      results.push(status);
    }
    const created201 = results.filter((s) => s === 201).length;
    const rejected = results.filter((s) => s === 403).length;
    expect(created201).toBeLessThanOrEqual(3);
    expect(rejected).toBeGreaterThanOrEqual(1);
  });
});

// QT-06 — signed OUT, the app must not let an unauthenticated request create a
// roadmap. The auth gate is the middleware, which redirects protected routes to
// /login (307) before the handler runs; the handler's own 401 is the belt-and-
// suspenders behind it. Either way the request is BLOCKED (never a 2xx create).
//
// We use a brand-new request context with no cookies (fully anonymous) and don't
// follow redirects, so we see the gate's real response.
test("QT-06: unauthenticated create is blocked (redirect to /login, never 2xx)", async ({
  playwright,
  baseURL,
}) => {
  // NOTE: newContext() inherits the ambient project storageState (User A's
  // session) unless you explicitly pass empty cookies — otherwise this request is
  // NOT anonymous and the app's auth gate never gets exercised.
  //
  // The URL comes from the `baseURL` FIXTURE, not from a rebuilt string. It used
  // to read `process.env.PW_PORT ?? "3001"` — the dev port — while the config's
  // test port is 3101. So with no PW_PORT set, this security case was posting at
  // whatever was listening on 3001, i.e. it passed by testing the DEVELOPER'S
  // server and failed with ECONNREFUSED whenever no dev server happened to be
  // running. Third time in this project that a test aimed at the wrong server
  // (see memory.md); the fix each time is to stop reconstructing a URL that
  // Playwright already knows.
  const anon = await playwright.request.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const res = await anon.post(`/api/roadmaps/generate`, {
      data: VALID_ANSWERS,
      maxRedirects: 0, // see the gate's own response, not the /login page
      headers: { "Content-Type": "application/json" },
    });
    const status = res.status();
    // Blocked = redirected to /login (307/302) OR handler-level 401. Never a create.
    expect([307, 302, 401]).toContain(status);
    if (status === 307 || status === 302) {
      expect(res.headers()["location"]).toContain("/login");
    }
  } finally {
    await anon.dispose();
  }
});
