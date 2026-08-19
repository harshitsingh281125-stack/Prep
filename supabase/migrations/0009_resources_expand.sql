-- 0009_resources_expand.sql
-- Phase 4.5: widen the RAG corpus from 48 to 83 entries, adding 3 new topic areas.
--
-- WHY THIS EXISTS — the corpus didn't cover the app's own output.
--
-- 0008 was curated against the SEED CATALOG's topic names (lib/seed/catalog.ts):
-- "Reconciliation & keys", "Event loop & microtasks", "debounce / throttle".
-- Those are the fallback curriculum. But the normal path is an AI-generated
-- roadmap, and real generated roadmaps range far wider than the catalog — a
-- "SDE-2 Frontend Prep: System Design & Speed" plan produced topics on CSP, XSS,
-- CSRF, TypeScript generics, utility types, tree-shaking, code splitting,
-- micro-frontends, monorepos, design tokens and cross-tab state, and the corpus
-- had **nothing** for any of them. Measured coverage on that roadmap: 52/64.
--
-- The lesson, which is the reusable part: a retrieval corpus has to be curated
-- against the DISTRIBUTION OF REAL QUERIES, not against the examples you had in
-- front of you while building it. I calibrated the similarity floor against
-- catalog names too (see lib/ai/config.ts) — same sampling mistake, caught
-- because the user ran it on their own roadmap.
--
-- Three new topic_areas, because these are genuinely distinct subject clusters
-- rather than long tails of existing ones:
--   security          — XSS/CSRF/CSP/CORS/SRI/Trusted Types
--   typescript        — the type-level questions interviewers actually ask
--   build-and-delivery— modules, bundling, code splitting, tree shaking, preload
-- Plus a fourth, accessibility, folded in as its own area for the same reason.
--
-- As with 0008: **every URL below was fetched and confirmed to return 200 at the
-- exact path written here (no redirect) before it was committed.** That check
-- caught five problems in this batch alone — a 404 (martinfowler.com/bliki/
-- MonolithicRepository.html), two silent redirects (Subresource_Integrity and the
-- design-tokens format moved), and two pages that 403 automated clients
-- (w3.org/WAI/ARIA/apg and TR/WCAG22 — real pages, but I cannot verify them the
-- way I verify the rest, so MDN equivalents are used instead rather than
-- weakening the standard).
--
-- After applying this, re-run: npm run embed:corpus   (new rows have no vector)
-- then re-check calibration:   npm run probe:retrieval

insert into public.resources (topic_area, kind, title, url, summary) values

-- =========================================================================
-- security — the frontend security round
-- =========================================================================
('security', 'doc',
 'MDN: Content Security Policy (CSP)',
 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP',
 'Restricting which scripts, styles and resources a page may load: directives, nonces and hashes, report-only mode, and how CSP is the second line of defence behind output encoding for cross-site scripting.'),

('security', 'doc',
 'MDN: Cross-site scripting (XSS)',
 'https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/XSS',
 'How untrusted input becomes executable script: stored, reflected and DOM-based XSS, why innerHTML and dangerouslySetInnerHTML are the usual entry points, and sanitization versus contextual output encoding.'),

('security', 'doc',
 'MDN: Cross-site request forgery (CSRF)',
 'https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/CSRF',
 'Forcing an authenticated user''s browser to submit a request they did not intend, and the mitigations: anti-CSRF tokens, SameSite cookies, and checking Origin and Referer headers.'),

('security', 'doc',
 'MDN: Set-Cookie and the SameSite attribute',
 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie',
 'Cookie attributes that decide security posture: HttpOnly, Secure, SameSite Strict/Lax/None, Domain and Path scoping, and how each one affects session hijacking and cross-site request forgery.'),

('security', 'doc',
 'MDN: Subresource Integrity',
 'https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Subresource_Integrity',
 'Pinning a cryptographic hash on a script or stylesheet loaded from a CDN, so a compromised third-party host cannot silently serve different code to your users.'),

('security', 'doc',
 'MDN: Trusted Types API',
 'https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API',
 'Making DOM XSS sinks like innerHTML refuse plain strings, so unsafe assignments fail loudly at the sink instead of relying on every call site to sanitize correctly.'),

