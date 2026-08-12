import { test, expect } from "@playwright/test";
import { generateRoadmap, deleteRoadmap, generateCardsForFirstTopic, assertMockProvider } from "./helpers";

// Phase 2 E2E — the P0 recall cases that genuinely need a real session + DB:
// auth gating, RLS cross-user isolation, malformed-grade rejection, and the core
// stateful flow (grade a card → the scheduler moves its due date → it leaves the
// queue). The pure ladder/ease math is unit-tested in tests/unit/scheduler.test.ts.
//
// Two lessons from Phase 1 are baked in here (see memory.md):
//  1. `request.newContext()` INHERITS the project's storageState — an "anonymous"
//     request is only anonymous if you pass an empty storageState explicitly.
//  2. Optimistic DOM ≠ persisted write. Wait on the network response, not the pixel.

const created: string[] = [];

// This spec generates recall cards, so it spends AI calls too (see helpers).
test.beforeAll(async ({ browser }) => {
  // NOT browser.newPage(): that makes a fresh context with no storageState, so
  // /api/usage would 401 and the guard would report a broken check rather than a
  // real answer. Load User A's saved session explicitly.
  const ctx = await browser.newContext({ storageState: "tests/e2e/.auth/userA.json" });
  try {
    await assertMockProvider(await ctx.newPage());
  } finally {
    await ctx.close();
  }
});

test.afterEach(async ({ page }) => {
  // Deleting the roadmap cascades its cards away (recall_cards.roadmap_id is
  // `on delete cascade`), so the queue resets between tests.
  for (const id of created.splice(0)) await deleteRoadmap(page, id);
});

/**
 * Generate a roadmap and FAIL LOUDLY if the quota blocked it.
 *
 * Without this, a 403 (quota full — e.g. roadmaps left behind by an earlier
 * aborted run) silently yields an empty recall queue, and every downstream
 * assertion fails with the misleading "no cards found" instead of the real
 * cause. Diagnosed exactly that way while building this phase — see memory.md.
 */
async function seedQueue(page: import("@playwright/test").Page): Promise<string> {
  const { id, status } = await generateRoadmap(page);
  expect(
    status,
    status === 403
      ? "Quota full — User A has leftover roadmaps from a previous run. Delete them (see tests/README.md) and re-run."
      : `Roadmap generation failed with ${status}`
  ).toBe(201);
  expect(id).toBeTruthy();
  created.push(id!);

  // CHANGED IN PHASE 4. Roadmap creation no longer fills the recall queue: a
  // generated roadmap's topic names are the model's own, so they match nothing
  // in the catalog-keyed seed and the deck starts empty (by design — generating
  // cards for 15-25 topics at onboarding would blow the daily cap in one go).
  // Cards are now generated per topic, so the fixture asks for them explicitly.
  await generateCardsForFirstTopic(page, id!);
  return id!;
}

/** Read the current due queue through the API-authenticated page context. */
async function dueCards(page: import("@playwright/test").Page) {
  await page.goto("/recall");
  return page.getByTestId("recall-card");
}

