import Header from "@/components/shell/Header";
import ContentArea from "@/components/shell/ContentArea";
import PhasePlaceholder from "@/components/shell/PhasePlaceholder";

export default function RecallPage() {
  return (
    <>
      <Header title="Recall" subtitle="Spaced-repetition review. Grade yourself honestly — a 'close enough' is a miss." />
      <ContentArea maxWidth={740}>
        <PhasePlaceholder
          phase="Phase 2"
          blurb="The recall queue runs on a hand-written spaced-repetition scheduler. It arrives once roadmaps and topics exist to build cards from."
        />
      </ContentArea>
    </>
  );
}
