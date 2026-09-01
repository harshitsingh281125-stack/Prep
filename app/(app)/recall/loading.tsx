import ContentSkeleton from "@/components/shell/ContentSkeleton";

/**
 * Loading skeleton for /recall.
 *
 * WHY THIS IS PER-ROUTE AND NOT ONE FILE AT THE `(app)` GROUP ROOT — this is the
 * whole lesson of the Phase 5 QA run, so it is written at every copy:
 *
 * `loading.tsx` wraps its segment in a Suspense boundary, which makes the route
 * STREAM. A streamed response has already flushed its HTTP headers — status 200 —
 * by the time the async server component underneath resolves. So if that component
 * then calls `notFound()`, the 404 *page* renders but the *status code* stays 200.
 *
 * That silently downgraded `/roadmap/[id]`'s 404 to a 200 for another user's id.
 * No data leaked (verified — the 404 body rendered correctly), but the status code
 * is load-bearing here: it is what `tests/e2e/rls.spec.ts` asserts, and what stops
 * a crawler recording a 200 for somebody else's roadmap URL.
 *
 * So the rule is: **a route that can call `notFound()` must not have a
 * `loading.tsx`.** `/roadmap/[id]` and the topic route are excluded for exactly
 * that reason and render blocking instead. This route never 404s, so it can stream.
 */
export default function Loading() {
  return <ContentSkeleton />;
}
