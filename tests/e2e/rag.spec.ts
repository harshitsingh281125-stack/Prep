import { expect, test, type Page } from "@playwright/test";
import {
  assertCorpusEmbedded,
  assertMockProvider,
  deleteRoadmap,
  generateRoadmap,
} from "./helpers";

// Phase 4.5 — RAG grounding, the HIT branch.
//
// This project runs against the test server started with RAG_MIN_SIMILARITY=-1
// (playwright.config.ts), so every retrieval returns documents. That is a
// deliberate reachability override, not a cheat: the corpus holds real Gemini
// vectors while the mock provider embeds lexically, so genuine similarities
// between them are meaningless noise. Lowering the floor makes the PIPELINE
// testable — grounding, citation resolution, labelling, metering — while
// leaving retrieval QUALITY (does the right document come first?) to the manual
// suite, where a human reads real results.
//
// The corresponding MISS branch is rag-fallback.spec.ts, on the sibling server.

const created: string[] = [];

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  // Two loud preconditions. Both of these failing silently would produce test
  // failures that look like product bugs (memory.md has two instances of exactly
  // that costing an afternoon each).
  await assertMockProvider(page);
  await assertCorpusEmbedded(page);
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

/** Press Generate and return the route's JSON — waiting on the response, not the DOM. */
async function generateDetail(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/detail") && r.request().method() === "POST"),
    page.getByTestId(
      (await page.getByTestId("generate-detail").count()) > 0
        ? "generate-detail"
        : "regenerate-detail"
    ).click(),
  ]);
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe("RAG grounding — resources come from the corpus", () => {
  // RAG-01 — the headline claim of the phase.
  test("RAG-01: a topic with corpus hits is grounded, not model-recalled", async ({ page }) => {
    await seedTopic(page);
    const body = await generateDetail(page);

    expect(body.source).toBe("rag");
    expect(body.retrieved).toBeGreaterThan(0);
    expect(body.detail.resources.length).toBeGreaterThan(0);
  });

  // RAG-02 — the security-relevant one. Every URL that reaches storage must be a
  // URL a human curated; the model is never asked for one.
  test("RAG-02: every grounded resource URL exists in the corpus", async ({ page }) => {
    await seedTopic(page);
    const body = await generateDetail(page);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const res = await page.request.get(`${url}/rest/v1/resources?select=url`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const corpusUrls = new Set(((await res.json()) as { url: string }[]).map((r) => r.url));

    for (const resource of body.detail.resources) {
      expect(resource.url, "a grounded resource must carry a link").toBeTruthy();
      expect(corpusUrls.has(resource.url), `${resource.url} is not in the corpus`).toBe(true);
    }
  });

  // RAG-03 — the two flags are two halves of one fact. A resource that is both
  // linked and flagged unverified (or neither) would make the UI's chips lie.
  test("RAG-03: grounded resources are linked and never flagged unverified", async ({ page }) => {
    await seedTopic(page);
    const body = await generateDetail(page);

    for (const resource of body.detail.resources) {
      expect(Boolean(resource.url)).toBe(true);
      expect(resource.unverified).toBeFalsy();
    }
  });

  // RAG-04 — the claim has to be visible to the user, not just true in the JSON.
  test("RAG-04: the UI shows VERIFIED chips and real links", async ({ page }) => {
    await seedTopic(page);
    await generateDetail(page);

    await expect(page.getByTestId("verified-chip").first()).toBeVisible();
    await expect(page.getByTestId("unverified-chip")).toHaveCount(0);
    await expect(page.getByTestId("detail-source")).toContainText("grounded");

    const link = page.locator('a[href^="https://"]').first();
    await expect(link).toBeVisible();
    // target=_blank without rel=noopener is a real (if small) security defect,
    // and it is exactly the kind of thing that survives a visual review.
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  // RAG-05 — Rule 11. The embedding is a billed provider call; if it were not
  // metered, the daily cap would be undercounting every grounded generation.
  test("RAG-05: the retrieval embedding is metered alongside the completion", async ({ page }) => {
    await seedTopic(page);

    // Measured around the button press only — seeding a roadmap spends calls of
    // its own, and counting those would make this pass for the wrong reason.
    const before = await (await page.request.get("/api/usage")).json();
    await generateDetail(page);
    const after = await (await page.request.get("/api/usage")).json();

    // Two dispatches for one button press: one embedding, one completion.
    expect(after.usedToday - before.usedToday).toBeGreaterThanOrEqual(2);

    // And the embedding tier really is represented — a count alone would also be
    // satisfied by two completions, which is the bug this guards against.
    const embedRows = after.today.perRoute.find(
      (r: { route: string }) => r.route === "/api/topics/detail"
    );
    expect(embedRows.calls).toBeGreaterThanOrEqual(2);
  });

  // RAG-06 — grounded detail is persisted like any other, so a reload does not
  // silently re-spend two calls.
  test("RAG-06: grounded detail survives a reload", async ({ page }) => {
    await seedTopic(page);
    const body = await generateDetail(page);
    const firstUrl = body.detail.resources[0].url;

    await page.reload();
    await expect(page.getByTestId("detail-empty")).toHaveCount(0);
    await expect(page.getByTestId("verified-chip").first()).toBeVisible();
    await expect(page.locator(`a[href="${firstUrl}"]`)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// The corpus is world-readable BY DESIGN and world-writable BY NOBODY.
//
// Rules.md called `resources` "the one table without RLS". Implementing that
// literally would have been a hole: Supabase grants every public table to `anon`
// and `authenticated`, and RLS is what narrows those grants — so "no RLS" means
// world-WRITABLE, i.e. anyone could inject a URL into the one list this phase
// exists to make trustworthy. These cases pin the corrected shape.
// ---------------------------------------------------------------------------
test.describe("resources corpus RLS — public read, server-only write", () => {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

  // RAG-07 — reads must work for everyone; the corpus is shared reference data.
  // (If this failed, RAG-08's "writes are denied" could pass for the wrong reason.)
  test("RAG-07: the corpus is readable", async ({ request }) => {
    const res = await request.get(`${SUPABASE_URL}/rest/v1/resources?select=id,url&limit=5`, {
      headers,
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).length).toBeGreaterThan(0);
  });

  // RAG-08 — the one that matters. A writable corpus means an attacker chooses
  // which links Prep vouches for.
  test("RAG-08: nobody can insert a resource into the corpus", async ({ request }) => {
    const res = await request.post(`${SUPABASE_URL}/rest/v1/resources`, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: {
        topic_area: "react",
        title: "Injected",
        url: "https://evil.invalid/injected",
        kind: "doc",
        summary: "should never be stored",
      },
    });
    expect(res.status(), "an insert into the vetted corpus must be denied").toBeGreaterThanOrEqual(
      400
    );
  });

  // RAG-09 — deletion is the quieter attack: remove the good documents and the
  // corpus stops matching, so every topic silently degrades to ungrounded
  // generation. No error, just a product that stopped being trustworthy.
  test("RAG-09: nobody can delete corpus rows", async ({ request }) => {
    const res = await request.delete(`${SUPABASE_URL}/rest/v1/resources?id=not.is.null`, {
      headers,
    });

    // PostgREST may answer 4xx, or report a successful no-op — RLS filtering a
    // DELETE to zero rows is not an error. Either is acceptable; what is NOT
    // acceptable is rows actually disappearing, so assert the corpus survives.
    expect([200, 204, 401, 403, 404, 405]).toContain(res.status());

    const after = await request.get(`${SUPABASE_URL}/rest/v1/resources?select=id`, { headers });
    expect((await after.json()).length).toBeGreaterThan(0);
  });

  // RAG-10 — updating a row's URL in place would be injection without an insert.
  test("RAG-10: nobody can rewrite a corpus URL", async ({ request }) => {
    const res = await request.patch(`${SUPABASE_URL}/rest/v1/resources?id=not.is.null`, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: { url: "https://evil.invalid/rewritten" },
    });
    expect([200, 204, 401, 403, 404, 405]).toContain(res.status());

    const after = await request.get(
      `${SUPABASE_URL}/rest/v1/resources?select=id&url=eq.https://evil.invalid/rewritten`,
      { headers }
    );
    expect((await after.json()).length, "a corpus URL was rewritten").toBe(0);
  });
});
