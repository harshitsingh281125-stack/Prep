import type { Page } from "@playwright/test";

// Shared helpers for the E2E suite.

/**
 * Refuse to run AI-spending tests against a real provider.
 *
 * playwright.config.ts starts the test server with AI_PROVIDER=mock, but config can
 * regress and a stale/other server can be picked up. When that happened, the suite
 * silently sent **26 real Gemini requests** — it stayed green, so nothing pointed at
 * it; the spend only showed up later in `ai_usage`.
 *
 * A test that costs money when it's misconfigured must fail loudly rather than pay
 * quietly. Called from a `beforeAll` in every spec that triggers generation.
 */
export async function assertMockProvider(page: Page): Promise<void> {
  const res = await page.request.get("/api/usage");
  if (!res.ok()) {
    throw new Error(`Could not read /api/usage (${res.status()}) to verify the AI provider.`);
  }
  const { provider } = await res.json();
  if (provider !== "mock") {
    throw new Error(
      `REFUSING TO RUN: the server under test reports provider="${provider}", not "mock". ` +
        `These tests generate roadmaps, topic detail and recall cards — against a real ` +
        `provider that spends your daily cap and real money. Playwright should start its ` +
        `own server on the test port with AI_PROVIDER=mock; check that nothing else is ` +
        `already listening on it and that webServer.env is intact.`
    );
  }
}

/**
 * Refuse to run grounding tests against an unembedded corpus (Phase 4.5).
 *
 * match_resources() skips rows whose `embedding` is NULL, so a corpus that has
 * been seeded (0008) but never backfilled (`npm run embed:corpus`) retrieves
 * NOTHING — and the route then correctly falls back to ungrounded generation.
 * Every grounding assertion would fail with "expected rag, got ai", which reads
 * like a broken pipeline rather than a setup step nobody ran.
 *
 * This is the same lesson as `generateCardsForFirstTopic` throwing instead of
 * returning 0: a fixture's precondition failure must name itself, or it gets
 * misdiagnosed as a failure of the thing under test (memory.md, twice).
 *
 * It reads the corpus through PostgREST with the ANON key on purpose — which
 * also demonstrates the `for select using (true)` policy from the outside.
 */
export async function assertCorpusEmbedded(page: Page): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing — cannot verify the RAG corpus.");
  }

  const res = await page.request.get(
    `${url}/rest/v1/resources?select=id&embedding=not.is.null&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );

  if (!res.ok()) {
    throw new Error(
      `Could not read the resources corpus (${res.status()}). Has migration ` +
        `0007_resources.sql been applied? Grounding tests cannot run without it.`
    );
  }

  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      "REFUSING TO RUN: the resources corpus has no embedded rows.\n" +
        "Apply 0007_resources.sql and 0008_resources_seed.sql, then run " +
        "`npm run embed:corpus`. Without vectors, retrieval returns nothing and " +
        "every topic silently falls back to ungrounded generation — which would " +
        "make these tests fail as if the grounding code were broken."
    );
  }
}

export const VALID_ANSWERS = {
  role: "SDE-2 · Frontend",
  bar: "Big tech (FAANG-tier)",
  timeline: "3 weeks",
  hours: "12h",
  weak: ["React internals"],
};

// Generate a roadmap via the API from within the page's authenticated context
// (uses the browser's session cookies). Returns the new roadmap id, or null +
// status on non-2xx.
export async function generateRoadmap(
  page: Page,
  answers: Record<string, unknown> = VALID_ANSWERS
): Promise<{ id: string | null; status: number }> {
  const res = await page.request.post("/api/roadmaps/generate", { data: answers });
  const status = res.status();
  if (!res.ok()) return { id: null, status };
  const body = await res.json();
  return { id: body.id ?? null, status };
}

/**
 * Fill a roadmap's recall queue (Phase 4).
 *
 * Before Phase 4, onboarding always seeded cards from the catalog, so any spec
 * that needed a queue got one for free. Now a GENERATED roadmap invents its own
 * topic names, matches no seeded questions, and starts with an empty deck — so
 * a spec that needs cards has to ask for them, the same way a user does.
 *
 * Walks to the first topic of the roadmap (the ids aren't otherwise exposed to
 * the client) and generates its cards. Fails loudly rather than returning an
 * empty queue: a silent 0 here resurfaces as "no cards rendered" three
 * assertions later, which is precisely the misdiagnosis that cost Phase 2 an
 * afternoon (memory.md).
 */
export async function generateCardsForFirstTopic(page: Page, roadmapId: string): Promise<number> {
  await page.goto(`/roadmap/${roadmapId}`);
  await page.getByText("study →").first().click();
  await page.waitForURL(/\/topic\//);
  const topicId = new URL(page.url()).pathname.split("/").pop()!;

  const res = await page.request.post("/api/recall/generate", { data: { topicId } });
  if (!res.ok()) {
    throw new Error(
      `Card generation failed with ${res.status()} for topic ${topicId} — the recall queue will be empty and downstream assertions will misreport as "no cards found".`
    );
  }
  const body = await res.json();
  if ((body.created ?? 0) === 0) {
    throw new Error(
      `Card generation created 0 cards (source: ${body.source}, reason: ${body.reason}). Expected the mock provider to produce a queue — is the dev server running without AI_PROVIDER=mock?`
    );
  }
  return body.created as number;
}

// Delete a roadmap by id (cleanup). Safe to call even if it's already gone —
// DELETE is idempotent under RLS. Specs track the ids they create and delete them
// in afterEach so the shared project's quota resets and rows don't accumulate.
export async function deleteRoadmap(page: Page, id: string): Promise<number> {
  const res = await page.request.delete(`/api/roadmaps/${id}`);
  return res.status();
}
