import { test, expect } from "@playwright/test";
import { generateRoadmap, deleteRoadmap } from "./helpers";

// Phase 3 E2E — the P0 cases for study-session logging + the Progress dashboard
// that genuinely need a real session + DB: auth gating, input validation at the
// trust boundary, cross-roadmap/cross-user integrity (RLS, Rule 5), and the core
// stateful flow (log hours → every derived number on the screen moves).
//
// The pace/status/blocker arithmetic is unit-tested in tests/unit/progress.test.ts
// — this file deliberately does NOT re-test the math, only that the real route
// and the real screen are wired to it.
//
// The Phase 1/2 harness lessons are baked in (see memory.md):
//  1. `request.newContext()` INHERITS the project's storageState — an "anonymous"
//     request is only anonymous with an explicitly empty storageState AND
//     `maxRedirects: 0` (otherwise Playwright follows the gate's 307 to a 200).
//  2. Optimistic DOM ≠ persisted write. Wait on the network response.
//  3. A fixture that fails must say WHY, loudly — see seedRoadmap() below.

const created: string[] = [];

test.afterEach(async ({ page }) => {
  // Deleting the roadmap cascades its study_sessions away (roadmap_id is
  // `on delete cascade`), so each test starts from a clean dashboard.
  for (const id of created.splice(0)) await deleteRoadmap(page, id);
});

/**
 * Generate a roadmap and FAIL LOUDLY if the quota blocked it.
 *
 * Same guard as recall.spec.ts. Without it a 403 (leftover roadmaps from an
 * aborted run putting User A at the 3-roadmap cap) yields an empty dashboard,
 * and every downstream assertion fails with a misleading "0 hours" instead of
 * the real cause. This exact misdiagnosis cost real time in Phase 2 — memory.md.
 */
async function seedRoadmap(page: import("@playwright/test").Page): Promise<string> {
  const { id, status } = await generateRoadmap(page);
  expect(
    status,
    status === 403
      ? "Quota full — User A has leftover roadmaps from a previous run. Delete them (see tests/README.md) and re-run."
      : `Roadmap generation failed with ${status}`
  ).toBe(201);
  expect(id).toBeTruthy();
  created.push(id!);
  return id!;
}

/**
 * Grab a topic id belonging to the currently-reported roadmap, via the Progress
 * form's topic select.
 *
 * Note the selector: `option[value!=""]` is NOT valid CSS (there is no `!=`
 * attribute operator) and Playwright throws a SyntaxError on it rather than
 * simply matching nothing. Use `:not([value=""])` to skip the placeholder
 * "Unattributed" option.
 */
async function firstTopicId(
  page: import("@playwright/test").Page
): Promise<string> {
  await page.goto("/progress");
  const option = page
    .locator('select[aria-label="Topic studied"] option:not([value=""])')
    .first();
  const value = await option.getAttribute("value");
  expect(value, "expected the roadmap to have at least one topic").toBeTruthy();
  return value!;
}

