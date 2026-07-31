import Header from "@/components/shell/Header";
import ContentArea from "@/components/shell/ContentArea";
import { createClient } from "@/lib/supabase/server";
import OnboardingWizard from "@/components/onboarding/OnboardingWizard";

export const dynamic = "force-dynamic";

// Onboarding — the 5-question wizard. This server wrapper just resolves whether
// the user is already at their roadmap quota (Rule 18) so the wizard can show the
// locked state; the /api/roadmaps/generate route is the real enforcement point.
export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("max_roadmaps")
    .eq("id", user?.id ?? "")
    .single();
  const maxRoadmaps = profile?.max_roadmaps ?? 3;

  const { count } = await supabase
    .from("roadmaps")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user?.id ?? "");

  const atLimit = (count ?? 0) >= maxRoadmaps;

  return (
    <>
      <Header title="New roadmap" subtitle="Five questions, then a roadmap you'll actually be held to." />
      <ContentArea maxWidth={940}>
        <OnboardingWizard atLimit={atLimit} maxRoadmaps={maxRoadmaps} />
      </ContentArea>
    </>
  );
}
