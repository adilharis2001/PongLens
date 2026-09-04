import "server-only";

import {
  GENERIC_INVITE,
  coachInvitePreview,
  studentInvitePreview,
  type CoachInviteScope,
  type InvitePreviewCopy,
} from "./invitePreview";

/**
 * Reads an invite for its link preview (169).
 *
 * Anon on purpose: WhatsApp and iMessage fetch a preview as strangers, so
 * there is no session to read through. The RPCs behind this answer for a
 * LIVE invite only and return a name and a scope — see the migration for
 * what they deliberately do not say.
 *
 * Never throws. A preview is decoration on a page that works without it,
 * so anything that goes wrong here degrades to the generic card rather
 * than taking the page with it.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** p_token, never token: coach_student_invites has a column of that name
 *  and a bare `token` parameter is shadowed by it. See migration 169. */
async function callRpc<T>(fn: string, token: string): Promise<T | null> {
  if (!UUID_RE.test(token)) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_token: token }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as T[] | null;
    return rows?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function coachInviteCopy(token: string): Promise<InvitePreviewCopy> {
  const row = await callRpc<{
    inviter_name: string;
    invited_name: string | null;
    scope: CoachInviteScope;
  }>("coach_invite_preview", token);
  if (!row) return GENERIC_INVITE;
  return coachInvitePreview({
    inviterName: row.inviter_name,
    invitedName: row.invited_name,
    scope: row.scope,
  });
}

export async function studentInviteCopy(
  token: string,
): Promise<InvitePreviewCopy> {
  const row = await callRpc<{
    inviter_name: string;
    invited_name: string | null;
  }>("student_invite_preview", token);
  if (!row) {
    return {
      ...GENERIC_INVITE,
      headline: "You're invited to PongLens",
      detail: "Your matches and your coach's notes, in one place.",
      title: "Student invite",
    };
  }
  return studentInvitePreview({
    inviterName: row.inviter_name,
    invitedName: row.invited_name,
  });
}
