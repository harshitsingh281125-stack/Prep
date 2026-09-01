import { test, expect, chromium } from "@playwright/test";
import { assertMockProvider, generateRoadmap, deleteRoadmap, VALID_ANSWERS } from "./helpers";

// Suite: the print/export view (Phase 5) — /roadmap/[id]/print.
//
// What only an E2E can prove here: that the route is auth-gated by the SAME
// middleware as everything else, that RLS makes a stranger's id a 404 on this
// route too (a new surface onto the roadmap tree is a new place to leak it), and
// that the page renders outside the app shell. The bucketing arithmetic behind
// the recall schedule is pure and lives in tests/unit/print-schedule.test.ts.

test.describe("print / export view", () => {
  const created: string[] = [];

  test.beforeAll(async ({ browser }) => {
    // Roadmap creation goes through the AI gateway, so refuse to run against a
    // real provider (see helpers.ts — this cost 26 real calls once).
    const page = await browser.newPage();
    await assertMockProvider(page);
    await page.close();
  });

  test.afterEach(async ({ page }) => {
    while (created.length) {
      const id = created.pop()!;
      await deleteRoadmap(page, id);
    }
  });

  test("PRINT-01: the owner gets a print page carrying the plan's real content", async ({ page }) => {
    const { id } = await generateRoadmap(page);
    expect(id).not.toBeNull();
    created.push(id!);

    const resp = await page.goto(`/roadmap/${id}/print`);
    expect(resp?.status()).toBe(200);

    // The plan itself: every week, its kill criterion, and every topic name.
    await expect(page.locator(".print-week")).toHaveCount(3); // "3 weeks" in VALID_ANSWERS
    expect(await page.locator(".print-kill").count()).toBe(3);
    await expect(page.getByText("Kill criterion").first()).toBeVisible();

    // The four headline tiles and both footer sections.
    await expect(page.locator(".print-stat")).toHaveCount(4);
    await expect(page.getByText("Recall schedule")).toBeVisible();
    await expect(page.getByText("What's blocking you")).toBeVisible();

    // All four schedule buckets print, including the empty ones — on paper a
    // "0 · Next 7 days" row is information, not clutter (Rule 19).
    for (const label of ["Overdue", "Due today", "Next 7 days", "Later"]) {
      await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
    }
  });

  test("PRINT-02: the print page renders OUTSIDE the app shell", async ({ page }) => {
    const { id } = await generateRoadmap(page);
    created.push(id!);

    await page.goto(`/roadmap/${id}/print`);

    // The whole reason for the (print) route group: no sidebar, no nav, no
    // 100vh-overflow-hidden frame that would clip a multi-page document.
    await expect(page.locator(".app-sidebar")).toHaveCount(0);
    await expect(page.locator(".app-shell")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "My roadmaps" })).toHaveCount(0);

    // But it IS the print document, with its own light-only root.
    await expect(page.locator(".print-root")).toHaveCount(1);
    await expect(page.locator(".print-sheet")).toHaveCount(1);
  });

  test("PRINT-03: the Export link on the roadmap screen reaches it", async ({ page }) => {
    const { id } = await generateRoadmap(page);
    created.push(id!);

    await page.goto(`/roadmap/${id}`);
    await page.getByRole("link", { name: "Export / Print" }).click();
    await page.waitForURL(new RegExp(`/roadmap/${id}/print$`));
    await expect(page.locator(".print-sheet")).toBeVisible();

    // And back again — the toolbar link is the way out.
    await page.getByRole("link", { name: "← Back to roadmap" }).click();
    await page.waitForURL(new RegExp(`/roadmap/${id}$`));
  });

  test("PRINT-04: another user's roadmap prints as a 404, not somebody's plan", async ({ page }) => {
    const { id } = await generateRoadmap(page);
    created.push(id!);

    const browser = await chromium.launch();
    const contextB = await browser.newContext({ storageState: "tests/e2e/.auth/userB.json" });
    const pageB = await contextB.newPage();
    const base = test.info().project.use.baseURL!;

    try {
      const resp = await pageB.goto(`${base}/roadmap/${id}/print`);
      expect(resp?.status()).toBe(404);
      // And nothing of A's plan leaked into the 404 body.
      await expect(pageB.locator(".print-week")).toHaveCount(0);
    } finally {
      await contextB.close();
      await browser.close();
    }
  });

  test("PRINT-05: an anonymous request is bounced by the middleware, not served", async ({
    page,
    browser,
  }) => {
    const { id } = await generateRoadmap(page);
    created.push(id!);

    // storageState must be cleared explicitly — newContext() INHERITS the
    // project's session otherwise, and this "anonymous" check would silently be
    // an authenticated one (tests/README.md gotcha 1).
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      // maxRedirects: 0, or Playwright chases the gate's redirect to /login,
      // renders a 200, and a blocked request looks like a success (gotcha 2).
      const resp = await anon.request.get(`/roadmap/${id}/print`, { maxRedirects: 0 });
      expect([302, 307]).toContain(resp.status());
      expect(resp.headers()["location"]).toContain("/login");
    } finally {
      await anon.close();
    }
  });

  test("PRINT-06: a roadmap id that doesn't exist 404s", async ({ page }) => {
    const resp = await page.goto("/roadmap/00000000-0000-0000-0000-000000000000/print");
    expect(resp?.status()).toBe(404);
  });
});

// The Phase 5 role-scope change. The mismatch NOTICE itself needs the seeded
// fallback to have run, which needs AI_MOCK_MODE=error and a server restart —
// that is manual suite ROLE in tests/phase-5-print-polish.md, the same treatment
// the Phase 4 FALL cases get. What is automatable, and worth automating, is that
// the new role generates at all and that the provenance write succeeds.
test.describe("backend role (Phase 5)", () => {
  const created: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await assertMockProvider(page);
    await page.close();
  });

  test.afterEach(async ({ page }) => {
    while (created.length) await deleteRoadmap(page, created.pop()!);
  });

  test("ROLE-01: a backend answer set generates, and persists its provenance", async ({ page }) => {
    const res = await page.request.post("/api/roadmaps/generate", {
      data: {
        ...VALID_ANSWERS,
        role: "SDE-2 · Backend",
        weak: ["Databases & SQL", "Distributed systems & scale"],
      },
    });

    // A 201 is itself the proof that `generated_from` was written: the column is
    // part of the INSERT, so if migration 0012 were missing (or the value failed
    // its CHECK) supabase-js would error and this route would return 500.
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.source).toBe("ai");
    created.push(body.id);

    // The mock provider succeeds, so this is a genuinely generated backend plan
    // and must NOT be labelled a template mismatch.
    await page.goto(`/roadmap/${body.id}`);
    await expect(page.getByTestId("template-mismatch")).toHaveCount(0);
  });

  test("ROLE-02: backend weak areas are accepted; frontend ones are rejected for that role", async ({
    page,
  }) => {
    // The route validates weak areas against the list for the ANSWERED role, so
    // posting frontend areas under the backend role is a 400 — the same
    // server-side check that stops a hand-rolled POST from smuggling options the
    // wizard would never have offered.
    const bad = await page.request.post("/api/roadmaps/generate", {
      data: { ...VALID_ANSWERS, role: "SDE-2 · Backend", weak: ["React internals"] },
    });
    expect(bad.status()).toBe(400);

    const good = await page.request.post("/api/roadmaps/generate", {
      data: { ...VALID_ANSWERS, role: "SDE-2 · Backend", weak: ["Caching & messaging"] },
    });
    expect(good.status()).toBe(201);
    created.push((await good.json()).id);
  });
});
