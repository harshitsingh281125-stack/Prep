import { createBrowserClient } from "@supabase/ssr";

// Browser Supabase client — uses the ANON key only (Rule 2: the service-role key
// never reaches the browser). Used from client components for RLS-scoped reads
// and auth actions (sign in/out).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
