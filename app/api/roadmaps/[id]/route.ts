import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// DELETE /api/roadmaps/[id]
// Removes a roadmap (weeks/topics/notes cascade). Frees a quota slot (Rule 18).
// RLS guarantees the delete only touches the caller's own row, so a forged id for
// someone else's roadmap simply deletes nothing.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { error } = await supabase.from("roadmaps").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Could not delete." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
