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
import { getCommerceEnabled } from "@/lib/config";
import { RAW_BUCKET, presignGet } from "@/lib/r2";
import { MatchView } from "./MatchView";
import { RawMatchView } from "./RawMatchView";

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
  // is_admin gates the serve-start label in Keep score (089). Same RPC the
  // research dashboard uses; false for everyone else, so the control never
  // renders for a normal viewer.
  const [matchRes, pointsRes, notesRes, authorsRes, adminRes] =
    await Promise.all([
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
      supabase.rpc("is_admin"),
    ]);

  if (matchRes.error || !matchRes.data) {
    notFound();
  }

  // Commerce (096): a raw library video — uploaded but not processed, mid
  // processing from a claim, or failed with its source still around — gets
  // the small raw view instead of the match experience. Legacy rows have
  // no raw_path and never come this way.
  const rawMatch = matchRes.data as Match;
  if (
    rawMatch.status === "uploaded" ||
    (rawMatch.raw_path != null &&
      (rawMatch.status === "processing" || rawMatch.status === "failed"))
  ) {
    const isOwner = rawMatch.user_id === user.id;
    let rawUrl: string | null = null;
    if (rawMatch.raw_path?.startsWith(`r2://${RAW_BUCKET}/`)) {
      try {
        rawUrl = await presignGet(
          RAW_BUCKET,
          rawMatch.raw_path.slice(`r2://${RAW_BUCKET}/`.length),
          { expiresSeconds: 6 * 3600, disposition: "inline" },
        );
      } catch (e) {
        console.error("raw presign failed:", e);
      }
    }

    let minutesBalance: number | null = null;
    let initialJob = null;
    const commerceEnabled = await getCommerceEnabled();
    if (isOwner) {
      const [stateRes, jobRes] = await Promise.all([
        commerceEnabled
          ? supabase.rpc("my_processing_state").single()
          : Promise.resolve({ data: null }),
        supabase
          .from("jobs")
          .select("id, status, progress, user_message")
          .filter("options->>match_id", "eq", id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const state = stateRes.data as { minutes_balance?: number } | null;
      if (typeof state?.minutes_balance === "number") {
        minutesBalance = state.minutes_balance;
      }
      initialJob = jobRes.data ?? null;
    }

    const rawAvatar =
      (user.user_metadata?.avatar_url as string | undefined) ??
      (user.user_metadata?.picture as string | undefined) ??
      null;
    return (
      <>
        <AppNav avatarUrl={rawAvatar} />
        <main className="bg-arena flex-1 pb-28 md:pb-16">
          <RawMatchView
            match={rawMatch}
            rawUrl={rawUrl}
            isOwner={isOwner}
            commerceEnabled={commerceEnabled}
            minutesBalance={minutesBalance}
            initialJob={initialJob}
          />
        </main>
      </>
    );
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

  // Owner's handedness labels the FH/BH corners of their half on the
  // serve map. RLS: readable by the owner and their accepted coaches.
  const { data: ownerProfile } = await supabase
    .from("player_profiles")
    .select("handedness")
    .eq("user_id", matchRes.data.user_id)
    .maybeSingle();

  // The owner's own "why I lost it" pills (060). Owner-keyed like tags, so
  // one problem counts once across every match; RLS scopes reads to the
  // owner and their accepted coaches.
  const { data: lossReasonLabels } = await supabase
    .from("loss_reason_labels")
    .select("id,label")
    .eq("owner_id", matchRes.data.user_id)
    .order("created_at", { ascending: true });

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
          ownerHandedness={
            (ownerProfile?.handedness as "right" | "left" | null) ?? null
          }
          userId={user.id}
          // Owner AND admin: the write needs the owner's UPDATE policy on
          // points, so an admin looking at someone else's match would only
          // see a control that fails.
          canLabelServeStart={
            Boolean(adminRes.data) && matchRes.data.user_id === user.id
          }
          accountName={accountName}
          ownerName={ownerName}
          strictness={strictness}
          noteAuthors={(authorsRes.data ?? []) as NoteAuthor[]}
          initialTags={(tagsRes.data ?? []) as Tag[]}
          initialLossReasonLabels={
            (lossReasonLabels ?? []) as { id: string; label: string }[]
          }
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
