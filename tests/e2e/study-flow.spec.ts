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

  // CONTENT-01 — the Roadmap screen's per-topic content marker (Phase 5).
  //
  // Worth an E2E rather than a unit test for one reason: the marker is fed by a
  // PostgREST JSON-extraction select (`detailSource:detail->>source`) that pulls
  // ONE string out of the topic's detail jsonb instead of the whole blob. That
  // syntax is either right or the whole roadmap query errors and the page 404s —
  // and nothing but a real request against a real PostgREST can tell you which.
  // The label mapping itself is unit-tested (tests/unit/detail-source.test.ts).
  test("CONTENT-01: topics show NO CONTENT until generated, then their real source", async ({
    page,
  }) => {
    const gen = await generateRoadmap(page);
    roadmapId = gen.id;
    expect(roadmapId).not.toBeNull();

    await page.goto(`/roadmap/${roadmapId}`);

    // Week 1 is open by default. A fresh roadmap ships detail: null on every
    // topic (Phase 4 — nothing burns the daily cap just by existing), so every
    // visible chip must say so.
    const chips = page.getByTestId("topic-content-chip");
    const chipCount = await chips.count();
    expect(chipCount).toBeGreaterThan(0);
    for (let i = 0; i < chipCount; i++) {
      await expect(chips.nth(i)).toHaveAttribute("data-source", "none");
    }

    // The week header's coverage count agrees with the rows.
    await expect(page.getByTestId("week-content-count").first()).toContainText(`0/${chipCount}`);

    // Generate detail for the first topic, the same way the Topic screen does.
    await page.getByText("study →").first().click();
    await page.waitForURL(/\/topic\//);
    const topicId = new URL(page.url()).pathname.split("/").pop()!;
    const res = await page.request.post(`/api/topics/${topicId}/detail`, { data: {} });
    expect(res.ok()).toBe(true);
    const { source } = await res.json();

    // Back on the roadmap, exactly one topic now reports content, and it reports
    // the SAME source the route said it persisted — the marker must not invent a
    // grading of its own.
    await page.goto(`/roadmap/${roadmapId}`);
    await expect(page.getByTestId("topic-content-chip").first()).toHaveAttribute(
      "data-source",
      source
    );
    await expect(page.getByTestId("week-content-count").first()).toContainText(`1/${chipCount}`);
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
