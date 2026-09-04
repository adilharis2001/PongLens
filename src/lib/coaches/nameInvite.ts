import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Put a name on a coach invite (164), or move an existing coach onto it.
 *
 * One implementation, because three web surfaces do it: creating an
 * invite, and naming one after the fact from either the Coaches section
 * or a match's share sheet. The iOS twin is `CoachingStore.nameInvite`.
 *
 * Find-or-create, never a blind insert. A player who already has
 * "Jonathan" in their journal and then invites Jonathan must end up with
 * ONE of him, or this makes the duplicate the whole feature exists to
 * remove. A row already bound to an account is never reused: hanging a
 * fresh invite off somebody's account would be wrong, and that person is
 * already connected anyway.
 *
 * Returns false when nothing was written, so a caller can say so.
 */
export async function nameCoachInvite(
  supabase: SupabaseClient,
  playerId: string,
  inviteId: string,
  rawName: string,
): Promise<boolean> {
  const name = rawName.trim().replace(/\s+/gu, " ").slice(0, 80);
  if (!name) return false;

  const { data: mine } = await supabase
    .from("player_coaches")
    .select("id, display_name, coach_id")
    .eq("player_id", playerId)
    .is("archived_at", null);

  const existing = (
    (mine as { id: string; display_name: string; coach_id: string | null }[]) ??
    []
  ).find(
    (c) =>
      c.coach_id === null &&
      c.display_name.trim().toLowerCase() === name.toLowerCase(),
  );

  if (existing) {
    const { error } = await supabase
      .from("player_coaches")
      .update({ invite_id: inviteId, display_name: name })
      .eq("id", existing.id);
    return !error;
  }

  const { error } = await supabase.from("player_coaches").insert({
    player_id: playerId,
    display_name: name,
    invite_id: inviteId,
  });
  return !error;
}

/**
 * What a waiting invite is called when nobody named it.
 *
 * Never a person's name and never something that reads like one: it sits
 * exactly where a coach's name goes, and "Invite link" there looks like a
 * coach called Invite Link (Adil, 2026-09-04). Saying it is unnamed is
 * also the prompt to name it.
 */
export const UNNAMED_INVITE = "Unnamed invite";
