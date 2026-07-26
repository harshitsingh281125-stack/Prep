import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// OAuth / email-confirmation callback: exchanges the `code` in the URL for a
// session cookie, then redirects into the app. Used by Google OAuth (added
// later) and by email confirmation links.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/library";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Something went wrong — send them back to login.
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
