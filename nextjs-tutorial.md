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

## 7b. Two Supabase clients + a browser-driven OAuth flow *(added: Stage C Google)*

**What.** Because code runs in two places (server and browser), Prep has **two**
Supabase clients, and you pick the one for where your code executes:
- `lib/supabase/client.ts` → `createBrowserClient` — for **client components**
  (`"use client"`). Runs in the browser.
- `lib/supabase/server.ts` → `createServerClient` — for **server** code (server
  components, route handlers, server actions). Reads/writes the session via cookies.

**Why (as a React dev).** In a Vite SPA there's one client, always in the browser.
Here, "where does this line of code run?" is a real question — a server component
can't use the browser client (no `window`), and a client component can't use the
server client (no cookie store, no secrets). Same library, two entry points, chosen
by execution context.

**Where in Prep — the Google OAuth flow touches both + a route handler:**
1. **Browser** (`app/login/page.tsx`, client component): clicking "Continue with
   Google" calls `createClient()` (browser) → `supabase.auth.signInWithOAuth({
   provider: "google", options: { redirectTo: \`${window.location.origin}/auth/callback\` }})`.
   `window.location.origin` is only available in the browser — another reason this
   must be a client component.
2. The browser **navigates away** to Google's consent screen, then Google → Supabase
   → back to our app at **`/auth/callback?code=...`**.
3. **Server** (`app/auth/callback/route.ts`, a route handler — §6): reads the `code`,
   calls `createClient()` (server) → `exchangeCodeForSession(code)`, which sets the
   session **cookie**, then `NextResponse.redirect("/library")`.
4. Now the cookie exists, so **middleware** (§5) and the `(app)` **layout** (§2) see a
   logged-in user on the next request.

So one auth flow demonstrates the whole model: browser client kicks it off → route
handler on the server finishes it → cookie ties it together → server components read it.

**Contrast with email login:** email/password used a **server action** (§7) — no
browser redirect needed, the action talks to Supabase server-side directly. OAuth
*must* start in the browser (it's a full redirect to Google), so it uses the browser
client + a route handler instead. Two valid auth paths, two different Next primitives,
picked by the shape of the flow.

**Interview Q.** *"You're using Supabase on both client and server — how?"* → Two
clients from `@supabase/ssr`: a browser client for client components and a
cookie-based server client for server code; you pick by where the code runs. *"Walk me
through your Google login."* → Browser client calls `signInWithOAuth` with a
`redirectTo` of my `/auth/callback` route → user consents on Google → Supabase
redirects back with a `code` → my route handler exchanges it server-side for a session
cookie → redirect to `/library`, where the server components now see the user. *"Why is
email login a server action but Google a route handler?"* → OAuth is a browser redirect,
so it can't be a pure server action; email/password has no redirect so a server action
is simpler.

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

# Phase 1 concepts

Added when we built the roadmap experience on real DB data (Library, Onboarding,
Roadmap, Topic).

## 9. Dynamic route segments — `[id]`, and nested `[topicId]`

**What.** A folder named `[something]` is a *dynamic segment* — it matches any value
and hands it to the page as a param. Prep has two, one nested inside the other:

| File | URL |
|------|-----|
| `app/(app)/roadmap/[id]/page.tsx` | `/roadmap/<any-roadmap-id>` |
| `app/(app)/roadmap/[id]/topic/[topicId]/page.tsx` | `/roadmap/<id>/topic/<topicId>` |

**Why (as a React dev).** In React Router you'd write `path="/roadmap/:id"` and read
`useParams()`. Here the *folder name* is the param, and it's delivered to the server
component as a prop — no hook, resolved before render.

**The Next 15 gotcha:** `params` is now a **Promise** you must `await`:
```ts
export default async function RoadmapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;               // ← await, not params.id directly
```
The nested topic page awaits *both*: `const { id, topicId } = await params;`. If you
forget the `await`, TypeScript complains and `id` is `undefined` at runtime.

**Where in Prep.** [app/(app)/roadmap/[id]/page.tsx](app/(app)/roadmap/[id]/page.tsx)
uses `id` to fetch that one roadmap's weeks/topics; the topic page uses `topicId`.

**Interview Q.** *"How do dynamic routes work in the App Router?"* → A `[param]` folder
matches any segment; the value arrives as the `params` prop (a Promise in Next 15, so
you await it). Nesting `[id]/topic/[topicId]` gives you both params on the inner page.

## 10. Async server components that fetch the DB directly

**What.** A server component can be `async` and `await` a data call *in the component
body* — no `useEffect`, no loading state, no client fetch. The HTML arrives already
populated.

```ts
export default async function LibraryPage() {
  const supabase = await createClient();
  const { data: roadmaps } = await supabase.from("roadmaps").select("…, topics(status)");
  // …map to cards, then return JSX using them
}
```

**Why (as a React dev).** In Vite this would be `useEffect(() => fetch(...))` + a
spinner + a re-render. On the server there's no round-trip to the browser first: the
component *is* the data layer. The DB read happens where the DB is (the server),
under RLS, and only the finished HTML ships.

**One-round-trip embeds.** Supabase's `select("…, topics(status)")` pulls the child
rows in the same query (a join), so the Library computes `mastered/total` per roadmap
without an N+1. The Roadmap page does the same with `weeks(…, topics(…))`.

**Where in Prep.** [app/(app)/library/page.tsx](app/(app)/library/page.tsx),
[app/(app)/roadmap/[id]/page.tsx](app/(app)/roadmap/[id]/page.tsx).

**Interview Q.** *"How do you fetch data in a server component?"* → Just `await` it in
the async component body; the framework renders after the promise resolves. No client
fetch/effect. Good for anything the server can do under the user's RLS session.

## 11. `export const dynamic = "force-dynamic"` — opting out of caching

**What.** A route-segment config that forces the page to render **per request**,
never prerendered or cached.

**Why (as a React dev).** By default Next tries to be clever about caching. But
per-user data (my roadmaps, my mastery state) must *never* be shared or stale — if
Library got cached, user B could see user A's cards, or my new roadmap wouldn't show
after onboarding. `force-dynamic` says "always fresh, always for this request's user."

**Where in Prep.** Top of Library, Onboarding, Roadmap, Topic pages. (These read the
auth cookie anyway, which already makes them dynamic — the flag is belt-and-suspenders
and documents the intent.)

**Interview Q.** *"How do you make sure a page isn't cached across users?"* →
`export const dynamic = "force-dynamic"` on the segment; and reading cookies/headers
makes it dynamic regardless. Per-user pages must render per-request.

## 12. `notFound()` — the 404 escape hatch from a server component

**What.** Calling `notFound()` (from `next/navigation`) inside a server component
throws a special signal that renders the nearest `not-found` UI and returns a 404.

**Why (as a React dev).** No manual `if (!data) return <NotFound/>` + status juggling.
It's a control-flow throw the framework understands.

**Where in Prep.** Roadmap + Topic pages: `if (!roadmap) notFound();`. Crucially this
doubles as **authorization** — RLS means a stranger's roadmap id returns *no row*, so
`notFound()` fires. A user can't view someone else's roadmap; they just get a 404,
never a leaked record.

**Interview Q.** *"How do you 404 from a server component, and how does that interact
with your row security?"* → `notFound()`. Under RLS, another user's id returns zero
rows → same 404 path, so the security check and the not-found check are the same line.

## 13. Route Handlers as POST/DELETE APIs (with validation + status codes)

**What.** A `route.ts` exporting `POST`/`DELETE` is a real HTTP endpoint. Phase 0 used
one for OAuth callback (GET); Phase 1 adds mutating ones.

- `POST /api/roadmaps/generate` — validates the body, enforces the quota **server-side**
  (Rule 18), runs the seed generator, persists the tree, returns `{ id }` (201) or a
  typed error + status (400/401/403/500).
- `DELETE /api/roadmaps/[id]` — a dynamic segment on a *handler* (not a page); deletes
  under RLS so a forged id can only ever delete *your own* row.

**Why (as a React dev).** This is your Express/Fastify layer, but co-located with the
UI and sharing the same auth. The client `fetch("/api/roadmaps/generate", { method:
"POST", body })` and reads `res.ok` + the JSON.

**Why these are routes and not client writes:** quota enforcement can't be trusted to
the browser (Rule 18) — a user could just call the DB directly. So the *gated* writes
go through a handler that checks the cap before inserting. Plain owned writes (toggling
mastery, saving a note) *do* go direct via supabase-js under RLS — see the rule-of-thumb
in [Architecture.md §1](./Architecture.md).

**Where in Prep.** [app/api/roadmaps/generate/route.ts](app/api/roadmaps/generate/route.ts),
[app/api/roadmaps/[id]/route.ts](app/api/roadmaps/[id]/route.ts).

**Interview Q.** *"When does a write go through an API route vs straight to the DB?"* →
If its integrity can't be guaranteed client-side (quota, AI, anything privileged) it
needs a server route that verifies the session and the rule first. Owned rows under RLS
(my note, my mastery flag) can be written directly.

## 14. `router.refresh()` — re-running server components after a client write

**What.** `useRouter().refresh()` re-fetches the current route's **server** components
without a full reload, keeping client state.

**Why (as a React dev).** After I check a kill criterion (client write to `topics`),
the Roadmap/Library counts are computed on the *server* from the DB. `router.refresh()`
tells those server components to re-run so the new mastery count shows — the client-side
analog of "invalidate and refetch," but for server-rendered data.

**Where in Prep.** After mastery toggle in
[components/topic/TopicStudy.tsx](components/topic/TopicStudy.tsx) and after delete in
[components/library/RoadmapCard.tsx](components/library/RoadmapCard.tsx).

**Interview Q.** *"You wrote to the DB from a client component — how does the
server-rendered count update?"* → `router.refresh()` re-runs the server components for
the current route against fresh data, without losing client state or doing a hard reload.

---

## 15. Dynamic segments in a **Route Handler** — `app/api/recall/[cardId]/grade/route.ts` *(added: Phase 2)*

**What.** §9 covered `[id]` in a *page*; the same bracket-folder convention works in the
API layer, and it composes with static segments. The file
`app/api/recall/[cardId]/grade/route.ts` serves `POST /api/recall/<uuid>/grade` — a
dynamic segment (`[cardId]`) sandwiched between two static ones (`recall`, `grade`).
Params arrive the same way they do in a page, and in Next 15 they are **a Promise you
must await**:

```ts
export async function POST(
  request: Request,
  { params }: { params: Promise<{ cardId: string }> }
) {
  const { cardId } = await params;   // Next 15: params is async
  const body = await request.json(); // and the body is a separate await
}
```

**Why (as a React dev).** In an Express app you'd write `app.post('/api/recall/:cardId/grade')`
and read `req.params.cardId`. Next replaces the *route string* with the **folder path**,
so the URL shape is the directory tree — there is no route table to keep in sync, and no
ordering problem where one route accidentally shadows another. The `request`/`params`
split is the part worth noticing: `request` is a standard web `Request` (so `.json()` is
the platform API, not an Express-specific `body-parser`), while `params` is Next's own,
and in 15 it's async because a segment's value can depend on work the framework hasn't
finished yet.

**Where in Prep.**
[app/api/recall/[cardId]/grade/route.ts](app/api/recall/%5BcardId%5D/grade/route.ts) —
it awaits `params`, verifies the session, validates that `grade` is exactly
`"right" | "wrong"`, runs the scheduler, and writes the card's next state. Note the
deliberate asymmetry with Phase 1: notes/mastery are written *straight from the browser*
under RLS, but grading is a **route handler**, because the browser must not get to choose
its own `due_at`. RLS proves *whose* row it is; only the server can prove the *value* came
from the algorithm.

**Interview Q.** *"The recall card is the user's own row and RLS already protects it — so
why route the write through a server handler instead of writing it from the client like
you do for notes?"* → Because RLS answers "may this user write this row?", not "is this
the number the algorithm would have produced?". A client computing its own interval could
post a 10-year `due_at` and silently opt out of spaced repetition. So the rule isn't
"owned vs not-owned" — it's **whether the value being written is derived from a rule the
product has to guarantee**. Ownership → client + RLS; derived-and-enforced → server route.

**Interview Q (follow-up).** *"Why is `params` awaited?"* → Next 15 made `params`,
`searchParams`, `cookies()` and `headers()` async so the framework can start rendering
before those values are resolved. It's a breaking change from 14, and forgetting the
`await` gives you a Promise where you expected a string — which TypeScript catches only
if you type `params` as a `Promise<…>`, which is why the signature above is written out
explicitly.

---

## Concepts still to come (added as we build)

- **`generateMetadata` (dynamic titles per roadmap)** *(later — nice-to-have)*.
- **`loading.tsx` / Suspense streaming** *(Phase 5 polish)*.
- **`error.tsx` error boundaries** *(Phase 5)*.
- **`revalidatePath` / `revalidateTag`** — we use `router.refresh()` now; tag-based
  revalidation may come with heavier caching later.
- ~~**The SM-2 scheduling write path** — a route handler applying the algorithm~~ —
  **done in Phase 2, see §15** (dynamic segment in a route handler + why the write is
  server-side rather than client+RLS).
- **Streaming AI responses** *(Phase 4, maybe)*.
- **`next/font` / `next/image` optimizations** *(Phase 5)*.
