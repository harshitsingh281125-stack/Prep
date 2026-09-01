import { test, expect } from "@playwright/test";
import { generateRoadmap, deleteRoadmap } from "./helpers";

// Suite 1/4/5/6 (core flow) — onboard → study → master, plus mastery persistence
// (Rule 16) and delete cascade (CC-03). Drives the real UI where the value is
// visual/stateful; uses the API to create/cleanup the roadmap fast.

test.describe("study flow: mastery + persistence", () => {
  let roadmapId: string | null = null;

  test.afterEach(async ({ page }) => {
    if (roadmapId) {
      await deleteRoadmap(page, roadmapId);
      roadmapId = null;
    }
  });

  // TP-03 / TP-05 / TP-06 — check the kill criterion → mastered, persists across
  // reload, and the roadmap's mastered count reflects it.
  test("TP-03/05/06: kill-criterion check earns mastery and persists", async ({ page }) => {
    const gen = await generateRoadmap(page);
    roadmapId = gen.id;
    expect(roadmapId).not.toBeNull();

    // Open the roadmap, go to the first topic.
    await page.goto(`/roadmap/${roadmapId}`);
    await page.getByText("study →").first().click();
    await page.waitForURL(/\/topic\//);
    const topicUrl = page.url();

    // The mastery label starts un-mastered.
    await expect(page.getByText("Check only when you can do it cold, no notes.")).toBeVisible();

    // The kill-criterion checkbox, by test id. It used to be located as "the first
    // button[aria-pressed]", which held only while it was the ONLY such button on
    // the page — Phase 5 gave the sidebar's theme toggle a correct `aria-pressed`
    // and this selector silently began matching THAT (the sidebar renders first,
    // and in the dark theme its aria-pressed is also "false", so even the guard
    // assertion below passed). The test then clicked the theme toggle and timed out
    // waiting for a topics PATCH. Structural selectors that assume uniqueness rot.
    //
    // Check it → mastery. Wait for the actual DB write (PATCH to topics) to
    // complete before reloading, so TP-05 tests real persistence rather than
    // racing the optimistic UI.
    const killCheckbox = page.getByTestId("kill-criterion");
    await expect(killCheckbox).toHaveAttribute("aria-pressed", "false");
    const masteryWrite = page.waitForResponse(
      (r) => r.url().includes("/rest/v1/topics") && r.request().method() === "PATCH"
    );
    await killCheckbox.click();
    const writeRes = await masteryWrite;
    expect(writeRes.status()).toBeGreaterThanOrEqual(200);
    expect(writeRes.status()).toBeLessThan(300);
    await expect(page.getByText("Mastered — you can defend this.")).toBeVisible();

    // TP-05: reload → still mastered (read from DB).
    await page.goto(topicUrl);
    await expect(page.getByText("Mastered — you can defend this.")).toBeVisible();

    // TP-06: back on the roadmap, mastered count reflects it (≥ 1 mastered).
    await page.goto(`/roadmap/${roadmapId}`);
    await expect(page.getByText(/[1-9]\d* of \d+ topics mastered/)).toBeVisible();
  });

  // CC-03 — deleting the roadmap removes it from Library (cascade cleans children;
  // if children lingered, RLS-scoped reads would still not resurrect the card).
  test("CC-03: delete removes the roadmap from Library", async ({ page }) => {
    const gen = await generateRoadmap(page);
    roadmapId = gen.id;
    expect(roadmapId).not.toBeNull();

    await page.goto(`/roadmap/${roadmapId}`);
    await expect(page).toHaveURL(new RegExp(`/roadmap/${roadmapId}`));

    // Delete via API (the UI delete is a manual case); then Library shouldn't 200 it.
    const status = await deleteRoadmap(page, roadmapId!);
    expect(status).toBe(200);
    const gone = await page.goto(`/roadmap/${roadmapId}`);
    expect(gone?.status()).toBe(404);
    roadmapId = null; // already deleted
  });
});
