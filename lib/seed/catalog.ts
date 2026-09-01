// The seed curriculum catalog — lifted verbatim from the design source
// (`Prep - Interview Prep OS.html`: weeksData + topicDetail). This is the fixed
// 5-week frontend track the generator slices/reorders from, and the exact content
// the AI generator (Phase 4) will fall back to on schema-invalid output (Rule 9).
//
// Every week here is a "catalog block". generate.ts picks + orders blocks from
// this list per the onboarding answers; it never invents content outside it.

import type { TopicDetail } from "./types";

// ---------------------------------------------------------------------------
// topicDetail — mental model / ranked resources / from-scratch exercises per
// topic name. Missing topics fall through to buildFallbackDetail() (generate.ts).
// ---------------------------------------------------------------------------
export const TOPIC_DETAIL: Record<string, TopicDetail> = {
  "Reconciliation & keys": {
    model:
      "React never diffs the real DOM — it diffs its own element trees. Same type at the same position ⇒ it reuses the fiber and just mutates props. `key` is the only handle you give it to match elements when position changes; an index key silently reuses the wrong state.",
    resources: [
      { title: "Preserving and Resetting State", meta: "react.dev · 25 min", tag: "Docs" },
      { title: "The reconciler, annotated source read", meta: "Jser.dev · 40 min", tag: "Deep" },
      { title: "Why index keys break controlled inputs", meta: "blog · 12 min", tag: "Article" },
    ],
    exercises: [
      {
        title: "Predict the output",
        desc: "Reorder a list that uses index keys and holds local input state. Write the resulting DOM before you run it.",
      },
      {
        title: "Break it, then fix it",
        desc: 'Reproduce the "focus jumps to the wrong row" bug, fix it with stable keys, and explain the fiber match out loud.',
      },
    ],
  },
  "Event loop & microtasks": {
    model:
      'One call stack, two queues. The stack drains, then the ENTIRE microtask queue drains, then exactly one macrotask runs — repeat. Promises resolve on microtasks; setTimeout is a macrotask. Ordering questions are just "which queue, drained when".',
    resources: [
      { title: "Jake Archibald: In The Loop", meta: "talk · 34 min", tag: "Talk" },
      { title: "HTML spec: event loop processing model", meta: "whatwg · 30 min", tag: "Spec" },
      { title: "Tasks, microtasks, queues and schedules", meta: "article · 15 min", tag: "Article" },
    ],
    exercises: [
      {
        title: "Order the log",
        desc: "Given nested setTimeout / Promise.then / await, write the exact console order, then verify.",
      },
      {
        title: "Starve the loop",
        desc: "Write a microtask that re-queues itself and explain why the timer never fires.",
      },
    ],
  },
  "debounce / throttle from scratch": {
    model:
      'Both are closures over a timer id. Debounce resets the timer on every call — it fires once after silence. Throttle ignores calls while a window is open — it fires at a steady max rate. Pick by question: "wait until they stop" vs "at most N/sec".',
    resources: [
      { title: "Implementing debounce & throttle", meta: "article · 18 min", tag: "Article" },
      { title: "Lodash debounce options (leading/trailing)", meta: "source · 20 min", tag: "Deep" },
      { title: "requestAnimationFrame throttling", meta: "mdn · 10 min", tag: "Docs" },
    ],
    exercises: [
      {
        title: "Write both, no reference",
        desc: "Ship debounce(fn, wait) and throttle(fn, limit). Add leading + trailing options to debounce.",
      },
      {
        title: "Cancel & flush",
        desc: "Add .cancel() and .flush(). Explain what each does to the pending timer.",
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// The catalog blocks — the design's weeksData. `hours` is a number here (the
// design stored "10h" strings; the generator scales these to the user's budget).
// `weakAreas` are the onboarding weak-area labels this block covers — used to
// front-load blocks the user said they're weakest at.
// ---------------------------------------------------------------------------
export type CatalogBlock = {
  title: string;
  hours: number;
  killCriterion: string;
  weakAreas: string[]; // onboarding weak-area labels this block addresses
  topics: { name: string; status: "not_started" | "in_progress" | "mastered" }[];
};

export const CATALOG: CatalogBlock[] = [
  {
    title: "Core JS & Async",
    hours: 10,
    killCriterion:
      "Reimplement Promise.all with correct reject/settle semantics from scratch, under 10 min, no reference.",
    weakAreas: ["Async JS", "Live coding speed"],
    topics: [
      { name: "Event loop & microtasks", status: "not_started" },
      { name: "Closures & scope", status: "not_started" },
      { name: "Promises & async patterns", status: "not_started" },
    ],
  },
  {
    title: "Browser & Rendering",
    hours: 12,
    killCriterion:
      "Explain why transform/opacity skip layout, and name three things that force a synchronous reflow.",
    weakAreas: ["Browser & rendering"],
    topics: [
      { name: "Critical rendering path", status: "not_started" },
      { name: "Reflow vs repaint", status: "not_started" },
      { name: "Performance budgets", status: "not_started" },
    ],
  },
  {
    title: "React Internals",
    hours: 14,
    killCriterion:
      "Diagram render → commit → passive-effect order from memory and place cleanup correctly.",
    weakAreas: ["React internals"],
    topics: [
      { name: "Reconciliation & keys", status: "not_started" },
      { name: "useEffect timing & cleanup", status: "not_started" },
      { name: "Concurrent features", status: "not_started" },
    ],
  },
  {
    title: "Frontend System Design",
    hours: 12,
    killCriterion:
      "Design a live feed end-to-end in 25 min and defend three tradeoffs without prompting.",
    weakAreas: ["Frontend system design"],
    topics: [
      { name: "Infinite feed & pagination", status: "not_started" },
      { name: "Client cache & invalidation", status: "not_started" },
      { name: "Realtime: WS vs SSE", status: "not_started" },
    ],
  },
  {
    title: "Coding & Communication",
    hours: 12,
    killCriterion: "Ship a virtualized list at 60fps, no library, in 30 min while narrating.",
    weakAreas: ["Live coding speed", "Behavioral"],
    topics: [
      { name: "debounce / throttle from scratch", status: "not_started" },
      { name: "Virtualized list", status: "not_started" },
      { name: "STAR behavioral stories", status: "not_started" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Onboarding steps — the design's obSteps. Shared: the wizard renders these and
// the generator reads the answers keyed by `id`. `weak` is the only multi step.
// ---------------------------------------------------------------------------
export type OnboardingStep = {
  id: "role" | "bar" | "timeline" | "hours" | "weak";
  q: string;
  /** Optional sub-line under the question, for setting expectations about what it controls. */
  hint?: string;
  options: string[];
  multi?: boolean;
};

// ---------------------------------------------------------------------------
// Weak areas, per role (Phase 4).
//
// "Where are you weakest?" used to offer one fixed frontend list regardless of
// the role picked in step 1 — so a fullstack candidate was asked to choose
// between six frontend topics. The options now follow the role.
//
// PHASE 5 REVERSED THE PART OF THIS THAT SAID "NO BACKEND ROLE".
//
// Through Phase 4 the role list stayed frontend-only for one good reason: the
// CATALOG above is a frontend curriculum, so a "Backend" role would mean an AI
// failure hands that user a frontend plan — Rule 9 breaking QUIETLY, which is the
// only way Rule 9 can actually break. The fix chosen in Phase 5 is not to pretend
// the catalog covers backend; it is to make the fallback LOUD. "SDE-2 · Backend"
// ships, the AI path serves it properly (and the Phase 4.5 RAG corpus already
// carries 8 backend areas, so its topic detail is grounded, not recalled), and on
// the rare occasions generation fails, the roadmap is permanently labelled as a
// frontend template rather than silently passed off as a backend plan. See
// templateMismatch() below, roadmaps.generated_from (migration 0012), and the
// notice on the Roadmap + print screens.
//
// The fullstack list does name a few areas the catalog has no block for
// (databases, APIs). That degrades gracefully rather than breaking: orderBlocks()
// simply matches nothing for them and falls back to natural catalog order, and
// the AI path — which is the normal path — handles them properly.
// ---------------------------------------------------------------------------

/** Picking this means "no declared weak areas" — a balanced plan, nothing front-loaded. */
export const NOT_SURE = "Not sure";

// ---------------------------------------------------------------------------
// Tracks — which curriculum a role needs, and which one the CATALOG actually is.
//
// This exists so the app can answer one question honestly: "is the plan in front
// of you the plan you asked for?" It is the whole mechanism behind adding a
// backend role without breaking Rule 9 quietly.
// ---------------------------------------------------------------------------

export type Track = "frontend" | "backend";

/**
 * What the seeded CATALOG above is. A constant, not a guess — the five blocks
 * are Core JS, Browser & Rendering, React Internals, Frontend System Design, and
 * Coding & Communication. If per-role catalogs are ever authored, this becomes a
 * property of the chosen catalog and templateMismatch() stops being interesting.
 */
export const CATALOG_TRACK: Track = "frontend";

const ROLE_TRACKS: Record<string, Track> = {
  "SDE-2 · Frontend": "frontend",
  // Fullstack stays "frontend" on purpose. The catalog genuinely serves it
  // partially (its JS/React/system-design blocks are real fullstack interview
  // content) and Phase 4 already accepted that its DB/API weak areas simply
  // don't front-load anything. Calling it a mismatch would cry wolf on a plan
  // that is mostly right, and a warning that fires on a good plan is a warning
  // people learn to ignore.
  "SDE-2 · Fullstack": "frontend",
  "SDE-2 · Backend": "backend",
  "Senior · Frontend": "frontend",
  "Staff · Frontend": "frontend",
};

/**
 * The track a role needs. An unrecognised role (or none) resolves to the
 * catalog's own track — i.e. "no mismatch", the same defaulting weakAreasForRole
 * does. Defaulting the OTHER way would slap a scary "wrong template" notice on
 * every roadmap created before this column existed.
 */
export function roleTrack(role: string | null | undefined): Track {
  return (role && ROLE_TRACKS[role]) || CATALOG_TRACK;
}

/**
 * Should this roadmap carry the "this is the wrong template for your role"
 * notice? True only when BOTH halves are true:
 *
 *   1. the seeded fallback actually ran (`generated_from === 'seed'`), and
 *   2. the role needs a track the seeded catalog is not.
 *
 * `generated_from` is null for every roadmap created before migration 0012, and
 * null is treated as "unknown provenance" → no notice. That is the honest read:
 * we cannot show a user a definite claim about a row we never recorded. The
 * alternative (assume 'seed' and warn) would put a false warning on every old
 * AI-generated roadmap; assuming 'ai' would be a claim we equally can't support,
 * but it at least doesn't ASSERT anything to the user, which is why silence wins.
 */
export function templateMismatch(
  role: string | null | undefined,
  generatedFrom: string | null | undefined
): boolean {
  if (generatedFrom !== "seed") return false;
  return roleTrack(role) !== CATALOG_TRACK;
}

const WEAK_AREAS_BY_ROLE: Record<string, string[]> = {
  "SDE-2 · Frontend": [
    "Async JS",
    "Browser & rendering",
    "React internals",
    "Frontend system design",
    "Live coding speed",
    "Behavioral",
  ],
  "SDE-2 · Fullstack": [
    "Async JS",
    "React internals",
    "APIs & backend fundamentals",
    "Databases & SQL",
    "End-to-end system design",
    "Live coding speed",
    "Behavioral",
  ],
  // Backend (Phase 5). These names are chosen to line up with real `topic_area`
  // tags in the Phase 4.5 RAG corpus (backend, databases, distributed-systems,
  // api-design, dsa) so a backend roadmap's topic detail retrieves vetted docs
  // instead of falling through to the ungrounded rung.
  "SDE-2 · Backend": [
    "APIs & backend fundamentals",
    "Databases & SQL",
    "Distributed systems & scale",
    "Caching & messaging",
    "Data structures & algorithms",
    "Live coding speed",
    "Behavioral",
  ],
  "Senior · Frontend": [
    "Async JS",
    "Browser & rendering",
    "React internals",
    "Frontend system design",
    "Performance & Core Web Vitals",
    "Live coding speed",
    "Behavioral & leadership",
  ],
  "Staff · Frontend": [
    "Frontend system design at scale",
    "Architecture & trade-offs",
    "Performance & Core Web Vitals",
    "Technical strategy & roadmapping",
    "Cross-team influence",
    "Live coding speed",
    "Behavioral & leadership",
  ],
};

/** Internal so ONBOARDING_STEPS can call it before the public export is defined. */
function weakAreasForRoleInternal(role: string | null | undefined): string[] {
  const list = (role && WEAK_AREAS_BY_ROLE[role]) || WEAK_AREAS_BY_ROLE["SDE-2 · Frontend"];
  // "Not sure" is always last and always available — a candidate who doesn't yet
  // know where they're weak is a normal starting state, not an invalid answer,
  // and forcing a guess would front-load the plan around a guess.
  return [...list, NOT_SURE];
}

/** The weak-area options for a role. Unknown/absent role → the frontend default. */
export function weakAreasForRole(role: string | null | undefined): string[] {
  return weakAreasForRoleInternal(role);
}

/**
 * The weak areas actually declared — "Not sure" stripped out.
 *
 * Both generators read this rather than the raw answer, so "Not sure" means the
 * same thing everywhere: nothing to front-load, produce a balanced plan.
 */
export function declaredWeakAreas(weak: string[]): string[] {
  return weak.filter((w) => w !== NOT_SURE);
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "role",
    q: "What role are you targeting?",
    options: [
      "SDE-2 · Frontend",
      "SDE-2 · Fullstack",
      "SDE-2 · Backend",
      "Senior · Frontend",
      "Staff · Frontend",
    ],
  },
  {
    id: "bar",
    q: "What hiring bar are you aiming at?",
    options: ["Big tech (FAANG-tier)", "Late-stage startup", "Mid-size product co", "Not sure yet"],
  },
  {
    id: "timeline",
    q: "How long until your interviews?",
    // Month-scale options were added in Phase 4 for people prepping on a longer
    // runway. NOTE the parser has to understand the UNIT — "6 months" is 24 weeks,
    // and a first-integer-wins parser would have built a 6-week plan. See
    // parseTimelineWeeks in lib/seed/answers.ts.
    options: ["3 weeks", "5 weeks", "8 weeks", "12 weeks", "4 months", "6 months", "No date yet"],
  },
  {
    id: "hours",
    q: "Realistic study hours per week?",
    options: ["6h", "12h", "20h", "As much as it takes"],
  },
  {
    id: "weak",
    // Copy corrected in Phase 4. The old wording ("Where are you weakest? Pick all
    // that apply.") set the expectation that the plan would BE those areas, and the
    // first generator prompt obligingly made that true. Weak areas are a weighting:
    // they get more time and come first, but the plan still covers the role. The
    // question now says so, because a question that misdescribes what it controls is
    // a bug in the product, not just in the prompt.
    q: "Where are you weakest?",
    hint: "You'll still get a full plan — these just get more time, earlier.",
    multi: true,
    // Options here are a DEFAULT only. The real list depends on the role answered
    // in step 1 — see WEAK_AREAS_BY_ROLE / weakAreasForRole below. This array is
    // what an unrecognised role falls back to.
    options: weakAreasForRoleInternal(null),
  },
];