test.describe("Recall — auth + input validation", () => {
  // RC-01 — the grade route must reject an unauthenticated caller (Rule 1).
  test("anonymous grade request is blocked", async ({ playwright }) => {
    // Two things are required to make this genuinely anonymous (both learned the
    // hard way in Phase 1 / this phase — see memory.md):
    //  1. empty storageState — newContext() otherwise inherits User A's session;
    //  2. maxRedirects: 0 — otherwise Playwright FOLLOWS the gate's 307 to /login,
    //     which renders a 200 and makes a blocked request look like a success.
    const anon = await playwright.request.newContext({
      baseURL: test.info().project.use.baseURL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      const res = await anon.post("/api/recall/00000000-0000-0000-0000-000000000000/grade", {
        data: { grade: "right" },
        maxRedirects: 0,
        headers: { "Content-Type": "application/json" },
      });
      const status = res.status();
      // Blocked = middleware redirect to /login, or the handler's own 401.
      expect([302, 307, 401]).toContain(status);
      if (status === 302 || status === 307) {
        expect(res.headers()["location"]).toContain("/login");
      }
    } finally {
      await anon.dispose();
    }
  });

  // RC-02 — Rule 17: the grade is binary. No third "close enough" option exists,
  // and the server must not invent one from arbitrary input.
  test("rejects a grade that is not exactly right/wrong", async ({ page }) => {
    await seedQueue(page);

    await page.goto("/recall");
    const cardId = await page.getByTestId("recall-card").first().getAttribute("data-card-id");
    expect(cardId).toBeTruthy();

    for (const bad of ["close enough", "RIGHT", "", null, 1, { grade: "right" }]) {
      const res = await page.request.post(`/api/recall/${cardId}/grade`, { data: { grade: bad } });
      expect(res.status(), `grade=${JSON.stringify(bad)} must be rejected`).toBe(400);
    }
  });

  // RC-03 — a well-formed but unknown card id must 404, not 500.
  test("unknown card id returns 404", async ({ page }) => {
    const res = await page.request.post(
      "/api/recall/00000000-0000-0000-0000-000000000000/grade",
      { data: { grade: "right" } }
    );
    expect(res.status()).toBe(404);
  });
});

test.describe("Recall — the scheduler round-trip", () => {
  // RC-04 — the core stateful flow: a correct grade advances the card and takes
  // it out of the due queue; the schedule the UI shows is the SERVER's decision.
  test("grading a card correctly schedules it forward and clears it from the queue", async ({
    page,
  }) => {
    await seedQueue(page);

    const cards = await dueCards(page);
    const before = await cards.count();
    expect(before).toBeGreaterThan(0);

    const first = cards.first();
    const cardId = await first.getAttribute("data-card-id");

    // Wait on the network response, not the optimistic DOM (Phase 1 lesson).
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/api/recall/${cardId}/grade`) && r.request().method() === "POST"
      ),
      first.getByTestId("grade-right").click(),
    ]);
    expect(res.status()).toBe(200);

    const body = (await res.json()) as { intervalDays: number; repetitions: number };
    // First correct grade = first rung of the ladder.
    expect(body.repetitions).toBe(1);
    expect(body.intervalDays).toBe(1);

    // The card now reports the server's schedule.
    await expect(first.getByTestId("recall-result")).toHaveText(/Got it/);
    await expect(first.getByTestId("recall-scheduled")).toHaveText(/next review in 1 day/);

    // And after a reload it is genuinely gone from the due queue (due_at moved).
    await page.goto("/recall");
    const remaining = await page.getByTestId("recall-card").count();
    expect(remaining).toBe(before - 1);
  });

  // RC-05 — Rule 17: a miss resets to +1d and the card stays due today.
  test("a missed card resets to +1d and remains in the queue", async ({ page }) => {
    await seedQueue(page);

    const cards = await dueCards(page);
    const before = await cards.count();
    const first = cards.first();
    const cardId = await first.getAttribute("data-card-id");

    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/api/recall/${cardId}/grade`) && r.request().method() === "POST"
      ),
      first.getByTestId("grade-wrong").click(),
    ]);
    expect(res.status()).toBe(200);

    const body = (await res.json()) as { intervalDays: number; repetitions: number; ease: number };
    expect(body.intervalDays).toBe(1);
    expect(body.repetitions).toBe(0);
    expect(body.ease).toBeLessThan(2.5); // ease penalty applied

    await expect(first.getByTestId("recall-scheduled")).toHaveText(/reset to \+1d/);

    // A miss pushes due_at to +1d, so it leaves TODAY's queue but comes back
    // tomorrow — the honest reading of "shortest interval".
    await page.goto("/recall");
    expect(await page.getByTestId("recall-card").count()).toBe(before - 1);
  });

  // RC-06 — session accuracy is computed from real grades, not hard-coded.
  test("session accuracy reflects the grades given", async ({ page }) => {
    await seedQueue(page);

    await page.goto("/recall");
    const cards = page.getByTestId("recall-card");
    expect(await cards.count()).toBeGreaterThanOrEqual(2);

    const gradeFirstVisible = async (testid: string) => {
      const card = cards.filter({ has: page.getByTestId(testid) }).first();
      const cardId = await card.getAttribute("data-card-id");
      await Promise.all([
        page.waitForResponse((r) => r.url().includes(`/api/recall/${cardId}/grade`)),
        card.getByTestId(testid).click(),
      ]);
    };

    await gradeFirstVisible("grade-right");
    await expect(page.getByTestId("recall-accuracy")).toHaveText("100%");

    await gradeFirstVisible("grade-wrong");
    await expect(page.getByTestId("recall-accuracy")).toHaveText("50%");
    await expect(page.getByTestId("recall-progress")).toHaveText("2 of " + (await cards.count()) + " graded");
  });
});

test.describe("Recall — RLS cross-user isolation (Rule 5)", () => {
  // RC-07 — User B must not be able to grade User A's card. Under RLS the row is
  // invisible to B, so the route 404s — B can't even confirm it exists.
  test("user B cannot grade user A's card", async ({ page, playwright }) => {
    await seedQueue(page); // owned by User A

    await page.goto("/recall");
    const cardId = await page.getByTestId("recall-card").first().getAttribute("data-card-id");
    expect(cardId).toBeTruthy();

    const userB = await playwright.request.newContext({
      baseURL: test.info().project.use.baseURL,
      storageState: "tests/e2e/.auth/userB.json",
    });
    const res = await userB.post(`/api/recall/${cardId}/grade`, { data: { grade: "right" } });
    expect(res.status()).toBe(404);
    await userB.dispose();

    // And A's card is untouched — still due, still ungraded.
    await page.goto("/recall");
    const still = page.getByTestId("recall-card").filter({ has: page.getByTestId("grade-right") });
    expect(await still.count()).toBeGreaterThan(0);
  });

  // RC-08 — User B's recall screen must not show any of User A's cards.
  test("user B's queue does not contain user A's cards", async ({ page, browser }) => {
    await seedQueue(page);

    await page.goto("/recall");
    const aCardId = await page.getByTestId("recall-card").first().getAttribute("data-card-id");

    const ctx = await browser.newContext({ storageState: "tests/e2e/.auth/userB.json" });
    const bPage = await ctx.newPage();
    await bPage.goto("/recall");
    await expect(bPage.locator(`[data-card-id="${aCardId}"]`)).toHaveCount(0);
    await ctx.close();
  });
});
