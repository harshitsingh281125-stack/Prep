import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role Supabase client. Bypasses RLS entirely — treat every use as
// privileged code and scope the query by user_id yourself, because the database
// will no longer do it for you.
//
// Phase 4 is the first time this project needs one, for exactly one reason:
// `ai_usage` is deliberately SELECT-only under RLS (see 0006_ai_usage.sql). The
// daily cap is a COUNT of those rows, so if the browser could write them it
// could delete its own and reset the cap. Nobody but the server may insert, and
// "the server" means this client.
//
// The `import "server-only"` on line 1 is the enforcement, not a comment: if any
// client component ever pulls this module into its graph, the BUILD FAILS. Rule 6
// says the service-role key is server-only; this makes that a compiler error
// rather than a code-review habit.

/**
 * The service-role client is typed against an EXPLICIT LIST of tables, not `any`.
 *
 * That turns "the service role is for the tables no client may write" from a
 * convention into a compile error: reaching for `admin.from("roadmaps")` to skip
 * an RLS check you found inconvenient won't typecheck. Everything else in this
 * app goes through the anon-key client, under RLS, as it should.
 *
 * Phase 4.5 grew the list from one table to two, and the criterion is worth
 * stating because it is what keeps the list from growing further by habit:
 * a table belongs here **only if its RLS policy denies writes to every client**.
 *   - `ai_usage`  (Phase 4)   — SELECT-only for the owner; the daily cap is a
 *                               COUNT of these rows, so a writable table would
 *                               make the cap self-resettable.
 *   - `resources` (Phase 4.5) — SELECT-only for everyone; it is the vetted RAG
 *                               corpus, and a writable table would let anyone
 *                               inject a URL into the one list the product
 *                               promises is trustworthy.
 * In both cases the service role is not a convenience — it is the only writer
 * the schema permits.
 */
type AiUsageInsert = {
  user_id: string;
  route: string;
  tier: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cost_usd: number;
  status: string;
  attempts: number;
  latency_ms: number | null;
};

type AiUsageRow = AiUsageInsert & { id: string; created_at: string };

/**
 * The RAG corpus (Phase 4.5). Only `embedding` is ever updated through this
 * client — the rows themselves are curated in a checked-in SQL migration
 * (0008_resources_seed.sql), so that the list of URLs the product vouches for is
 * reviewable in a diff rather than mutable at runtime. The backfill script fills
 * in the vectors afterwards; see scripts/embed-corpus.ts.
 */
type ResourceRow = {
  id: string;
  topic_area: string;
  title: string;
  url: string;
  kind: string;
  summary: string;
  embedding: string | null;
  created_at: string;
};

type ServerWriteDatabase = {
  public: {
    Tables: {
      ai_usage: {
        Row: AiUsageRow;
        Insert: AiUsageInsert;
        Update: Partial<AiUsageInsert>;
        Relationships: [];
      };
      resources: {
        Row: ResourceRow;
        Insert: Omit<ResourceRow, "id" | "created_at">;
        Update: Partial<Pick<ResourceRow, "embedding">>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

let cached: ReturnType<typeof createSupabaseClient<ServerWriteDatabase>> | null = null;

export function createAdminClient() {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL missing — required for AI usage metering."
    );
  }

  cached = createSupabaseClient<ServerWriteDatabase>(url, key, {
    // No session, no cookie handling, no token refresh: this client is never
    // acting as a user. Persisting anything here would be a way for one
    // request's identity to leak into another's.
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
