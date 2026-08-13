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
 * The service-role client is typed against ONE table on purpose.
 *
 * It could have been left untyped (`any`) and allowed to touch anything. Naming
 * only `ai_usage` turns "the service role is for metering and nothing else" from
 * a convention into a compile error: reaching for `admin.from("roadmaps")` to
 * skip an RLS check you found inconvenient won't typecheck. Everything else in
 * this app goes through the anon-key client, under RLS, as it should.
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

type MeteringDatabase = {
  public: {
    Tables: {
      ai_usage: {
        Row: AiUsageRow;
        Insert: AiUsageInsert;
        Update: Partial<AiUsageInsert>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

let cached: ReturnType<typeof createSupabaseClient<MeteringDatabase>> | null = null;

export function createAdminClient() {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL missing — required for AI usage metering."
    );
  }

  cached = createSupabaseClient<MeteringDatabase>(url, key, {
    // No session, no cookie handling, no token refresh: this client is never
    // acting as a user. Persisting anything here would be a way for one
    // request's identity to leak into another's.
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
