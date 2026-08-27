-- 0010_resources_expand2.sql
-- Phase 4.5: widen the RAG corpus from 83 to 118 entries, adding 7 more areas.
--
-- WHY: after 0009 the user's own roadmap hit 100% coverage, so I stopped
-- measuring against one roadmap and probed topic names a DIFFERENT generated
-- roadmap would plausibly contain. That found the next tier of holes — the
-- corpus had nothing usable for testing, CSS layout, HTTP/networking, forms,
-- i18n, rendering strategy or error monitoring, and some queries were matching
-- above the floor onto documents that were simply the nearest thing present
-- ("GraphQL vs REST trade-offs" -> MDN: The WebSocket API; "Observability and
-- error monitoring" -> monorepo.tools). An above-floor-but-wrong match is worse
-- than a miss: a miss is labelled UNVERIFIED and honest, while a wrong match is
-- rendered as a vetted link with a green VERIFIED chip.
--
-- New areas: testing, css, networking, forms, i18n, rendering-strategy,
-- observability.
--
-- Same standard as 0008/0009: **every URL fetched and confirmed 200 at the exact
-- path written here, no redirect, before commit.** This batch caught EIGHT
-- silent redirects — MDN has reorganised its CSS documentation under
-- /Web/CSS/Guides/* (specificity, cascade, flexbox, grid, custom properties,
-- container queries, media queries all moved) and Next.js renamed its caching
-- page. Every one of those would have been a working link today that quietly
-- became a redirect chain, which is exactly the rot this corpus exists to avoid.
--
-- After applying: npm run embed:corpus   then   npm run probe:retrieval

insert into public.resources (topic_area, kind, title, url, summary) values

-- =========================================================================
-- testing
-- =========================================================================
('testing', 'doc',
 'Testing Library: React Testing Library',
 'https://testing-library.com/docs/react-testing-library/intro/',
 'Testing React components the way a user interacts with them rather than by reaching into implementation details, and why tests coupled to internals break on every refactor.'),

('testing', 'doc',
 'Testing Library: which query should I use?',
 'https://testing-library.com/docs/queries/about/',
 'The query priority order — accessible roles and labels first, test ids last — and how choosing queries by accessibility makes the test assert something the user can actually perceive.'),

('testing', 'deep',
 'Martin Fowler: The Practical Test Pyramid',
 'https://martinfowler.com/articles/practical-test-pyramid.html',
 'How to split a suite across unit, integration and end-to-end layers by cost and confidence, why the pyramid shape matters, and the ice-cream-cone anti-pattern of too many slow high-level tests.'),

('testing', 'doc',
 'Playwright: best practices',
 'https://playwright.dev/docs/best-practices',
 'Writing end-to-end tests that are not flaky: user-visible locators, web-first assertions with auto-waiting, test isolation, and why arbitrary timeouts are the usual cause of flake.'),

('testing', 'doc',
 'Playwright: network interception and mocking',
 'https://playwright.dev/docs/network',
 'Intercepting, stubbing and recording HTTP requests in end-to-end tests, so a test can exercise error and slow-network paths without depending on a real backend.'),

('testing', 'doc',
 'Vitest: mocking',
 'https://vitest.dev/guide/mocking',
 'Mocking modules, timers, network calls and globals in unit tests, and the trade-off between mocking a dependency and restructuring code so it can be injected instead.'),

('testing', 'doc',
 'Mock Service Worker: request interception',
 'https://mswjs.io/docs/',
 'Intercepting requests at the network layer rather than stubbing fetch, so the same mock definitions serve unit tests, end-to-end tests and local development.'),

-- =========================================================================
-- css
-- =========================================================================
('css', 'doc',
 'MDN: CSS specificity',
 'https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity',
 'How the browser scores selectors to decide which declaration wins: the id/class/type weighting, where inline styles and !important sit, and why specificity wars are a design smell.'),

('css', 'doc',
 'MDN: Introducing the CSS cascade',
 'https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction',
 'The order in which conflicting declarations are resolved — origin, cascade layers, specificity, source order — and how inheritance interacts with it.'),

('css', 'doc',
 'MDN: Basic concepts of flexbox',
 'https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Flexible_box_layout/Basic_concepts',
 'One-dimensional layout: main and cross axes, flex-grow/shrink/basis, alignment, and when flexbox is the right choice instead of grid.'),

('css', 'doc',
 'MDN: Basic concepts of grid layout',
 'https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Grid_layout/Basic_concepts',
 'Two-dimensional layout: explicit and implicit tracks, the fr unit, line-based placement, template areas, and how grid differs from flexbox in the problems it solves.'),

('css', 'doc',
 'MDN: Using CSS custom properties (variables)',
 'https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascading_variables/Using_custom_properties',
 'Declaring and consuming custom properties, how they inherit and cascade unlike preprocessor variables, fallbacks in var(), and their use as the substrate for runtime theming.'),

('css', 'doc',
 'MDN: Using container queries',
 'https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries',
 'Styling a component by the size of its container rather than the viewport — the primitive that makes a component genuinely reusable across layouts.'),

('css', 'doc',
 'MDN: Using media queries',
 'https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Using',
 'Responsive breakpoints and beyond: media types and features, range syntax, and user-preference queries such as prefers-color-scheme and prefers-reduced-motion.'),

-- =========================================================================
-- networking
-- =========================================================================
('networking', 'doc',
 'MDN: Evolution of HTTP',
 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Evolution_of_HTTP',
 'From HTTP/1.1 through HTTP/2 multiplexing and header compression to HTTP/3 over QUIC, and how each version changed the head-of-line blocking and connection-reuse story for frontend performance.'),

('networking', 'doc',
 'MDN: Using the Fetch API',
 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch',
 'Making requests with fetch: Request and Response objects, streaming bodies, why fetch does not reject on HTTP error status, aborting with a signal, and CORS mode.'),

('networking', 'doc',
 'MDN: HTTP request methods',
 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods',
 'GET, POST, PUT, PATCH, DELETE and the rest, with the properties that decide API design: safety, idempotency and cacheability.'),

('networking', 'doc',
 'MDN: HTTP response status codes',
 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status',
 'The full status taxonomy and what each class means for a client: which are retryable, which are cacheable, and the difference between 401 and 403 or 301 and 307.'),

('networking', 'doc',
 'GraphQL: introduction to GraphQL',
 'https://graphql.org/learn/',
 'Schema, queries, mutations and resolvers, and the trade-off against REST: fewer round trips and no over-fetching, at the cost of caching complexity and query-depth concerns.'),

('networking', 'doc',
 'MDN: AbortSignal.timeout()',
 'https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static',
 'Giving a request a deadline, combining signals, and the pattern behind timeout, retry and backoff strategies for unreliable networks.'),

-- =========================================================================
-- forms
-- =========================================================================
('forms', 'doc',
 'MDN: Client-side form validation',
 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms/Form_validation',
 'Built-in HTML validation attributes versus custom JavaScript validation, styling validity states, accessible error messaging, and why client-side validation never replaces server-side validation.'),

('forms', 'doc',
 'MDN: Constraint validation API',
 'https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Constraint_validation',
 'The programmatic side of form validity: validity states, setCustomValidity, checkValidity and reportValidity, for building custom validation on top of native semantics.'),

('forms', 'doc',
 'MDN: FormData',
 'https://developer.mozilla.org/en-US/docs/Web/API/FormData',
 'Building multipart form submissions programmatically, appending files and fields, and how FormData interacts with fetch and with controlled React inputs.'),

('forms', 'doc',
 'MDN: Using files from web applications',
 'https://developer.mozilla.org/en-US/docs/Web/API/File_API/Using_files_from_web_applications',
 'Reading user-selected files, drag-and-drop, object URLs and previews, and uploading with progress reporting.'),

-- =========================================================================
-- i18n
-- =========================================================================
('i18n', 'doc',
 'MDN: the Intl object',
 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl',
 'The built-in internationalization API: locale negotiation, and the formatters for dates, numbers, lists, plurals and relative time that remove the need for a formatting library.'),

('i18n', 'doc',
 'MDN: Intl.DateTimeFormat',
 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat',
 'Locale-aware date and time formatting, time zones, calendar systems, and formatToParts for building custom output without string surgery.'),

('i18n', 'doc',
 'MDN: Intl.NumberFormat',
 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat',
 'Locale-aware number, currency, percent and unit formatting, significant-digit control, and compact notation.'),

-- =========================================================================
-- rendering-strategy
-- =========================================================================
('rendering-strategy', 'article',
 'web.dev: Rendering on the web',
 'https://web.dev/articles/rendering-on-the-web',
 'The full spectrum — client-side rendering, static generation, server rendering, rehydration and streaming — compared on time to first byte, interactivity and complexity.'),

('rendering-strategy', 'doc',
 'react.dev: Suspense',
 'https://react.dev/reference/react/Suspense',
 'Declaring a loading boundary for a subtree that is not ready, how it composes with lazy and with data fetching, and how it enables streaming server rendering.'),

('rendering-strategy', 'doc',
 'Next.js: Server and Client Components',
 'https://nextjs.org/docs/app/getting-started/server-and-client-components',
 'Where each component runs, what crosses the boundary, why server components keep secrets and heavy dependencies off the client, and when to reach for "use client".'),

('rendering-strategy', 'doc',
 'Next.js: Caching and revalidating',
 'https://nextjs.org/docs/app/getting-started/caching',
 'The caching layers in the App Router — request memoization, the data cache, the full route cache — and how revalidation and dynamic rendering interact.'),

-- =========================================================================
-- observability
-- =========================================================================
('observability', 'doc',
 'MDN: Window error event',
 'https://developer.mozilla.org/en-US/docs/Web/API/Window/error_event',
 'Catching uncaught exceptions globally, what the event exposes, why cross-origin scripts report "Script error" without crossorigin, and how this underpins client error monitoring.'),

('observability', 'doc',
 'MDN: Window unhandledrejection event',
 'https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event',
 'Catching promise rejections nothing handled — the half of error reporting the window error event misses entirely.'),

('observability', 'doc',
 'MDN: PerformanceObserver',
 'https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver',
 'Subscribing to performance entries as they are recorded — long tasks, layout shifts, paint and navigation timings — which is how field metrics such as Core Web Vitals get collected from real users.'),

('observability', 'doc',
 'react.dev: Component and error boundaries',
 'https://react.dev/reference/react/Component',
 'Catching rendering errors in a subtree with componentDidCatch and getDerivedStateFromError, what error boundaries deliberately do not catch (events, async, server rendering), and where to place them.')

on conflict (url) do nothing;