test.describe("Sessions — auth + input validation", () => {
  // SE-01 — Rule 1: the log route must reject an unauthenticated caller.
  test("anonymous session log is blocked", async ({ playwright }) => {
    const anon = await playwright.request.newContext({
      baseURL: test.info().project.use.baseURL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      const res = await anon.post("/api/sessions", {
        data: { roadmapId: "00000000-0000-0000-0000-000000000000", minutes: 60 },
        maxRedirects: 0,
        headers: { "Content-Type": "application/json" },
      });
      const status = res.status();
      expect([302, 307, 401]).toContain(status);
      if (status === 302 || status === 307) {
        expect(res.headers()["location"]).toContain("/login");
      }
    } finally {
      await anon.dispose();
    }
  });

  // SE-02 — the boundary values on `minutes`. The route must reject anything the
  // column's CHECK constraint would reject, with a 400 rather than a 500 — a
  // constraint violation surfacing as a 500 means the route isn't validating.
  test("rejects out-of-range and non-integer minutes", async ({ page }) => {
    const roadmapId = await seedRoadmap(page);

    const bad = [0, -30, 1441, 45.5, NaN, "60", null, undefined, Infinity];
    for (const minutes of bad) {
      const res = await page.request.post("/api/sessions", {
        data: { roadmapId, minutes },
      });
      expect(res.status(), `minutes=${JSON.stringify(minutes)} must be rejected`).toBe(400);
    }
  });

  // SE-03 — the inclusive boundaries must be ACCEPTED. A validator that's too
  // strict is as wrong as one that's too loose.
  test("accepts the exact minute boundaries 1 and 1440", async ({ page }) => {
    const roadmapId = await seedRoadmap(page);

    for (const minutes of [1, 1440]) {
      const res = await page.request.post("/api/sessions", { data: { roadmapId, minutes } });
      expect(res.status(), `minutes=${minutes} must be accepted`).toBe(201);
    }
  });

  // SE-04 — a missing/!string roadmapId is a 400, not a 500.
  test("rejects a missing roadmapId", async ({ page }) => {
    for (const roadmapId of [undefined, null, 42, ""]) {
      const res = await page.request.post("/api/sessions", { data: { roadmapId, minutes: 60 } });
      expect(res.status(), `roadmapId=${JSON.stringify(roadmapId)} must be rejected`).toBe(400);
    }
  });

  // SE-05 — a well-formed but unknown roadmap id must 404, not 500.
  test("unknown roadmap id returns 404", async ({ page }) => {
    const res = await page.request.post("/api/sessions", {
      data: { roadmapId: "00000000-0000-0000-0000-000000000000", minutes: 60 },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe("Sessions — the logging round-trip", () => {
  // SE-06 — the core stateful flow. Logging time must move the real numbers on
  // the dashboard, not just echo back a 201.
  test("logging hours updates the dashboard's derived stats", async ({ page }) => {
    const roadmapId = await seedRoadmap(page);

    await page.goto("/progress");
    await expect(page.getByTestId("stat-hours-value")).toHaveText("0");

    // 90 minutes = 1.5h, attributed to a real topic.
    const topicId = await firstTopicId(page);
    const res = await page.request.post("/api/sessions", {
      data: { roadmapId, topicId, minutes: 90 },
    });
    expect(res.status()).toBe(201);

    await page.goto("/progress");
    await expect(page.getByTestId("stat-hours-value")).toHaveText("1.5");
  });

  // SE-07 — the form path (not just the API path): submitting the UI must
  // persist and re-render. Waits on the response, never the optimistic DOM.
  test("the log-hours form persists and refreshes the screen", async ({ page }) => {
    await seedRoadmap(page);

    await page.goto("/progress");
    await page.getByLabel("Minutes studied").fill("120");

    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/sessions") && r.request().method() === "POST"
      ),
      page.getByRole("button", { name: /log time/i }).click(),
    ]);
    expect(res.status()).toBe(201);

    // 120 minutes = 2h, and the server component re-ran (router.refresh()).
    await expect(page.getByTestId("stat-hours-value")).toHaveText("2");

    // And it survives a hard reload — proof it's in the DB, not React state.
    await page.goto("/progress");
    await expect(page.getByTestId("stat-hours-value")).toHaveText("2");
  });

  // SE-08 — unattributed hours count toward the total but fill no week bar. This
  // is the deliberate consequence of attributing by topic; assert it rather than
  // letting it look like a bug later.
  test("an unattributed session counts in hours but not in any week bar", async ({ page }) => {
    const roadmapId = await seedRoadmap(page);

    const res = await page.request.post("/api/sessions", {
      data: { roadmapId, topicId: null, minutes: 60 },
    });
    expect(res.status()).toBe(201);

    await page.goto("/progress");
    await expect(page.getByTestId("stat-hours-value")).toHaveText("1");
    // No bar has a logged height, so no bar carries a "1h logged" tooltip.
    await expect(page.locator('[title="1h logged"]')).toHaveCount(0);
  });
});

test.describe("Sessions — integrity + RLS (Rule 5)", () => {
  // SE-09 — the cross-roadmap check. A user's OWN topic from a DIFFERENT roadmap
  // must be rejected: RLS says "your row" but cannot say "the right roadmap's
  // row", and accepting it would silently corrupt roadmap A's week bars.
  test("cannot log a topic from a different roadmap", async ({ page }) => {
    const roadmapA = await seedRoadmap(page);
    await page.goto("/progress");

    // /progress reports on the most recent roadmap, so A's topics are listed now.
    const topicFromA = await firstTopicId(page);

    const roadmapB = await seedRoadmap(page);
    const res = await page.request.post("/api/sessions", {
      data: { roadmapId: roadmapB, topicId: topicFromA, minutes: 60 },
    });
    expect(res.status(), "a topic from roadmap A must not attach to roadmap B").toBe(404);
    expect(roadmapA).toBeTruthy();
  });

  // SE-10 — User B must not be able to log time against User A's roadmap. Under
  // RLS the row is invisible to B, so the route 404s.
  test("user B cannot log a session against user A's roadmap", async ({ page, playwright }) => {
    const roadmapId = await seedRoadmap(page); // owned by User A

    const userB = await playwright.request.newContext({
      baseURL: test.info().project.use.baseURL,
      storageState: "tests/e2e/.auth/userB.json",
    });
    const res = await userB.post("/api/sessions", { data: { roadmapId, minutes: 60 } });
    expect(res.status()).toBe(404);
    await userB.dispose();

    // And A's dashboard is untouched.
    await page.goto("/progress");
    await expect(page.getByTestId("stat-hours-value")).toHaveText("0");
  });

  // SE-11 — the client must not be able to backdate a session. logged_at is the
  // DB's now(); a supplied timestamp is ignored, so a user can't retroactively
  // manufacture a history that makes them look on-pace.
  test("a client-supplied logged_at is ignored", async ({ page }) => {
    const roadmapId = await seedRoadmap(page);

    const res = await page.request.post("/api/sessions", {
      data: {
        roadmapId,
        minutes: 60,
        logged_at: "2020-01-01T00:00:00.000Z",
        loggedAt: "2020-01-01T00:00:00.000Z",
      },
    });
    expect(res.status()).toBe(201);

    const body = (await res.json()) as { loggedAt: string };
    expect(new Date(body.loggedAt).getUTCFullYear()).toBeGreaterThanOrEqual(2026);
  });
});

test.describe("Progress — screen states", () => {
  // SE-12 — a brand-new roadmap must NOT be shown as behind pace. This is the
  // whole point of flooring elapsed time to whole weeks; a banner on day one
  // would be both wrong and demoralising.
  test("a fresh roadmap shows no behind-pace banner", async ({ page }) => {
    await seedRoadmap(page);

    await page.goto("/progress");
    await expect(page.getByTestId("pace-banner")).toHaveCount(0);
    await expect(page.getByTestId("stat-pace-value")).toHaveText("—");
  });

  // SE-13 — with no reviews, the accuracy chart must show its empty state rather
  // than a misleading flat line at zero.
  test("accuracy shows an empty state before any reviews exist", async ({ page }) => {
    await seedRoadmap(page);

    await page.goto("/progress");
    await expect(page.getByTestId("stat-accuracy-value")).toHaveText("—");
    await expect(page.getByText(/Not enough reviews yet/)).toBeVisible();
  });
});
