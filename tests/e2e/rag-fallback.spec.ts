import { expect, test, type Page } from "@playwright/test";
import { assertMockProvider, deleteRoadmap, generateRoadmap } from "./helpers";

// Phase 4.5 — RAG grounding, the MISS branch (Rule 9).
//
// Runs on the sibling test server, started with RAG_MIN_SIMILARITY=2 — a floor
// no cosine similarity can ever reach, since the maximum is 1. Every retrieval
// therefore returns nothing, which is the "niche topic, thin corpus" case from
// the phase spec made deterministic instead of hoped for.
//
// This is the half of RAG that Rule 9 is actually about, and it is the half that
// a demo never shows you. Adding retrieval to a working flow introduces four new
// ways for that flow to break — no match, corpus unreachable, embedding capped,
// embedding provider down — and all four have to land somewhere the user can
// still study. They all land here.

const created: string[] = [];

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await assertMockProvider(page);
  await page.close();
});

test.afterEach(async ({ page }) => {
  while (created.length) await deleteRoadmap(page, created.pop()!);
});

async function seedTopic(page: Page): Promise<void> {
  const { id, status } = await generateRoadmap(page);
  if (!id) throw new Error(`Roadmap generation returned ${status} — quota full from a previous run?`);
  created.push(id);
  await page.goto(`/roadmap/${id}`);
  await page.getByText("study →").first().click();
  await page.waitForURL(/\/topic\//);
}

test.describe("RAG fallback — an empty corpus never blocks a topic", () => {
  // RAG-11 — the Rule 9 guarantee, restated for retrieval: the flow completes.
  test("RAG-11: with no corpus hit the topic still gets full study material", async ({ page }) => {
    await seedTopic(page);
    await expect(page.getByTestId("detail-empty")).toBeVisible();

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/detail") && r.request().method() === "POST"),
      page.getByTestId("generate-detail").click(),
    ]);

    // Not a 5xx, not an error state — a 200 with usable content, as in Phase 4.
    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.retrieved).toBe(0);
    // 'ai' normally; 'seed' if the completion itself also failed. Never 'rag' —
    // there was nothing to ground on.
    expect(["ai", "seed"]).toContain(body.source);
    expect(body.detail.model.length).toBeGreaterThan(0);
    expect(body.detail.resources.length).toBeGreaterThan(0);
  });

  // RAG-12 — the honesty requirement. Ungrounded resources must SAY they are
  // ungrounded; silently serving model-recalled references next to vetted ones
  // in an identical presentation is the failure this whole phase exists to fix.
  test("RAG-12: ungrounded resources are flagged unverified and carry no link", async ({ page }) => {
    await seedTopic(page);

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/detail") && r.request().method() === "POST"),
      page.getByTestId("generate-detail").click(),
    ]);
    const body = await response.json();

    if (body.source === "ai") {
      for (const resource of body.detail.resources) {
        expect(resource.unverified).toBe(true);
        // The grounded generator is the only path that produces a URL, so a link
        // here would mean a model-recalled one had reached storage.
        expect(resource.url).toBeUndefined();
      }
      await expect(page.getByTestId("unverified-chip").first()).toBeVisible();
      await expect(page.getByTestId("verified-chip")).toHaveCount(0);
    }

    await expect(page.getByTestId("detail-source")).not.toContainText("grounded");
  });

  // RAG-13 — cost. A missed retrieval must not quietly cost the same as a hit;
  // it should spend the embedding and then exactly one completion, not two.
  test("RAG-13: a missed retrieval does not spend a grounded completion too", async ({ page }) => {
    await seedTopic(page);

    const detailCalls = (body: {
      today: { perRoute: { route: string; calls: number }[] };
    }): number =>
      body.today.perRoute.find((r) => r.route === "/api/topics/detail")?.calls ?? 0;

    const before = detailCalls(await (await page.request.get("/api/usage")).json());

    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/detail") && r.request().method() === "POST"),
      page.getByTestId("generate-detail").click(),
    ]);

    const after = detailCalls(await (await page.request.get("/api/usage")).json());

    // One embedding + one ungrounded completion. Three would mean the route
    // attempted a grounded completion against an empty document set first.
    expect(after - before).toBe(2);
  });
});
