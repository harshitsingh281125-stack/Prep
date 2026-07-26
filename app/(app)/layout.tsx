import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import type { SidebarUser } from "@/components/shell/Sidebar";
import { createClient } from "@/lib/supabase/server";

function initialsFrom(name: string, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return (letters || source[0] || "?").toUpperCase();
}

// All in-app screens share the sidebar + main frame. The auth gate lives in the
// root middleware; here we load the signed-in user's identity for the sidebar.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Defensive: middleware should have redirected already if unauthenticated.
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, track")
    .eq("id", user.id)
    .single();

  const email = user.email ?? "";
  const displayName = profile?.display_name?.trim() || email.split("@")[0] || "You";

  const sidebarUser: SidebarUser = {
    displayName,
    track: profile?.track ?? null,
    initials: initialsFrom(profile?.display_name ?? "", email),
  };

  return <AppShell user={sidebarUser}>{children}</AppShell>;
}
