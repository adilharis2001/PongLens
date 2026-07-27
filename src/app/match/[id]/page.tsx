import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/AppNav";
import type {
  Match,
  Note,
  NoteAuthor,
  Point,
  PointTag,
  Tag,
} from "@/lib/types";
import { MatchView } from "./MatchView";

export const metadata: Metadata = {
  title: "Match",
  robots: { index: false, follow: false },
};

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // RLS scopes all three queries to has_match_access(): the owner plus any
  // accepted coach (all-matches scope or this match specifically).
  // match_note_authors is a SECURITY DEFINER lookup (auth.users is never
  // exposed to clients) that names each note author, so a player with two
  // coaches can tell their notes apart.
  const [matchRes, pointsRes, notesRes, authorsRes] = await Promise.all([
    supabase.from("matches").select("*").eq("id", id).single(),
    supabase
      .from("points")
      .select("*")
      .eq("match_id", id)
      .order("idx", { ascending: true }),
    supabase
      .from("notes")
      .select("*")
      .eq("match_id", id)
      .order("created_at", { ascending: true }),
    supabase.rpc("match_note_authors", { p_match_id: id }),
  ]);

  if (matchRes.error || !matchRes.data) {
    notFound();
  }

  // Point tags (035): the owner's vocabulary plus this match's
  // applications. Both are RLS-scoped (owner or accepted coach); the
  // vocabulary needs the owner id, so this waits for the match row.
  const [tagsRes, pointTagsRes] = await Promise.all([
    supabase
      .from("tags")
      .select("*")
      .eq("owner_id", matchRes.data.user_id)
      .order("created_at", { ascending: false }),
    supabase
      .from("point_tags")
      .select("point_id, tag_id, created_by, created_at, points!inner(match_id)")
      .eq("points.match_id", id),
  ]);

  // Cut strictness of the source job: the clip-edit UI needs it to map the
  // clip playhead back onto the source-video timeline (clips carry pre/post
  // context padding). Coaches can't read the owner's job row under RLS —
  // they fall back to "normal", and clip editing is owner-only anyway.
  let strictness = "normal";
  if (matchRes.data.job_id) {
    const { data: job } = await supabase
      .from("jobs")
      .select("options")
      .eq("id", matchRes.data.job_id)
      .maybeSingle();
    const s = (job?.options as { strictness?: string } | null)?.strictness;
    if (s) strictness = s;
  }

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  // The signed-in user's first name (Google auth display name). Name
  // fallbacks downstream (header title, share titles, PlayerTagging
  // auto-fill) use it so the app never has to ASK for the user's own name.
  const fullName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    "";
  const accountName = fullName.trim().split(/\s+/)[0] || null;

  // Whose match this is, by name, for viewers who are not the owner. Their
  // own account name is no help here, and the match's side names are only
  // filled in once the owner has been through side tagging — which is why a
  // coach's scoreboard used to read "Player". SECURITY DEFINER lookup gated
  // on the same match access RLS already grants them (migration 034).
  let ownerName: string | null = null;
  if (matchRes.data.user_id !== user.id) {
    const { data } = await supabase.rpc("match_owner_name", {
      p_match_id: id,
    });
    // First name only, to match how the app names the viewer everywhere else.
    ownerName = ((data as string | null) ?? "").trim().split(/\s+/)[0] || null;
  }

  // Same chrome as the rest of the signed-in app (bottom bar on mobile).
  // MatchView keeps its own wider content column, so we use AppNav directly
  // instead of AppShell; bottom padding clears the fixed mobile bar.
  return (
    <>
      <AppNav avatarUrl={avatarUrl} />
      <main className="bg-arena flex-1 pb-28 md:pb-16">
        <MatchView
          match={matchRes.data as Match}
          initialPoints={(pointsRes.data ?? []) as Point[]}
          initialNotes={(notesRes.data ?? []) as Note[]}
          userId={user.id}
          accountName={accountName}
          ownerName={ownerName}
          strictness={strictness}
          noteAuthors={(authorsRes.data ?? []) as NoteAuthor[]}
          initialTags={(tagsRes.data ?? []) as Tag[]}
          initialPointTags={(pointTagsRes.data ?? []).map(
            (r) =>
              ({
                point_id: r.point_id,
                tag_id: r.tag_id,
                created_by: r.created_by,
                created_at: r.created_at,
              }) as PointTag
          )}
        />
      </main>
    </>
  );
}
