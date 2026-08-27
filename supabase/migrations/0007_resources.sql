-- 0007_resources.sql
-- Phase 4.5: the RAG corpus — a global, hand-vetted table of real references,
-- searched by cosine similarity over pgvector embeddings.
-- Rule 12: raw SQL, checked in. Rule 5: see the RLS section below, which is the
-- deliberate exception — and is NOT what the earlier docs said it would be.
--
-- WHY THIS TABLE EXISTS AT ALL
-- Phase 4 generated topic resources from the model's memory. That is the one
-- surface in Prep with a genuine retrieval problem: a model asked for "the best
-- references for X" invents plausible titles and cites URLs that never existed
-- or have rotted. No amount of schema validation catches that, because a
-- hallucinated URL is perfectly well-formed. The only fix is to stop asking the
-- model to remember links and start asking it to RANK links we already vetted.
--
-- ---------------------------------------------------------------------------
-- THE EMBEDDING WIDTH — 1536, and the reason is a hard constraint, not a taste
-- ---------------------------------------------------------------------------
-- phases.md left this open with "confirm from a real embed() response". Probed
-- against the live gemini-embedding-001 endpoint (2026-08-13):
--
--   requested=default -> dim=3072  L2 norm=1.0000   (unit length)
--   requested=1536    -> dim=1536  L2 norm=0.7023   (NOT unit length)
--   requested=768     -> dim=768   L2 norm=0.5947   (NOT unit length)
--
-- The model's native width is 3072 and that is the highest-quality output. We
-- use 1536 anyway because **pgvector cannot build an HNSW (or IVFFlat) index on
-- a `vector` wider than 2000 dimensions.** At 3072 the choice would be a
-- sequential scan on every search forever, or storing `halfvec` (indexable to
-- 4096) at half precision. 1536 is a Matryoshka (MRL) truncation of the same
-- embedding — the leading dimensions carry the most information by construction,
-- so the quality loss is small and the vector stays indexable at full precision.
--
-- The second row of that table is why lib/rag/embedding.ts normalises: truncated
-- Gemini embeddings come back with norm < 1. Under `vector_cosine_ops` that is
-- harmless (cosine divides the magnitudes out, so ranking and the similarity
-- floor are both scale-invariant), but it stops being harmless the moment
-- someone switches the opclass to inner-product or L2. Normalising once at write
-- time costs nothing and removes that trap.

-- ---------------------------------------------------------------------------
-- pgvector. Supabase convention is to install extensions outside `public`, so
-- the type and the operator class are schema-qualified below.
-- ---------------------------------------------------------------------------
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- resources — the corpus. Global and shared, NOT per user: these are vetted
-- public references, so there is no `user_id` column to scope by and nothing
-- here is anyone's private data.
-- ---------------------------------------------------------------------------
create table if not exists public.resources (
  id          uuid primary key default gen_random_uuid(),
  topic_area  text not null,                 -- coarse curation tag, e.g. 'react'
  title       text not null,
  url         text not null unique,          -- a real, hand-vetted link
  -- Five kinds, one per resource chip the Topic screen already renders
  -- (Docs/Deep/Article/Talk/Spec), so a corpus row maps onto the UI without a
  -- lossy translation. Architecture.md §5b originally listed four and omitted
  -- 'deep'; that would have forced every deep-dive to be filed as 'article'.
  kind        text not null check (kind in ('doc', 'deep', 'article', 'talk', 'spec')),
  summary     text not null,                 -- what it covers — THIS is what gets embedded
  -- Nullable on purpose: the seed migration (0008) inserts the curated rows with
  -- no vector, and scripts/embed-corpus.ts fills them in through gateway.embed()
  -- afterwards. Splitting it that way keeps the corpus reviewable as plain SQL
  -- in git instead of as 40 unreadable 1536-float literals, and makes re-embedding
  -- after a model change a re-run rather than a new migration.
  embedding   extensions.vector(1536),
  created_at  timestamptz not null default now()
);

-- `url` is unique so the seed migration is safely re-runnable (on conflict do
-- nothing) and the same link can never be curated into the corpus twice — a
-- duplicate would occupy two of the k retrieval slots with one document.
create index if not exists resources_area_idx on public.resources (topic_area);

