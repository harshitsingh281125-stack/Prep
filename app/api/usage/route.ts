import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DAILY_CALL_CAP, MODELS, USAGE_WINDOW, billingMode, providerName } from "@/lib/ai/config";
import { summarize, type UsageRow } from "@/lib/ai/cost";
import { startOfUtcDay } from "@/lib/ai/gateway";

// GET /api/usage
// This user's AI usage: calls against the daily cap, token volume, cache
// hit-rate, and the paid-tier cost projection.
//
// Reads go through the normal user client under RLS, not the service-role
// client. `ai_usage` is SELECT-only for its owner (0006_ai_usage.sql), which is
// exactly enough to read your own numbers and not enough to forge them — so
// there is nothing privileged about this read and no reason to bypass RLS for
// it. The service role is reserved for the INSERT the gateway does.

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const dayStart = startOfUtcDay(new Date()).toISOString();

  // The cost breakdown aggregates a WINDOW of recent dispatches, not a lifetime
  // total — see USAGE_WINDOW. Naming it honestly is the point.
  const { data: rows, error } = await supabase
    .from("ai_usage")
    .select("route, tier, model, input_tokens, output_tokens, cached_input_tokens, cost_usd, status, attempts, created_at")
    .order("created_at", { ascending: false })
    .limit(USAGE_WINDOW);

  if (error) {
    return NextResponse.json({ error: "Could not load usage." }, { status: 500 });
  }

  const all = (rows ?? []) as (UsageRow & { created_at: string })[];
  const today = all.filter((r) => r.created_at >= dayStart);

  // Today's count comes from an exact COUNT, not from the windowed list above.
  // Deriving it from the window would under-report on a heavy day (the list is
  // capped), and this number is the one the user reads as "how much have I got
  // left" — it must agree with the cap the gateway actually enforces, which is
  // itself a COUNT. Enforcement was never wrong; the READOUT could have been.
  const { count: todayCount } = await supabase
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .gte("created_at", dayStart);

  const usedToday = todayCount ?? today.length;

  return NextResponse.json({
    cap: DAILY_CALL_CAP,
    usedToday,
    remainingToday: Math.max(0, DAILY_CALL_CAP - usedToday),
    provider: providerName(),
    billing: billingMode(),
    models: MODELS,
    today: summarize(today),
    // `recent`, not `allTime`: it aggregates at most USAGE_WINDOW dispatches.
    recent: summarize(all),
    window: USAGE_WINDOW,
    truncated: all.length >= USAGE_WINDOW,
  });
}
