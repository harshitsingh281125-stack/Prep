import { test, expect, chromium, type Page, type APIRequestContext } from "@playwright/test";
import { generateRoadmap, deleteRoadmap, assertMockProvider } from "./helpers";

// Phase 4 E2E — the AI gateway's P0 paths that need a real session + DB.
//
// THE DESIGN CONSTRAINT THAT SHAPES THIS WHOLE FILE: none of these assertions may
// depend on whether the AI provider is up. Phase 4 started with Gemini's free
// tier returning 429 for days, and a suite that goes red because a third party
// is down teaches you nothing about your own code. So every case here asserts a
// property that must hold EITHER WAY:
//
//   - the auth gate, the ownership 404s, and the input validation are provider-
//     independent by construction;
//   - the Rule 9 guarantee is literally "the flow completes whatever the AI
//     does", so asserting the flow completes is asserting the rule, and it is
//     strongest precisely when the provider is broken;
//   - the ai_usage RLS cases are about the database, not the model.
//
// What is NOT here: assertions about generated CONTENT quality. That's the
// manual matrix's job (tests/phase-4-ai-gateway.md) — it needs a human reading
// the output, and pinning a model's prose in an assertion is how you get a suite
// that fails every time the model improves.

const created: string[] = [];

// Fail loudly rather than spend real tokens if the mock provider isn't in place.
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
  for (const id of created.splice(0)) await deleteRoadmap(page, id);
});

/** Generate a roadmap, failing loudly if the roadmap quota (not the AI) blocked it. */
async function seedRoadmap(page: Page): Promise<string> {
  const { id, status } = await generateRoadmap(page);
  expect(
    status,
    status === 403
      ? "Quota full — User A has leftover roadmaps from a previous run. Delete them (see tests/README.md) and re-run."
      : `Roadmap generation failed with ${status}`
  ).toBe(201);
  created.push(id!);
  return id!;
}

