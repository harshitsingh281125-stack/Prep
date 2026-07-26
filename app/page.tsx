import { redirect } from "next/navigation";

// Phase 0: land users in the app. Stage C's middleware sends unauthenticated
// visitors to /login before this route group renders.
export default function RootPage() {
  redirect("/library");
}
