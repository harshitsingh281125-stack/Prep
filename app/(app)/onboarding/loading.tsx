import ContentSkeleton from "@/components/shell/ContentSkeleton";

/**
 * Loading skeleton for /onboarding.
 *
 * The page awaits the profile and the roadmap count (for the quota check) before
 * it can render the wizard, so without this the "New roadmap" click looked
 * ignored until those queries returned.
 *
 * Safe to stream: this route never calls `notFound()` — see the note in
 * `app/(app)/recall/loading.tsx` for why a route that can 404 must not have a
 * `loading.tsx` (streaming commits a 200 before the page decides it's a 404).
 */
export default function Loading() {
  return <ContentSkeleton variant="wizard" />;
}
