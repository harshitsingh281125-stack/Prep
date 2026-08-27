-- 0008_resources_seed.sql
-- Phase 4.5: the hand-curated RAG corpus. 48 vetted references across 7 topic areas
-- (js-async 8, browser-rendering 8, react 8, frontend-system-design 7,
--  coding-craft 6, performance 6, behavioral 5).
--
-- HOW THIS LIST WAS BUILT, because it is the whole credibility of the feature:
-- it is hand-picked, not scraped and not model-generated, and **every URL in it
-- was fetched over HTTP and confirmed to return 200 before it was written here**
-- (2026-08-13). That check already earned its keep twice: one candidate
-- (staffeng.com/guides/getting-the-title/) turned out to be a 404 and was
-- dropped, and another redirected onto a URL already in the list, which the
-- `url unique` constraint would have rejected at insert time anyway.
--
-- Shipping a corpus of links "I'm confident are real" would have reproduced, by
-- hand, exactly the failure this phase exists to fix. Confidence is not a check.
--
-- Sources are deliberately weighted to primary references — MDN, the WHATWG HTML
-- standard, react.dev, an IETF RFC, web.dev — because those are the URLs least
-- likely to rot and the ones a candidate should be reading anyway.
--
-- `summary` is the field that gets EMBEDDED (not the title): it is written to
-- describe what the document covers in the vocabulary a topic name would use, so
-- that cosine similarity between "topic name + week + track" and this text is
-- meaningful. Titles alone are too short and too stylised to embed well.
--
-- `embedding` is left NULL here on purpose. `npm run embed:corpus` fills it in
-- through gateway.embed() (metered like every other AI call, Rule 11). Rows with
-- a NULL embedding are invisible to match_resources(), so a half-run backfill
-- degrades to "fewer hits", never to "wrong hits".
--
-- Re-runnable: `on conflict (url) do nothing` means applying this twice is a
-- no-op, and adding entries later means appending a migration, not editing this one.

insert into public.resources (topic_area, kind, title, url, summary) values

-- =========================================================================
-- js-async — the event loop, promises, async/await, ordering questions
-- =========================================================================
('js-async', 'doc',
 'MDN: JavaScript execution model (the event loop)',
 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Execution_model',
 'How JavaScript actually runs: the single call stack, the job queue, run-to-completion semantics, and how the event loop picks the next task. The reference for reasoning about asynchronous execution order.'),

('js-async', 'spec',
 'HTML Standard: event loops, task queues and microtask checkpoints',
 'https://html.spec.whatwg.org/multipage/webappapis.html#event-loops',
 'The normative specification of the browser event loop: task queues, the microtask queue, microtask checkpoints, and rendering opportunities. The authoritative answer to any question about setTimeout versus promise ordering.'),

('js-async', 'doc',
 'MDN: Using promises',
 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises',
 'Promise chaining, error propagation through then and catch, composition, and the common mistakes: nesting chains, swallowing rejections, and forgetting to return a promise from a handler.'),

('js-async', 'talk',
 'Jake Archibald — In The Loop (JSConf.Asia)',
 'https://www.youtube.com/watch?v=cCOL7MC4Pl0',
 'A visual walkthrough of the browser event loop: the call stack, tasks versus microtasks, requestAnimationFrame timing, and why a long synchronous task blocks rendering and input. The canonical explanation of loop ordering.'),

('js-async', 'article',
 'Tasks, microtasks, queues and schedules',
 'https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/',
 'A step-by-step trace of the exact order in which setTimeout callbacks, promise callbacks and mutation observers fire, and why the entire microtask queue drains between two macrotasks.'),

('js-async', 'doc',
 'MDN: Promise.all()',
 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all',
 'Concurrent promise combination: resolution with an ordered array of results, fail-fast rejection on the first rejected input, and the behaviour with empty and non-promise iterables. The basis of the reimplement-Promise.all exercise.'),

