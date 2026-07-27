# Next.js — Learning Doc (grounded in Prep)

> **Why this file exists.** I know React; Next.js is newer to me. This is a running
> tutorial that grows *as we build Prep*, so every concept is tied to a real file I
> wrote — not abstract theory. Goal: by the end of the project I can answer Next.js
> interview questions by pointing at actual code and explaining the *why*.
>
> **How to use it:** each concept has → **What / Why (as a React dev) / Where in Prep
> / Interview Q**. Read the "Where in Prep" file open next to it. If I can't explain
> a concept cold while looking at its file, it's not learned yet.
>
> Companion: [Architecture.md](./Architecture.md) (the app's design) ·
> [memory.md](./memory.md) (decisions) · [interview.md](./interview.md) (talk track).
> Concepts are added phase by phase; **§ headers note which phase introduced them.**

---

## 0. The one-paragraph mental model

Plain React (Vite/CRA) ships a bundle of JavaScript to the browser; the browser
then renders everything. **Next.js adds a server layer.** Components render on the
**server by default**, and only the pieces that need interactivity (state, effects,
event handlers) opt into being **client components**. On top of that, Next gives you
**file-based routing** (folders = URLs), a **build/deploy story** (Vercel), and
server-only primitives (route handlers, server actions, middleware) so secrets and
privileged logic never reach the browser. That server layer is *the* reason we chose
Next for Prep — see [Architecture.md §2](./Architecture.md).

---

# Phase 0 concepts

Everything below is already in the repo as of Phase 0.

## 1. The App Router & file-based routing

**What.** In the App Router, the `app/` directory *is* the routing table. A folder
is a URL segment; a `page.tsx` inside it makes that segment a visitable page.

| File | URL |
|------|-----|
| `app/page.tsx` | `/` |
| `app/login/page.tsx` | `/login` |
| `app/(app)/library/page.tsx` | `/library` |
| `app/(app)/recall/page.tsx` | `/recall` |

**Why (as a React dev).** In Vite you'd wire up React Router by hand with `<Route>`
elements. Here there's no router config — the filesystem is the config. Fewer moving
parts, and the framework can do routing work on the server.

**Where in Prep.** Look at the `app/` tree. `page.tsx` = a page. `layout.tsx` = shared
wrapper. `route.ts` = an API endpoint (not a page). Special filenames are the API.

**Reserved filenames to know:** `page.tsx` (a route's UI), `layout.tsx` (shared shell),
`route.ts` (HTTP handler / API), `loading.tsx`, `error.tsx`, `not-found.tsx`
(we'll add these in Phase 5 polish).

**Interview Q.** *"How does routing work in the App Router vs React Router?"* →
Filesystem-based: folders are segments, `page.tsx` makes a route. No central route
config; special files (`layout`, `loading`, `error`) attach behavior per segment.

---

## 2. Server Components vs Client Components (the big one)

**What.** In the App Router, **every component is a Server Component by default** —
it runs on the server, its code never ships to the browser, and it can do
server-only things (read cookies, hit the DB directly). A component becomes a
**Client Component** only when its file starts with the `"use client"` directive —
then it ships to the browser and can use `useState`, `useEffect`, `onClick`, etc.

**Why (as a React dev).** This is the biggest mental shift from Vite React, where
*everything* is a client component. Here you deliberately keep most of the tree on
the server (smaller JS bundle, can fetch data without an API round-trip) and only
"drop into" the client for interactivity. **The rule of thumb: server by default;
add `"use client"` only when you need state, effects, or browser event handlers.**

**Where in Prep.**
- **Server components:** `app/(app)/layout.tsx` (fetches the user from Supabase on
  the server — no `"use client"`), `app/(app)/library/page.tsx`, `Header.tsx`,
  `AppShell.tsx`. These render on the server and ship zero JS of their own.
- **Client components** (they start with `"use client"`): `ThemeToggle.tsx` (needs
  `useState` + `localStorage` + `onClick`), `Sidebar.tsx` (needs `usePathname` to
  highlight the active nav), `SignOutButton.tsx`, `app/login/page.tsx` (form state).

**Key pattern we use:** a server component can *render* a client component and pass
it data as props. `app/(app)/layout.tsx` (server) fetches the user, then renders
`<AppShell user={sidebarUser}>` → `<Sidebar user={...}>` (client). Data fetched on
the server, interactivity handled on the client. **You cannot go the other way** —
a client component can't directly `await` a DB call; it gets data via props or a
fetch to a route/action.

**Gotcha we hit:** props passed from a server component to a client component must be
**serializable** (plain data — strings, numbers, objects). You can't pass a function
or a class instance across that boundary. That's why the layout builds a plain
`SidebarUser` object rather than passing the Supabase client down.

**Interview Q.** *"What's a React Server Component and why does it matter?"* →
Renders on the server, code never reaches the browser → smaller bundle + can access
server resources (DB, secrets) directly. In Prep the `(app)` layout reads the signed-in
user server-side; only genuinely interactive leaves (theme toggle, active-nav sidebar)
are `"use client"`. *"How do you decide which is which?"* → Server unless it needs
state/effects/event-handlers/browser APIs.

---

## 3. Layouts & nested layouts

**What.** A `layout.tsx` wraps every `page.tsx` in its folder (and below). It renders
once and persists across navigations within its subtree; the changing page slots into
its `{children}`.

**Why (as a React dev).** It's the framework's version of "a shared shell around many
pages" — but the shell **doesn't re-render or lose state** when you navigate between
child pages. No manual `<Layout>` wrapper in every page.

**Where in Prep.**
- `app/layout.tsx` — the **root layout** (required). It renders `<html>`/`<body>`,
  imports `globals.css`, sets `<title>` via the `metadata` export, and injects the
  no-flash theme script. Everything in the app is inside it.
- `app/(app)/layout.tsx` — wraps only the in-app screens with the sidebar+header
  shell (`<AppShell>`), and fetches the user once for all of them. `/login` is
  *outside* this group, so it deliberately doesn't get the shell.

**Interview Q.** *"Difference between a layout and a page?"* → A page is the UI for one
route; a layout wraps a route *and its children* and persists across navigations
between them. *"Where does the root layout come in?"* → `app/layout.tsx`, required,
renders `<html>`/`<body>`, wraps the whole app.

---

## 4. Route Groups — `(app)`

**What.** A folder in parentheses like `(app)` groups routes **without adding a URL
segment**. `app/(app)/library/page.tsx` is still `/library`, not `/app/library`.

**Why.** It lets you apply a shared layout to a *subset* of routes without polluting
the URL. We want the sidebar shell around `/library`, `/recall`, `/progress` — but
**not** around `/login`. Grouping the shell'd routes under `(app)` gives them a
common `layout.tsx` while keeping their URLs clean.

**Where in Prep.** `app/(app)/layout.tsx` applies the `AppShell` to everything in the
group. `app/login/page.tsx` sits at the top level → no shell. That's the whole trick
behind "logged-in screens have the sidebar, the login page doesn't."

**Interview Q.** *"What's a route group and why use one?"* → Parenthesized folder that
groups routes under a shared layout without affecting the URL path. Used it to scope
the app-shell layout to the authenticated screens only.

---

## 5. `middleware.ts` — code that runs before every request

**What.** A single `middleware.ts` at the project root runs on the **edge, before**
the request reaches a page or route handler. It can rewrite, redirect, or attach
cookies. A `config.matcher` controls which paths it runs on.

**Why (as a React dev).** There's no equivalent in plain React — it's a server-layer
concept. It's the right place for cross-cutting concerns that must happen *before*
render: auth gating, session refresh, redirects.

**Where in Prep.** `middleware.ts` calls `updateSession()` in
`lib/supabase/middleware.ts`, which (a) refreshes the Supabase auth cookie on every
request and (b) enforces the **auth gate**: no session + hitting an app route →
redirect to `/login`; has session + hitting `/login` → redirect to `/library`. The
`matcher` excludes static assets so it doesn't run on every image/CSS file. This is
what makes `/library` a *gated* stub, and I verified it in prod (logged-out `/library`
302s to `/login`).

**Interview Q.** *"How do you protect routes in Next.js?"* → Middleware at the root
checks the session before the page renders and redirects unauthenticated users; it
also refreshes the auth token on every request. Defense-in-depth: the `(app)` layout
*also* re-checks `getUser()` server-side and redirects, so a page never renders for a
logged-out user even if middleware were bypassed.

---

## 6. Route Handlers — `route.ts` (the API layer)

**What.** A `route.ts` file exports functions named for HTTP verbs (`GET`, `POST`, …).
It's an API endpoint, not a page — the App Router's replacement for `pages/api`.

**Why.** Anything privileged (talks to secrets, must be trusted) lives server-side
behind a route. In Prep's architecture, AI calls / quota checks will be `route.ts`
handlers so the provider key never reaches the browser.

**Where in Prep.** `app/auth/callback/route.ts` — a `GET` handler that receives the
OAuth/email-confirmation `code` from Supabase, exchanges it for a session cookie, and
redirects into the app. It returns `NextResponse.redirect(...)`, not JSX, because it's
an endpoint. (Phase 4 will add `/api/roadmaps/generate` etc. as `POST` handlers.)

**Interview Q.** *"How do you build an API route in the App Router?"* → A `route.ts`
exporting `GET`/`POST` functions that take a `Request` and return a `Response`
(or `NextResponse`). Used one for the auth callback; the AI endpoints will be POST
handlers so the provider key stays server-only.

---

## 7. Server Actions — `"use server"`

**What.** A function marked `"use server"` runs **on the server** but can be called
directly from a client component (e.g. as a `<form action={...}>`). Next handles the
network round-trip for you — no manual `fetch`, no hand-written API route.

**Why (as a React dev).** In Vite React you'd write an Express/route endpoint and
`fetch()` it from a form's `onSubmit`. Server actions collapse that into one function:
you write the server logic, wire it to `<form action={fn}>`, and Next does the POST +
serialization behind the scenes.

**Where in Prep.** `app/login/actions.ts` starts with `"use server"` and exports
`signIn`, `signUp`, `signOut`. The login form (`app/login/page.tsx`, a client
component) uses them via `useActionState(action, ...)` and `<form action={formAction}>`.
`SignOutButton.tsx` wraps `signOut` in a `<form action={signOut}>`. These call
Supabase on the server, set the session cookie, then `redirect()`.

**Two helpers you'll see with them:**
- `redirect("/library")` (from `next/navigation`) — server-side redirect after success.
- `revalidatePath("/", "layout")` — tells Next to drop cached data for that path so the
  UI reflects the new auth state (e.g. the sidebar now shows the logged-in user).

**Interview Q.** *"What's a Server Action?"* → A `"use server"` function callable from
the client that executes on the server — lets a form mutate server state without a
hand-written API route. In Prep, sign-in/up/out are server actions that talk to
Supabase and set the session cookie. *"Server Action vs Route Handler?"* → Actions are
for form/mutation flows tightly coupled to a component; route handlers are standalone
HTTP endpoints (webhooks, callbacks, public APIs).

---

## 8. `next/link` & `usePathname` — client-side navigation

**What.** `<Link href="...">` navigates without a full page reload (client-side
transition, prefetched). `usePathname()` (a client hook) returns the current URL path.

**Why.** `<Link>` gives SPA-feel navigation while keeping server-rendered routes.
`usePathname` is how a client component knows "which route am I on" — e.g. to style the
active nav item.

**Where in Prep.** `Sidebar.tsx` uses `<Link>` for every nav item and `usePathname()`
to decide which one is `active` (elevated background + border). Because it needs that
hook, the sidebar is a client component — a concrete example of *why* something opts
into `"use client"`.

**Interview Q.** *"How do you do navigation and know the active route?"* → `<Link>` for
client-side transitions; `usePathname()` in a client component to compare against each
link's href and mark the active one.

---

## 9. `metadata` & environment variables (two smaller but asked-about bits)

**Metadata.** Exporting a `metadata` object (or `generateMetadata`) from a layout/page
sets `<title>`, description, etc. — the App Router's replacement for `react-helmet` /
manual `<head>` tags. See the `export const metadata` in `app/layout.tsx`.

**Env vars — the `NEXT_PUBLIC_` rule.** Server-only secrets (like
`SUPABASE_SERVICE_ROLE_KEY`) are readable only in server code. A variable is exposed to
the browser **only if its name starts with `NEXT_PUBLIC_`** (e.g.
`NEXT_PUBLIC_SUPABASE_URL`, the anon key). This naming convention is the guardrail that
keeps the service-role key off the client — see `lib/supabase/client.ts` (uses the
`NEXT_PUBLIC_` anon key) vs `lib/supabase/server.ts`. Real values live in `.env.local`
(gitignored); Vercel gets them as project env vars.

**Interview Q.** *"How do you keep a secret out of the browser bundle in Next?"* →
Only `NEXT_PUBLIC_`-prefixed env vars are inlined into client code; everything else is
server-only. The Supabase service-role key has no prefix, so it can never reach the
browser — the browser client uses the `NEXT_PUBLIC_` anon key under RLS.

---

## 10. Static vs Dynamic rendering (what the build output told us)

**What.** At build time Next decides, per route, whether it can be **prerendered as
static HTML** (`○`) or must be **server-rendered on demand** (`ƒ`, dynamic). Reading
cookies, headers, or user-specific data forces a route to be dynamic.

**Why it matters.** Static routes are cached/CDN-served (fast, cheap); dynamic routes
run per-request. You want to understand which of yours are which and *why*.

**Where in Prep.** In the `npm run build` output:
- `○ /login` is **static** — it's the same for everyone (auth happens via actions).
- `ƒ /library`, `ƒ /` , `ƒ /auth/callback` are **dynamic** — they became dynamic the
  moment they read the session cookie (via the Supabase server client / middleware).

**Interview Q.** *"What makes a route dynamic in Next.js?"* → Using request-time data —
cookies, headers, `searchParams`, or `no-store` fetches. Prep's `/library` is dynamic
because it reads the auth cookie to load the current user; `/login` stays static.

---

## Concepts still to come (added as we build)

- **Data fetching & caching** — `async` server components awaiting the DB, `fetch`
  caching, `revalidate`, `revalidateTag` *(Phase 1, when Library reads real roadmaps)*.
- **`loading.tsx` / Suspense streaming** *(Phase 1–5 polish)*.
- **`error.tsx` error boundaries** *(Phase 5)*.
- **Dynamic route segments** — `app/roadmap/[id]/page.tsx`, `params` *(Phase 1)*.
- **`generateMetadata` (dynamic titles per roadmap)** *(Phase 1)*.
- **Route handler POST APIs + request validation** *(Phase 4, the AI endpoints)*.
- **Streaming AI responses** *(Phase 4, maybe)*.
- **`next/font` / `next/image` optimizations** *(Phase 5)*.
