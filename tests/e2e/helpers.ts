import type { Page } from "@playwright/test";

// Shared helpers for the E2E suite.

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

// Delete a roadmap by id (cleanup). Safe to call even if it's already gone —
// DELETE is idempotent under RLS. Specs track the ids they create and delete them
// in afterEach so the shared project's quota resets and rows don't accumulate.
export async function deleteRoadmap(page: Page, id: string): Promise<number> {
  const res = await page.request.delete(`/api/roadmaps/${id}`);
  return res.status();
}
