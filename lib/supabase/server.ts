import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server Supabase client (Server Components, Route Handlers, Server Actions).
// Reads/writes the session from cookies. Uses the ANON key — RLS still applies,
// so this only ever sees the signed-in user's own rows. The service-role key is
// NOT used here (it's reserved for future privileged server code and must never
// be imported into anything that can reach the client).
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // called from a Server Component — safe to ignore; the middleware
            // refreshes the session cookie on the response instead.
          }
        },
      },
    }
  );
}