-- Approximate-nearest-neighbour index for the similarity search.
--
-- Be honest about this in an interview: at ~40 rows the planner will very
-- likely choose a sequential scan, and it should — an ANN index earns its keep
-- in the thousands, not the dozens. It is created now because the search
-- function is written against it and because adding it later to a live table is
-- the expensive version of this decision. What it buys is that the query does
-- not have to change when the corpus grows.
--
-- `vector_cosine_ops` because the query ranks by cosine distance (`<=>`).
-- Matching the opclass to the operator is what makes the index usable at all —
-- an L2 opclass simply would not be consulted by a `<=>` ORDER BY.
create index if not exists resources_embedding_idx on public.resources
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY — the deliberate Rule 5 exception, corrected.
--
-- Rules.md and Architecture.md §5b both described this as "the one table
-- WITHOUT RLS (reads are public-safe, writes are server-only)". Implementing it
-- that way would have been a security hole, and it is worth writing down why.
--
-- On Supabase, every table in `public` is granted select/insert/update/delete to
-- the `anon` and `authenticated` roles by default; RLS is the thing that then
-- narrows those grants. So "no RLS on a public table" does not mean read-only —
-- **it means world-writable with the anon key**. Anyone could have POSTed a row
-- into the vetted corpus, i.e. injected an arbitrary URL into the one list this
-- whole phase exists to make trustworthy. The stated intent ("writes are
-- server-only") would have been false in the exact way that matters.
--
-- So RLS is ENABLED, with a read policy whose predicate is `true`:
--   * SELECT  — allowed for everyone; this is shared public reference data.
--   * INSERT/UPDATE/DELETE — no policy exists, so RLS denies them to every
--     client. Curation happens through migrations and the service role.
--
-- The exception to Rule 5 is therefore precise: `resources` is the one table
-- with no `user_id` PREDICATE, not the one table with no RLS. That is the same
-- shape as ai_usage (0006) — read scope and write scope are separate questions —
-- with the read scope widened from "own rows" to "everyone" because the data is
-- public rather than personal.
-- ---------------------------------------------------------------------------
alter table public.resources enable row level security;

drop policy if exists "resources_read_all" on public.resources;
create policy "resources_read_all" on public.resources
  for select using (true);

-- Defence in depth, deliberately redundant with the missing write policies: if
-- a future migration ever adds a permissive `for all` policy by copy-paste from
-- the other tables, the grants still stop client writes. Same two-layer thinking
-- as study_sessions' CHECK constraint backing up the route's own validation.
revoke insert, update, delete on public.resources from anon, authenticated;

-- ---------------------------------------------------------------------------
-- match_resources — the retrieval query, as a database function.
--
-- It lives in SQL rather than in TypeScript because supabase-js cannot express
-- `order by embedding <=> $1` — the client library has no vocabulary for a
-- vector operator. Writing it here keeps the interesting part (the distance
-- operator, the floor, the ordering) as readable SQL in the repo instead of
-- hidden behind an ORM (Rule 12).
--
-- THE SIMILARITY FLOOR IS THE LOAD-BEARING ARGUMENT. A plain top-k always
-- returns k rows, however irrelevant — so a topic the corpus knows nothing about
-- ("STAR behavioral stories" against a React corpus) would still come back with
-- five confident-looking React links, and the Rule 9 "empty retrieval falls back
-- to generated/unverified" branch would be unreachable in practice. The floor is
-- what makes "we have nothing good for this" an expressible answer.
-- ---------------------------------------------------------------------------
create or replace function public.match_resources(
  query_embedding extensions.vector(1536),
  match_count     int   default 5,
  min_similarity  float default 0.55
)
returns table (
  id         uuid,
  topic_area text,
  title      text,
  url        text,
  kind       text,
  summary    text,
  similarity float
)
language sql
stable
-- SECURITY INVOKER (the default, stated explicitly): this function must not
-- carry the owner's rights. Phase 0 shipped a SECURITY DEFINER function that
-- Postgres had granted to `public` by default, making an internal routine
-- callable over RPC by anyone (see memory.md). Not repeating that.
security invoker
-- Pinned search_path, for the other half of that same Phase 0 bug: an unpinned
-- one is resolvable against a caller-controlled schema. `extensions` is on it
-- because that is where the vector type and the `<=>` operator live.
set search_path = public, extensions
as $$
  select r.id, r.topic_area, r.title, r.url, r.kind, r.summary,
         1 - (r.embedding <=> query_embedding) as similarity
  from public.resources r
  -- Rows seeded but not yet embedded must never surface: with a NULL embedding
  -- the distance is NULL, which would sort unpredictably and hand the grounding
  -- prompt a document with no demonstrated relevance to the topic.
  where r.embedding is not null
    and 1 - (r.embedding <=> query_embedding) >= min_similarity
  order by r.embedding <=> query_embedding
  limit match_count;
$$;

-- Least privilege: the route calls this with the caller's authenticated session.
-- Anonymous callers have no business running it — every AI route is auth-gated
-- (Rule 1), so retrieval should be too, even though the data it returns is public.
revoke execute on function public.match_resources(extensions.vector, int, float) from public, anon;
grant  execute on function public.match_resources(extensions.vector, int, float) to authenticated, service_role;