('security', 'doc',
 'MDN: Cross-Origin Resource Sharing (CORS)',
 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS',
 'How the browser decides whether one origin may read another''s response: simple versus preflighted requests, the Access-Control headers, and why credentials change the rules.'),

-- =========================================================================
-- typescript — the type-level questions interviewers actually ask
-- =========================================================================
('typescript', 'doc',
 'TypeScript Handbook: Generics',
 'https://www.typescriptlang.org/docs/handbook/2/generics.html',
 'Type parameters, generic functions and classes, and constraints with extends — writing code that preserves the caller''s type instead of widening it to any.'),

('typescript', 'doc',
 'TypeScript Handbook: Utility Types (Pick, Omit, Partial, ReturnType)',
 'https://www.typescriptlang.org/docs/handbook/utility-types.html',
 'The built-in type transformations — Partial, Required, Pick, Omit, Record, ReturnType, Parameters, Awaited — and what each one is derived from.'),

('typescript', 'doc',
 'TypeScript Handbook: Narrowing and type guards',
 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html',
 'How control flow analysis narrows a union: typeof and instanceof guards, truthiness, the in operator, discriminated unions, user-defined type predicates, and exhaustiveness checking with never.'),

('typescript', 'doc',
 'TypeScript Handbook: Template literal types',
 'https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html',
 'Building string literal types from other types, with intrinsic Uppercase and Capitalize helpers and inference inside template patterns.'),

('typescript', 'doc',
 'TypeScript Handbook: Conditional types',
 'https://www.typescriptlang.org/docs/handbook/2/conditional-types.html',
 'Types that branch on a relationship, the infer keyword for extracting a type from another, and how conditional types distribute over unions.'),

('typescript', 'doc',
 'TypeScript Handbook: Everyday Types',
 'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html',
 'The base vocabulary: primitives, arrays, unions, type aliases versus interfaces, literal types, and the difference between any, unknown and never.'),

-- =========================================================================
-- build-and-delivery — modules, bundling, splitting, shipping less JS
-- =========================================================================
('build-and-delivery', 'doc',
 'MDN: JavaScript modules',
 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules',
 'ES modules: static import and export, dynamic import(), module scope and the deferred execution model. The static structure that makes bundler analysis such as tree shaking possible at all.'),

('build-and-delivery', 'doc',
 'webpack: Tree shaking',
 'https://webpack.js.org/guides/tree-shaking/',
 'Eliminating unused exports from the bundle: why it needs ES module syntax, what sideEffects in package.json declares, and why a module with side effects cannot be shaken out.'),

('build-and-delivery', 'doc',
 'webpack: Code splitting',
 'https://webpack.js.org/guides/code-splitting/',
 'Splitting a bundle into chunks loaded on demand: entry points, dynamic imports, shared-chunk deduplication, and route-based versus component-based splitting strategies.'),

('build-and-delivery', 'article',
 'web.dev: Reduce JavaScript payloads with code splitting',
 'https://web.dev/articles/reduce-javascript-payloads-with-code-splitting',
 'Why shipping one large bundle delays interactivity, and how splitting on routes and on interaction moves work off the critical path.'),

('build-and-delivery', 'doc',
 'MDN: rel=preload and resource hints',
 'https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload',
 'Telling the browser to fetch a resource early with the right priority — preload versus prefetch versus preconnect, the as attribute, and the cost of over-hinting.'),

('build-and-delivery', 'doc',
 'Vite: Building for production',
 'https://vite.dev/guide/build',
 'Production bundling with Rollup: chunk strategy and manual chunks, browser targets, asset handling, and library mode.'),

-- =========================================================================
-- frontend-system-design — client state, cross-tab, architecture at scale
-- =========================================================================
('frontend-system-design', 'doc',
 'MDN: Broadcast Channel API',
 'https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API',
 'Publish/subscribe messaging between tabs, windows and workers of the same origin. The direct answer to keeping state such as auth or theme synchronized across tabs.'),