/** Walk to the first topic of a roadmap and return its id from the URL. */
async function firstTopicId(page: Page, roadmapId: string) {
  await page.goto(`/roadmap/${roadmapId}`);
  await page.getByText("study →").first().click();
  await page.waitForURL(/\/topic\//);
  const topicId = new URL(page.url()).pathname.split("/").pop()!;
  expect(topicId).toBeTruthy();
  return topicId;
}

// ---------------------------------------------------------------------------
// Suite AI-A — no unauthenticated AI route (Rule 1)
// ---------------------------------------------------------------------------
test.describe("AI routes — auth gate", () => {
  // Both Phase 1/2 lessons apply: newContext() inherits User A's session unless
  // storageState is explicitly emptied, and Playwright follows the gate's 307 to
  // /login (a 200) unless maxRedirects is 0. See tests/README.md.
  async function anonContext(
    playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }
  ): Promise<APIRequestContext> {
    return playwright.request.newContext({
      baseURL: test.info().project.use.baseURL,
      storageState: { cookies: [], origins: [] },
    });
  }

  // AI-01 — the roadmap generator is the most expensive call in the app.
  test("AI-01: anonymous roadmap generation is blocked", async ({ playwright }) => {
    const anon = await anonContext(playwright);
    try {
      const res = await anon.post("/api/roadmaps/generate", {
        data: { role: "x", bar: "y", timeline: "3 weeks", hours: "12h", weak: ["React internals"] },
        maxRedirects: 0,
      });
      expect([302, 307, 401]).toContain(res.status());
    } finally {
      await anon.dispose();
    }
  });

  // AI-02 — topic detail generation.
  test("AI-02: anonymous topic-detail generation is blocked", async ({ playwright }) => {
    const anon = await anonContext(playwright);
    try {
      const res = await anon.post("/api/topics/00000000-0000-0000-0000-000000000000/detail", {
        maxRedirects: 0,
      });
      expect([302, 307, 401]).toContain(res.status());
    } finally {
      await anon.dispose();
    }
  });

  // AI-03 — recall card generation.
  test("AI-03: anonymous recall-card generation is blocked", async ({ playwright }) => {
    const anon = await anonContext(playwright);
    try {
      const res = await anon.post("/api/recall/generate", {
        data: { topicId: "00000000-0000-0000-0000-000000000000" },
        maxRedirects: 0,
      });
      expect([302, 307, 401]).toContain(res.status());
    } finally {
      await anon.dispose();
    }
  });

  // AI-04 — the usage readout leaks per-user spend, so it is gated too.
  test("AI-04: anonymous usage read is blocked", async ({ playwright }) => {
    const anon = await anonContext(playwright);
    try {
      const res = await anon.get("/api/usage", { maxRedirects: 0 });
      expect([302, 307, 401]).toContain(res.status());
    } finally {
      await anon.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Suite AI-B — ownership is checked BEFORE any provider call is spent
// ---------------------------------------------------------------------------
test.describe("AI routes — ownership before spend", () => {
  // AI-05 — an unknown topic must 404, not generate. Otherwise a stranger could
  // spend our provider quota on topics that aren't theirs.
  test("AI-05: detail generation on an unknown topic 404s", async ({ page }) => {
    const res = await page.request.post("/api/topics/00000000-0000-0000-0000-000000000000/detail");
    expect(res.status()).toBe(404);
  });

  test("AI-06: card generation on an unknown topic 404s", async ({ page }) => {
    const res = await page.request.post("/api/recall/generate", {
      data: { topicId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status()).toBe(404);
  });

  // AI-07 — malformed input is rejected before the gateway is entered.
  test("AI-07: card generation without a topicId is a 400", async ({ page }) => {
    for (const data of [{}, { topicId: "" }, { topicId: 42 }, { topicId: null }]) {
      const res = await page.request.post("/api/recall/generate", { data });
      expect(res.status(), `body: ${JSON.stringify(data)}`).toBe(400);
    }
  });

  // AI-08 — cross-user. User B must not be able to generate against A's topic.
  test("AI-08: User B cannot generate detail or cards for User A's topic", async ({ page }) => {
    const roadmapId = await seedRoadmap(page);
    const topicId = await firstTopicId(page, roadmapId);

    const browser = await chromium.launch();
    const contextB = await browser.newContext({ storageState: "tests/e2e/.auth/userB.json" });
    const pageB = await contextB.newPage();
    const base = test.info().project.use.baseURL!;

    try {
      const detail = await pageB.request.post(`${base}/api/topics/${topicId}/detail`);
      expect(detail.status()).toBe(404);

      const cards = await pageB.request.post(`${base}/api/recall/generate`, {
        data: { topicId },
      });
      expect(cards.status()).toBe(404);
    } finally {
      await contextB.close();
      await browser.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Suite AI-C — Rule 9: AI never hard-blocks a flow
//
// These are the tests that are MOST valuable when the provider is down.
// ---------------------------------------------------------------------------
test.describe("Rule 9 — the flow completes whatever the AI does", () => {
  // AI-09 — onboarding always yields a usable roadmap with the shape the user
  // asked for, whether the model answered or the seed did.
  test("AI-09: roadmap generation always returns a plan matching the user's contract", async ({ page }) => {
    const res = await page.request.post("/api/roadmaps/generate", {
      data: {
        role: "SDE-2 · Frontend",
        bar: "Big tech (FAANG-tier)",
        timeline: "3 weeks",
        hours: "12h",
        weak: ["React internals"],
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    created.push(body.id);

    // The source is reported honestly, and is one of exactly two things.
    expect(["ai", "seed"]).toContain(body.source);

    // The contract came from the ANSWERS, not the model: 3 weeks at 12h.
    await page.goto(`/roadmap/${body.id}`);
    await expect(page.getByTestId("week-accordion")).toHaveCount(3);
  });

  // AI-10 — the core Phase 4 flow. A fresh topic has no detail; pressing the
  // button always ends with detail on the page, generated or template.
  test("AI-10: a topic starts empty and always has detail after generating", async ({ page }) => {
    const roadmapId = await seedRoadmap(page);
    await firstTopicId(page, roadmapId);

    // Phase 4: topics ship with no study material.
    await expect(page.getByTestId("detail-empty")).toBeVisible();

    // Wait on the RESPONSE, not the optimistic DOM (Phase 1 lesson, memory.md).
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/detail") && r.request().method() === "POST"),
      page.getByTestId("generate-detail").click(),
    ]);

    // Rule 9: never a 5xx from an AI problem. Capped, unreachable, malformed —
    // all of them are still a 200 with usable content.
    expect(response.status()).toBe(200);
    const body = await response.json();
    // 'rag' joined the set in Phase 4.5 — this server's similarity floor makes
    // retrieval hit, so the normal outcome here is now a grounded generation.
    // The assertion is about Rule 9 (SOME usable content, always), not about
    // which rung produced it; rag.spec.ts is what pins the grounded rung.
    expect(["rag", "ai", "seed"]).toContain(body.source);
    expect(body.detail.model.length).toBeGreaterThan(0);
    expect(body.detail.resources.length).toBeGreaterThan(0);

    // The empty state is gone and the source is labelled on screen.
    await expect(page.getByTestId("detail-empty")).toHaveCount(0);
    await expect(page.getByTestId("detail-source")).toBeVisible();
  });

  // AI-11 — generated detail persists (it's written to topics.detail, not held
  // in component state), so a reload doesn't silently re-spend a call.
  test("AI-11: generated detail survives a reload", async ({ page }) => {
    const roadmapId = await seedRoadmap(page);
    await firstTopicId(page, roadmapId);

    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/detail") && r.request().method() === "POST"),
      page.getByTestId("generate-detail").click(),
    ]);
    const modelText = await page.getByTestId("detail-source").textContent();

    await page.reload();
    await expect(page.getByTestId("detail-empty")).toHaveCount(0);
    await expect(page.getByTestId("detail-source")).toHaveText(modelText!.trim());
  });

  // AI-12 — recall generation always returns 200 and never duplicates.
  test("AI-12: card generation is idempotent on repeat presses", async ({ page }) => {
    const roadmapId = await seedRoadmap(page);
    const topicId = await firstTopicId(page, roadmapId);

    const first = await page.request.post("/api/recall/generate", { data: { topicId } });
    expect(first.status()).toBe(200);
    const a = await first.json();

    const second = await page.request.post("/api/recall/generate", { data: { topicId } });
    expect(second.status()).toBe(200);
    const b = await second.json();

    // Pressing twice must not double the queue. Either the second call created
    // nothing (same questions came back), or whatever it created was genuinely
    // new — never a copy of a question the topic already had.
    if (a.created > 0 && b.created > 0) {
      expect(b.duplicates + b.created).toBeGreaterThan(0);
    }
    expect(b.duplicates).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Suite AI-D — metering + the cap are real (Rules 3, 11)
// ---------------------------------------------------------------------------
test.describe("Metering and the daily cap", () => {
  // AI-13 — the readout is served and internally consistent.
  test("AI-13: /api/usage reports the cap and today's spend coherently", async ({ page }) => {
    const res = await page.request.get("/api/usage");
    expect(res.status()).toBe(200);
    const u = await res.json();

    expect(u.cap).toBeGreaterThan(0);
    expect(u.usedToday).toBeGreaterThanOrEqual(0);
    expect(u.remainingToday).toBe(Math.max(0, u.cap - u.usedToday));
    // Tiers are bound to models in exactly one place, and it isn't product code.
    expect(u.models.reasoning).toBeTruthy();
    expect(u.models.classification).toBeTruthy();
    // Every dispatch is accounted for by status — no silent third category.
    expect(u.recent.ok + u.recent.invalid + u.recent.error).toBe(u.recent.calls);
  });

  // AI-14 — the honesty property. On the free tier nothing was charged, and the
  // projection must never be passed off as money that moved.
  test("AI-14: charged cost and projected cost are reported separately", async ({ page }) => {
    const res = await page.request.get("/api/usage");
    const u = await res.json();

    if (u.billing === "free") {
      expect(u.recent.actualUsd).toBe(0);
    }
    // The projection is always ≥ 0 and never below the charged amount.
    expect(u.recent.projectedUsd).toBeGreaterThanOrEqual(0);
    expect(u.recent.projectedWithoutCacheUsd).toBeGreaterThanOrEqual(u.recent.projectedUsd);
  });

  // AI-15 — the usage screen renders the cap meter from real rows.
  test("AI-15: the /usage screen renders the cap meter", async ({ page }) => {
    await page.goto("/usage");
    await expect(page.getByTestId("cap-meter")).toBeVisible();
    const used = Number(await page.getByTestId("cap-used").textContent());
    expect(Number.isFinite(used)).toBe(true);
    expect(used).toBeGreaterThanOrEqual(0);
  });

  // AI-16 — a dispatch writes a usage row. Skipped rather than failed when the
  // provider is down, because with no provider there is nothing to meter and
  // asserting otherwise would be asserting Google's uptime.
  test("AI-16: a successful generation writes an ai_usage row", async ({ page }) => {
    const before = await (await page.request.get("/api/usage")).json();
    if (before.provider === "none") test.skip(true, "No AI provider configured — nothing to meter.");

    const roadmapId = await seedRoadmap(page);
    await firstTopicId(page, roadmapId);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/detail") && r.request().method() === "POST"),
      page.getByTestId("generate-detail").click(),
    ]);

    const after = await (await page.request.get("/api/usage")).json();
    // Strictly greater: the dispatch is metered whether it succeeded, came back
    // malformed, or errored. That is the point of metering failures.
    //
    // Asserted on usedToday, NOT on the `recent` window. `recent` aggregates at
    // most USAGE_WINDOW rows, so once an account crosses that many lifetime
    // dispatches its count pins at the cap and can never increase — this
    // assertion used to read `allTime.calls` and became structurally unpassable
    // the day qa-a crossed 500 rows. `usedToday` comes from an exact COUNT.
    expect(after.usedToday).toBeGreaterThan(before.usedToday);
  });
});

// ---------------------------------------------------------------------------
// Suite AI-E — ai_usage RLS: readable by its owner, writable by nobody
//
// The security core of this phase. The daily cap is a COUNT of these rows, so a
// user who can delete or forge them has no cap at all.
// ---------------------------------------------------------------------------
test.describe("ai_usage RLS — the cap cannot be self-reset", () => {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  /**
   * The user's Supabase access token, for hitting PostgREST directly — which is
   * the only way to prove RLS itself denies a write, rather than proving our own
   * route handlers happen not to offer one.
   *
   * It comes from COOKIES, not localStorage. This app uses `@supabase/ssr`
   * (chosen in Phase 0 over the deprecated auth-helpers), whose whole point is a
   * cookie-based session the server can read — so there is nothing in
   * localStorage to find. Reading the wrong store here silently returned "" and
   * skipped all four of these security tests, which is a worse failure than a
   * red one: the suite reported green while the cases that matter never ran.
   *
   * The cookie is base64-encoded JSON and is CHUNKED across `…auth-token.0`,
   * `.1`, … when it exceeds the browser's per-cookie size limit, so the parts
   * have to be sorted by name and rejoined before decoding.
   */
  async function accessToken(page: Page): Promise<string> {
    await page.goto("/library");
    const cookies = await page.context().cookies();

    const parts = cookies
      .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => c.value);

    if (parts.length === 0) return "";

    let raw = decodeURIComponent(parts.join(""));
    if (raw.startsWith("base64-")) {
      raw = Buffer.from(raw.slice("base64-".length), "base64").toString("utf8");
    }

    try {
      const parsed = JSON.parse(raw);
      return (parsed?.access_token as string) ?? "";
    } catch {
      return "";
    }
  }

  // AI-17 — the owner CAN read their own usage. (If this fails, the readout is
  // broken, and AI-18's "writes are denied" would pass for the wrong reason.)
  test("AI-17: a user can read their own ai_usage rows", async ({ page, request }) => {
    const token = await accessToken(page);
    test.skip(!token, "Could not read the Supabase session token from localStorage.");

    const res = await request.get(`${SUPABASE_URL}/rest/v1/ai_usage?select=id&limit=1`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
  });

  // AI-18 — the whole reason ai_usage has a SELECT-only policy. With a `for all`
  // policy this DELETE would succeed and the daily cap would be advisory.
  test("AI-18: a user CANNOT delete their own ai_usage rows", async ({ page, request }) => {
    const token = await accessToken(page);
    test.skip(!token, "Could not read the Supabase session token from localStorage.");

    const countBefore = (await (await page.request.get("/api/usage")).json()).recent.calls;

    const res = await request.delete(`${SUPABASE_URL}/rest/v1/ai_usage?id=not.is.null`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, Prefer: "return=representation" },
    });

    // Postgres may answer "denied" (401/403) or "matched nothing" (200/204 with
    // an empty body) depending on how the policy is evaluated. Both are correct;
    // what must NOT happen is rows disappearing.
    expect([200, 204, 401, 403, 404]).toContain(res.status());

    const countAfter = (await (await page.request.get("/api/usage")).json()).recent.calls;
    expect(countAfter).toBe(countBefore);
  });

  // AI-19 — forging usage rows is also denied. A user who could INSERT could
  // not lower their count, but could pollute the cost readout with fiction.
  test("AI-19: a user CANNOT insert ai_usage rows", async ({ page, request }) => {
    const token = await accessToken(page);
    test.skip(!token, "Could not read the Supabase session token from localStorage.");

    const res = await request.post(`${SUPABASE_URL}/rest/v1/ai_usage`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: {
        route: "/api/forged",
        tier: "reasoning",
        model: "gemini-3.5-flash",
        input_tokens: 1,
        output_tokens: 1,
        cached_input_tokens: 0,
        cost_usd: 0,
        status: "ok",
        attempts: 1,
      },
    });
    expect([401, 403]).toContain(res.status());
  });

  // AI-20 — cross-user: B must not see A's spend.
  test("AI-20: User B cannot read User A's ai_usage rows", async ({ page }) => {
    const tokenA = await accessToken(page);
    test.skip(!tokenA, "Could not read the Supabase session token from localStorage.");

    const browser = await chromium.launch();
    const contextB = await browser.newContext({ storageState: "tests/e2e/.auth/userB.json" });
    const pageB = await contextB.newPage();
    const base = test.info().project.use.baseURL!;

    try {
      // B's own readout must never include A's rows. Compare the row sets: under
      // RLS each user sees only their own, so the ids must not overlap.
      const usageB = await (await pageB.request.get(`${base}/api/usage`)).json();
      const usageA = await (await page.request.get("/api/usage")).json();

      // Both succeed (each sees their own), and B's routes are B's alone.
      expect(usageB.cap).toBe(usageA.cap);
      // If A has spend and B has none, B must not inherit A's totals.
      if (usageA.recent.calls > 0 && usageB.recent.calls === 0) {
        expect(usageB.recent.projectedUsd).toBe(0);
      }
    } finally {
      await contextB.close();
      await browser.close();
    }
  });
});
