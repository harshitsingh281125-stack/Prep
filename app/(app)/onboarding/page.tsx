import Header from "@/components/shell/Header";
import ContentArea from "@/components/shell/ContentArea";
import PhasePlaceholder from "@/components/shell/PhasePlaceholder";

export default function OnboardingPage() {
  return (
    <>
      <Header title="New roadmap" subtitle="Five questions, then a roadmap you'll actually be held to." />
      <ContentArea maxWidth={940}>
        <PhasePlaceholder
          phase="Phase 1"
          blurb="The 5-question wizard with a live preview writes your first roadmap from seeded content. It lands in Phase 1."
        />
      </ContentArea>
    </>
  );
}