('js-async', 'doc',
 'MDN: async function',
 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function',
 'How async and await desugar to promises and continuations, why an async function always returns a promise, and how await suspends the function without blocking the event loop.'),

('js-async', 'deep',
 'MDN: Promise.allSettled(), and how it differs from all/any/race',
 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled',
 'Choosing between the four promise combinators: waiting for every outcome regardless of rejection, versus fail-fast, versus first-success, versus first-settled. The trade-off question interviewers actually ask.'),

-- =========================================================================
-- browser-rendering — the pixel pipeline, reflow/repaint, compositing
-- =========================================================================
('browser-rendering', 'doc',
 'MDN: Critical rendering path',
 'https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Critical_rendering_path',
 'The sequence from HTML and CSS bytes to painted pixels: DOM and CSSOM construction, render tree, layout, paint. What blocks first render and how to shorten the path.'),

('browser-rendering', 'article',
 'web.dev: Rendering performance',
 'https://web.dev/articles/rendering-performance',
 'The browser pixel pipeline — JavaScript, style, layout, paint, composite — and which of those stages each CSS property triggers. Explains why animating transform and opacity skips layout and paint entirely.'),

('browser-rendering', 'deep',
 'web.dev: Avoid large, complex layouts and layout thrashing',
 'https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing',
 'Forced synchronous layout: which DOM reads flush pending style changes, why interleaving reads and writes in a loop causes repeated reflow, and how batching them fixes it.'),

('browser-rendering', 'doc',
 'MDN: CSS containment',
 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment',
 'Using the contain property to bound the subtree a layout, paint or style recalculation can affect, so that a change in one component cannot force the whole document to reflow.'),

('browser-rendering', 'spec',
 'HTML Standard: update the rendering',
 'https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering',
 'The normative rendering step of the event loop: where requestAnimationFrame callbacks, resize and scroll events, intersection observations and the actual paint sit relative to tasks and microtasks.'),

('browser-rendering', 'doc',
 'MDN: Window.requestAnimationFrame()',
 'https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame',
 'Scheduling work immediately before the next repaint, why it is the correct primitive for animation instead of setTimeout, and how it behaves in background tabs.'),

('browser-rendering', 'article',
 'web.dev: Stick to compositor-only properties and manage layer count',
 'https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count',
 'Why transform and opacity can be animated by the compositor thread without layout or paint, how elements get promoted to their own layer, and the memory cost of promoting too many.'),

('browser-rendering', 'doc',
 'MDN: will-change',
 'https://developer.mozilla.org/en-US/docs/Web/CSS/will-change',
 'Hinting upcoming changes so the browser can optimise ahead of time, and why over-applying it is a performance regression rather than a win — the classic misuse question.'),

-- =========================================================================
-- react — reconciliation, keys, effects, concurrent rendering
-- =========================================================================
('react', 'doc',
 'react.dev: Preserving and Resetting State',
 'https://react.dev/learn/preserving-and-resetting-state',
 'How React decides whether to keep or discard a component''s state: same component type at the same position in the tree preserves state, and keys are how you deliberately force a reset.'),

('react', 'doc',
 'react.dev: Rendering Lists (and why keys matter)',
 'https://react.dev/learn/rendering-lists',
 'Rendering collections and choosing keys. Why array index keys break when items are reordered, inserted or removed, and how that surfaces as state attached to the wrong row.'),

('react', 'doc',
 'react.dev: Render and Commit',
 'https://react.dev/learn/render-and-commit',
 'The three phases of a React update — trigger, render, commit — and what actually touches the DOM in each. The mental model behind reconciliation and effect timing.'),

('react', 'doc',
 'react.dev: Synchronizing with Effects',
 'https://react.dev/learn/synchronizing-with-effects',
 'What useEffect is for, when it runs relative to paint, why the cleanup function exists, and how dependency arrays decide re-running. Covers the double-invocation of effects in development Strict Mode.'),

