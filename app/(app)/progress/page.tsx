import Header from "@/components/shell/Header";
import ContentArea from "@/components/shell/ContentArea";
import PhasePlaceholder from "@/components/shell/PhasePlaceholder";

export default function ProgressPage() {
  return (
    <>
      <Header title="Progress" subtitle="Honest pace vs. plan — including when you're behind." />
      <ContentArea maxWidth={1000}>
        <PhasePlaceholder
          phase="Phase 3"
          blurb="Hours logged vs. planned, recall-accuracy trend, and a behind-pace banner computed from real data — with hand-rolled SVG charts."
        />
      </ContentArea>
    </>
  );
}
