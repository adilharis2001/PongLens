import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { StarredView } from "./StarredView";
import type { StarredPointRow } from "./starred";

export const metadata: Metadata = {
  title: "Starred points",
  robots: { index: false, follow: false },
};

/**
 * Every point the owner has starred, in one place (Account -> Your game).
 *
 * The whole set arrives here, server-side, in one call: starred_points()
 * (134) returns one small row per star with its display number already
 * computed, so the page paints with content instead of a spinner and
 * there is no list to paginate. What IS lazy is the media — posters are
 * one cached request per match, clips are minted only when a tile is
 * hovered or the player opens.
 */
export default async function StarredPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data } = await supabase.rpc("starred_points");
  // The owner's own "why I lost it" pills (060). Stored on a point as
  // `custom:<id>`, so without this map a tile prints the id.
  const { data: reasonLabels } = await supabase
    .from("loss_reason_labels")
    .select("id,label")
    .eq("owner_id", user.id);
  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  return (
    <AppShell avatarUrl={avatarUrl}>
      <StarredView
        initialRows={(data ?? []) as StarredPointRow[]}
        reasonLabels={(reasonLabels ?? []) as { id: string; label: string }[]}
      />
    </AppShell>
  );
}