('react', 'deep',
 'react.dev: You Might Not Need an Effect',
 'https://react.dev/learn/you-might-not-need-an-effect',
 'Removing unnecessary effects: deriving values during render instead of syncing them in state, handling events in handlers rather than effects, and why chains of effects that set state are a bug pattern.'),

('react', 'doc',
 'react.dev: useTransition',
 'https://react.dev/reference/react/useTransition',
 'Marking a state update as a non-urgent transition so React can interrupt it to keep input responsive. The practical entry point to concurrent rendering and the urgent-versus-transition distinction.'),

('react', 'doc',
 'react.dev: useMemo',
 'https://react.dev/reference/react/useMemo',
 'Caching an expensive computation between renders, how it differs from useCallback, referential identity of dependencies, and when memoisation costs more than it saves.'),

('react', 'deep',
 'react.dev: Lifecycle of Reactive Effects',
 'https://react.dev/learn/lifecycle-of-reactive-effects',
 'Thinking about an effect as a synchronisation that starts and stops rather than a lifecycle callback, how reactive values become dependencies, and how to separate a re-synchronising effect from a one-off action.'),

-- =========================================================================
-- frontend-system-design — realtime, caching, feeds, offline
-- =========================================================================
('frontend-system-design', 'doc',
 'MDN: Using server-sent events',
 'https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events',
 'One-way server push over plain HTTP with EventSource: the event stream format, automatic reconnection with Last-Event-ID, and when SSE is the right choice instead of WebSockets.'),

('frontend-system-design', 'doc',
 'MDN: The WebSocket API',
 'https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API',
 'Full-duplex persistent connections: the upgrade handshake, message framing, and the trade-offs against polling and server-sent events for realtime features like live feeds and chat.'),

('frontend-system-design', 'doc',
 'MDN: HTTP caching',
 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching',
 'Cache-Control directives, freshness lifetime, revalidation with ETag and Last-Modified, and the difference between private, shared and immutable caching. The foundation of any client cache and invalidation design.'),

('frontend-system-design', 'spec',
 'RFC 9111: HTTP Caching',
 'https://www.rfc-editor.org/rfc/rfc9111.html',
 'The normative HTTP caching specification: how a cache stores, validates, invalidates and reuses responses, and the precise semantics of every Cache-Control directive.'),

('frontend-system-design', 'doc',
 'MDN: Intersection Observer API',
 'https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API',
 'Observing when an element enters the viewport without scroll handlers. The primitive behind infinite feeds, pagination triggers and lazy loading images below the fold.'),

('frontend-system-design', 'article',
 'web.dev: The offline cookbook (caching strategies)',
 'https://web.dev/articles/offline-cookbook',
 'A catalogue of client caching strategies — cache-first, network-first, stale-while-revalidate — and which one fits which kind of resource. The vocabulary for discussing client cache and invalidation.'),

('frontend-system-design', 'doc',
 'MDN: Service Worker API',
 'https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API',
 'The proxy between the page and the network: lifecycle, install and activate, intercepting fetch requests, and how it enables offline support and background sync.'),

-- =========================================================================
-- performance — Core Web Vitals and measurement
-- =========================================================================
('performance', 'article',
 'web.dev: Web Vitals',
 'https://web.dev/articles/vitals',
 'The Core Web Vitals set — Largest Contentful Paint, Interaction to Next Paint, Cumulative Layout Shift — their thresholds, and why field data differs from lab data.'),

('performance', 'article',
 'web.dev: Largest Contentful Paint (LCP)',
 'https://web.dev/articles/lcp',
 'What LCP measures, which element usually counts as the largest contentful paint, the four sub-parts of LCP time, and the common causes of a slow score.'),

('performance', 'article',
 'web.dev: Interaction to Next Paint (INP)',
 'https://web.dev/articles/inp',
 'Measuring responsiveness across the whole page lifetime: input delay, processing time and presentation delay, and why long tasks on the main thread are the usual cause of a poor score.'),

