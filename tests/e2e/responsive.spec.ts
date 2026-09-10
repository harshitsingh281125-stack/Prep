import { test, expect } from "@playwright/test";
import { generateRoadmap, deleteRoadmap, assertMockProvider } from "./helpers";

/**
 * The ≤860px responsive shell (Phase 5).
 *
 * WHY THIS EXISTS: "mobile-reasonable layout" is a phase deliverable, and the
 * manual RESP suite is the kind that gets skipped (it needs a phone). What a
 * browser CAN decide mechanically is the part that is either true or false —
 * did the shell actually stack, and does the page overflow sideways — so that
 * part should not depend on anyone remembering to look.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM: that the result is pleasant to use on a
 * real phone. Tap-target comfort, whether the nav strip's horizontal scroll is
 * discoverable, and how this behaves against the mobile URL bar's viewport
 * collapse are judgement calls and stay manual (suite RESP).
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

/** Horizontal overflow, measured the only way that matters: on the document. */
async function pageScrollsSideways(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() => {
    const d = document.documentElement;
    // 1px of tolerance for sub-pixel layout rounding.
    return d.scrollWidth > d.clientWidth + 1;
  });
}

test.describe("responsive shell", () => {
  let roadmapId: string | null = null;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "tests/e2e/.auth/userA.json" });
    try {
      await assertMockProvider(await ctx.newPage());
    } finally {
      await ctx.close();
    }
  });

  test.afterEach(async ({ page }) => {
    if (roadmapId) {
      await deleteRoadmap(page, roadmapId);
      roadmapId = null;
    }
  });

  test("RESP-A: below the breakpoint the sidebar stacks into a top bar", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/library");

    const shell = page.locator(".app-shell");
    const sidebar = page.locator(".app-sidebar");

    // The shell stops being a horizontal split...
    await expect(shell).toHaveCSS("flex-direction", "column");
    // ...and the sidebar stops being a fixed 244px column.
    await expect(sidebar).toHaveCSS("flex-direction", "row");
    const width = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(300); // full-width bar, not the 244px rail
  });

  test("RESP-B: above the breakpoint the desktop shell is untouched", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/library");

    await expect(page.locator(".app-shell")).toHaveCSS("flex-direction", "row");
    const width = await page
      .locator(".app-sidebar")
      .evaluate((el) => el.getBoundingClientRect().width);
    // The design's fixed rail (design.md §4). If the breakpoint ever leaks
    // upward, this is what catches it.
    expect(Math.round(width)).toBe(244);
  });

  test("RESP-C: no screen scrolls sideways on a phone viewport", async ({ page }) => {
    // The single most common responsive defect, and the one users notice first.
    // Covers the hand-rolled SVG charts and the 4-up stat grids, which are the
    // two things on these screens that cannot reflow on their own.
    await page.setViewportSize(PHONE);

    const gen = await generateRoadmap(page);
    roadmapId = gen.id;
    expect(roadmapId).not.toBeNull();

    for (const path of [
      "/library",
      "/progress",
      "/recall",
      "/usage",
      "/onboarding",
      `/roadmap/${roadmapId}`,
    ]) {
      await page.goto(path);
      expect(await pageScrollsSideways(page), `${path} overflows horizontally`).toBe(false);
    }

    // The Topic screen is the other `1fr 300px` two-pane layout, and its id is
    // only reachable by walking the roadmap.
    await page.goto(`/roadmap/${roadmapId}`);
    await page.getByText("study →").first().click();
    await page.waitForURL(/\/topic\//);
    expect(await pageScrollsSideways(page), "topic screen overflows horizontally").toBe(false);
  });

  test("RESP-E: the two-pane screens stack instead of keeping a 300px rail", async ({ page }) => {
    // Topic and Onboarding are `1fr 300px`. The rail does not shrink, so if this
    // regresses the page overflows rather than merely looking cramped — which is
    // exactly how /usage's 4-up grid was found to be broken (memory.md).
    await page.setViewportSize(PHONE);
    await page.goto("/onboarding");
    await expect(page.locator(".grid-side").first()).toHaveCSS(
      "grid-template-columns",
      /^\d+(\.\d+)?px$/
    );
  });

  test("RESP-D: the print view doesn't overflow on a phone either", async ({ page }) => {
    await page.setViewportSize(PHONE);
    const gen = await generateRoadmap(page);
    roadmapId = gen.id;

    await page.goto(`/roadmap/${roadmapId}/print`);
    // The print sheet has a fixed 7.1in max-width, so it is the likeliest thing
    // in the app to push the page sideways on a narrow screen.
    expect(await pageScrollsSideways(page), "print view overflows horizontally").toBe(false);
  });
});
