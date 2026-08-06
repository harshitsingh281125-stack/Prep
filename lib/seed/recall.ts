// Seeded recall questions (Phase 2). One or more cards per catalog topic, keyed
// by the exact topic name used in lib/seed/catalog.ts.
//
// The first five entries are lifted verbatim from the design's `recallData`
// (Prep - Interview Prep OS.html) — same questions, re-attached to the catalog
// topic they actually belong to. The rest fill in the remaining catalog topics so
// every generated roadmap produces a non-empty recall queue.
//
// In Phase 4 these become the seeded fallback for `/api/recall/generate`
// (classification tier) — same shape, so the AI path is a drop-in (Rule 9).

/** Questions per catalog topic name. Topics absent here simply seed no cards. */
export const RECALL_SEED: Record<string, string[]> = {
  // ---- Async JS ----
  "Event loop & microtasks": [
    // from the design's recallData ('Event loop')
    "A microtask is queued inside a setTimeout callback. Relative to the next timer, when does it run — and why is that guaranteed?",
    "The call stack is empty and both a promise callback and a setTimeout(…, 0) are pending. Which runs first, and what rule decides it?",
  ],
  "Closures & scope": [
    "A for-loop with `var` creates three setTimeout callbacks that all log the same number. Explain what each closure captured, and what changing to `let` actually changes.",
  ],
  "Promises & async patterns": [
    // from the design's recallData ('Async patterns')
    "Implement debounce(fn, wait). What exactly does the returned closure capture between calls, and what breaks if you forget to clear the timer?",
    "What is the difference between Promise.all and Promise.allSettled when one input rejects — and which one leaves you with a partial result?",
  ],

  // ---- Browser & rendering ----
  "Critical rendering path": [
    "Name the steps from HTML bytes to pixels on screen, and say which one a render-blocking stylesheet stalls.",
  ],
  "Reflow vs repaint": [
    // from the design's recallData ('Rendering')
    "Of { transform, top, opacity, height }, which trigger layout, which trigger paint only, and which the compositor handles alone?",
    "Name three property reads that force a synchronous reflow, and explain why reading them mid-write loop is the expensive part.",
  ],
  "Performance budgets": [
    "What does a Largest Contentful Paint budget actually constrain, and which single network change usually moves it most?",
  ],

  // ---- React internals ----
  "Reconciliation & keys": [
    // from the design's recallData ('React internals')
    "In reconciliation, what does changing a list item's key force React to do to that subtree's fiber and state?",
    "Two sibling elements swap position in a list keyed by array index. What happens to each one's local input state, and why?",
  ],
  "useEffect timing & cleanup": [
    // from the design's recallData ('React internals')
    "Does a useEffect cleanup run before or after the next effect fires? Before or after the browser paints?",
  ],
  "Concurrent features": [
    "What does marking an update as a transition change about how React schedules it, and what does the user actually see differently?",
  ],

  // ---- Frontend system design ----
  "Infinite feed & pagination": [
    "Why does offset pagination duplicate or skip rows on a feed that is being written to, and what does cursor pagination change?",
  ],
  "Client cache & invalidation": [
    "Describe stale-while-revalidate in one sentence, and say what the user sees on the second visit versus the first.",
  ],
  "Realtime: WS vs SSE": [
    "Pick WebSockets or SSE for a live notification feed and defend it in two sentences — what is the deciding property?",
  ],

  // ---- Live coding speed ----
  "debounce / throttle from scratch": [
    "Debounce versus throttle: for a search-as-you-type input, which one do you want, and what exactly goes wrong with the other?",
  ],
  "Virtualized list": [
    "In a windowed list, what has to be known up front to position the scrollbar correctly, and what breaks when row heights vary?",
  ],

  // ---- Behavioral ----
  "STAR behavioral stories": [
    "State your strongest conflict story in STAR form in under 90 seconds. Which letter do you usually rush, and what detail is missing from it?",
  ],
};

/** A card ready to persist, before user_id / topic_id are attached. */
export type SeedRecallCard = {
  topicLabel: string;
  question: string;
};

/**
 * Build the recall cards for one topic. Returns [] for a topic with no seeded
 * questions — a roadmap padded with repeated blocks must not duplicate cards
 * blindly, so the caller dedupes by topic (see /api/roadmaps/generate).
 */
export function seedCardsForTopic(topicName: string): SeedRecallCard[] {
  const questions = RECALL_SEED[topicName] ?? [];
  return questions.map((question) => ({ topicLabel: topicName, question }));
}