('frontend-system-design', 'doc',
 'MDN: Window storage event',
 'https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event',
 'The event fired in OTHER tabs when localStorage changes — the classic cross-tab synchronization mechanism, including why it does not fire in the tab that made the change.'),

('frontend-system-design', 'doc',
 'MDN: Web Storage API',
 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API',
 'localStorage and sessionStorage: synchronous string-only access, per-origin quotas, lifetime differences, and why large or hot data belongs in IndexedDB instead.'),

('frontend-system-design', 'doc',
 'MDN: IndexedDB API',
 'https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API',
 'Asynchronous, transactional, indexed client-side storage for structured data at size — object stores, indexes, versioning and upgrade handling.'),

('frontend-system-design', 'article',
 'Martin Fowler: Micro Frontends',
 'https://martinfowler.com/articles/micro-frontends.html',
 'Decomposing a frontend into independently deployable pieces owned by separate teams: integration approaches, the shared-dependency and styling problems, and the coordination costs the pattern trades for autonomy.'),

('frontend-system-design', 'article',
 'monorepo.tools: understanding monorepos',
 'https://monorepo.tools/',
 'What a monorepo is and is not, versus polyrepo and versus a monolith: atomic cross-project changes, single-version dependency policy, task orchestration and caching, and where the approach starts to hurt.'),

('frontend-system-design', 'spec',
 'Design Tokens Format Module (W3C Community Group)',
 'https://www.designtokens.org/tr/drafts/format/',
 'The interchange format for design tokens — token types, values, aliasing and grouping — the vocabulary behind theming a design system across platforms.'),

-- =========================================================================
-- react — composition, context, lazy loading
-- =========================================================================
('react', 'doc',
 'react.dev: Passing Data Deeply with Context',
 'https://react.dev/learn/passing-data-deeply-with-context',
 'Context as an escape from prop drilling: how a provider scopes a value to a subtree, when context is the wrong tool, and why every consumer re-renders when the value identity changes.'),

('react', 'deep',
 'react.dev: Scaling Up with Reducer and Context',
 'https://react.dev/learn/scaling-up-with-reducer-and-context',
 'Combining a reducer with context to manage state for a whole screen, and splitting state and dispatch into separate contexts so dispatch consumers do not re-render on every state change.'),

('react', 'doc',
 'react.dev: lazy',
 'https://react.dev/reference/react/lazy',
 'Deferring a component''s code until it first renders, how it pairs with Suspense for a loading boundary, and why the import must be at module scope. Component-level code splitting in React.'),

('react', 'doc',
 'react.dev: Thinking in React',
 'https://react.dev/learn/thinking-in-react',
 'Decomposing a design into a component hierarchy, deciding what is state and what is derived, and choosing where each piece of state should live. The component-driven architecture method.'),

-- =========================================================================
-- accessibility — its own area; the corpus previously had none
-- =========================================================================
('accessibility', 'doc',
 'MDN: ARIA roles reference',
 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles',
 'The full set of ARIA roles and what each communicates to assistive technology, plus the first rule of ARIA: prefer a native element with built-in semantics over a role attribute.'),

('accessibility', 'deep',
 'MDN: Keyboard-navigable JavaScript widgets',
 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Keyboard-navigable_JavaScript_widgets',
 'Making custom controls keyboard operable: tabindex and roving tabindex, focus management, expected arrow-key behaviour, and the ARIA states a widget must keep in sync.'),

('accessibility', 'doc',
 'MDN: ARIA techniques and patterns',
 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Techniques',
 'Applied ARIA patterns for common widgets — dialogs, menus, tabs, live regions — with the roles, states and properties each pattern requires.'),

('accessibility', 'doc',
 'MDN: Understanding WCAG',
 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Understanding_WCAG',
 'The WCAG success criteria that apply to web development, organised by the four principles — perceivable, operable, understandable, robust — with the A/AA/AAA conformance levels explained.'),

('accessibility', 'doc',
 'MDN: Accessibility for web developers',
 'https://developer.mozilla.org/en-US/docs/Web/Accessibility',
 'The entry point for accessible frontend work: semantic HTML, the accessibility tree, assistive-technology behaviour, and how accessibility interacts with JavaScript-driven UI.')

on conflict (url) do nothing;