('performance', 'article',
 'web.dev: Cumulative Layout Shift (CLS)',
 'https://web.dev/articles/cls',
 'Quantifying visual stability: how layout shift score is computed from impact and distance fractions, session windows, and the standard fixes such as reserving space for images and ads.'),

('performance', 'doc',
 'MDN: Performance API',
 'https://developer.mozilla.org/en-US/docs/Web/API/Performance_API',
 'Measuring in the browser: high-resolution timestamps, performance marks and measures, PerformanceObserver, and the navigation and resource timing entries used to build a performance budget.'),

('performance', 'deep',
 'web.dev: Optimize long tasks',
 'https://web.dev/articles/optimize-long-tasks',
 'Breaking up work that blocks the main thread: yielding to the event loop, task chunking, scheduler.yield, and why moving work off the critical path matters more than making it faster.'),

-- =========================================================================
-- coding-craft — the from-scratch implementation primitives
-- =========================================================================
('coding-craft', 'doc',
 'MDN: Closures',
 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures',
 'How a function captures its lexical environment, the classic loop-variable capture problem, and using closures for private state. The mechanism behind hand-written debounce and throttle.'),

('coding-craft', 'doc',
 'MDN: setTimeout()',
 'https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout',
 'Timer semantics: the returned handle, clearTimeout, minimum nesting delay and clamping in background tabs, and why the delay is a minimum rather than a guarantee. The core of writing debounce and throttle from scratch.'),

('coding-craft', 'doc',
 'MDN: AbortController',
 'https://developer.mozilla.org/en-US/docs/Web/API/AbortController',
 'Cancelling in-flight asynchronous work with a signal: aborting fetch, removing event listeners by signal, and the standard cancellation pattern for race conditions in search-as-you-type.'),

('coding-craft', 'doc',
 'MDN: Equality comparisons and sameness',
 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness',
 'The four equality algorithms — loose, strict, SameValueZero and SameValue — and exactly where they disagree on NaN, zero and object identity. The basis of dependency and memo comparison.'),

('coding-craft', 'spec',
 'TC39: ECMAScript proposals',
 'https://github.com/tc39/proposals',
 'The staged list of language proposals with their current stage. How to answer whether a syntax feature is standard yet, and where the language is heading.'),

('coding-craft', 'doc',
 'MDN: Array.prototype.reduce()',
 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce',
 'Folding an array into a single value: accumulator semantics, the initial-value argument and the empty-array error, and reduce as the primitive underneath grouping and pipeline composition.'),

-- =========================================================================
-- behavioral — the non-coding rounds
-- =========================================================================
('behavioral', 'article',
 'Tech Interview Handbook: behavioral interview guide',
 'https://www.techinterviewhandbook.org/behavioral-interview/',
 'How behavioral rounds are actually evaluated, the STAR format for structuring an answer as situation, task, action and result, and how to prepare a small set of stories that cover most questions.'),

('behavioral', 'article',
 'Tech Interview Handbook: behavioral interview questions',
 'https://www.techinterviewhandbook.org/behavioral-interview-questions/',
 'The recurring behavioral question categories — conflict, failure, leadership, ambiguity, disagreement with a manager — with what each is really probing for.'),

('behavioral', 'article',
 'Tech Interview Handbook: questions to ask your interviewer',
 'https://www.techinterviewhandbook.org/final-questions/',
 'What to ask at the end of a loop, and how the questions you choose signal seniority and genuine evaluation of the team rather than eagerness.'),

('behavioral', 'deep',
 'StaffEng: guides to operating at staff level',
 'https://staffeng.com/guides/',
 'What staff-plus engineering work looks like in practice: scope, technical strategy, cross-team influence without authority, and how promotion decisions are actually made.'),

('behavioral', 'deep',
 'StaffEng: what a staff project is',
 'https://staffeng.com/guides/staff-projects/',
 'The shape of the visible, ambiguous, high-impact project that staff promotions typically hinge on, and how to find and lead one. Source material for scope and impact stories.')

on conflict (url) do nothing;
