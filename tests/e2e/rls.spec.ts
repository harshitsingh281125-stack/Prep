import { test, expect, chromium } from "@playwright/test";
import { generateRoadmap, deleteRoadmap } from "./helpers";

// Suite 3 — RLS / cross-user isolation (Rule 5). The most important security
// suite. User A creates a roadmap; User B must not be able to view or delete it.
// This spec runs as User A (default storageState) and spins up a second context
// with User B's saved session for the cross-user assertions.

test.describe("RLS cross-user isolation", () => {
  test("RLS-01/02/03: User B cannot view or delete User A's roadmap", async ({ page }) => {
    // --- User A creates a roadmap and finds one of its topic ids. ---
    const { id: roadmapId } = await generateRoadmap(page);
    expect(roadmapId).not.toBeNull();

    // Grab a topic id by visiting the roadmap page's DB via the API isn't exposed,
    // so navigate A's topic through the UI to capture the topic URL.
    await page.goto(`/roadmap/${roadmapId}`);
    // Expand week 1 (open by default) and click the first topic row.
    await page.getByText("study →").first().click();
    await page.waitForURL(/\/topic\//);
    const topicUrl = new URL(page.url()).pathname;

    // --- Open a second browser context as User B. ---
    const browser = await chromium.launch();
    const contextB = await browser.newContext({ storageState: "tests/e2e/.auth/userB.json" });
    const pageB = await contextB.newPage();
    const base = test.info().project.use.baseURL!;

    try {
      // RLS-01: B viewing A's roadmap → 404 (notFound, because RLS returns no row).
      //
      // Assert the BODY as well as the status. The status alone is the weaker half
      // of this check: Phase 5 briefly turned this 404 into a 200 by adding a
      // `loading.tsx` (a Suspense boundary makes the route STREAM, so the headers
      // flush before the page can call notFound()) — and a status-only assertion
      // cannot tell "wrong status code, correct empty page" apart from "user B is
      // reading user A's roadmap". Those are a cosmetic bug and a catastrophe, and
      // this test has to distinguish them. See memory.md (2026-08-27).
      // Content first, status second — deliberately. The content assertion is the
      // one that would catch an actual breach, and it must not sit behind a
      // weaker assertion that can abort the test before it runs.
      const roadmapResp = await pageB.goto(`${base}/roadmap/${roadmapId}`);
      await expect(pageB.getByText("Nothing here.")).toBeVisible();
      await expect(pageB.locator("main .print-week")).toHaveCount(0);
      expect(roadmapResp?.status()).toBe(404);

      // RLS-02: B viewing A's topic → 404.
      const topicResp = await pageB.goto(`${base}${topicUrl}`);
      expect(topicResp?.status()).toBe(404);

      // RLS-03: B DELETE on A's roadmap → completes but deletes nothing (RLS scope).
      const del = await pageB.request.delete(`${base}/api/roadmaps/${roadmapId}`);
      expect(del.status()).toBe(200); // idempotent; affects zero of A's rows

      // Prove A's roadmap still exists: A can still open it.
      const stillThere = await page.goto(`/roadmap/${roadmapId}`);
      expect(stillThere?.status()).toBe(200);
    } finally {
      await contextB.close();
      await browser.close();
      // Cleanup A's roadmap.
      if (roadmapId) await deleteRoadmap(page, roadmapId);
    }
  });
});
