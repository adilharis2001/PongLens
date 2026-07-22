import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/share — create (or return) a public share link. Owner only.
 *
 *   { matchId }                    -> link to the whole match (cut video)
 *   { matchId, pointId }           -> link to one point
 *   { matchId, kind: 'starred' }   -> link to the currently-starred points
 *                                     (live: resolved at view time)
 *
 * Optional `title` (trimmed, capped at 80 chars, empty -> null): the
 * owner's headline for the public page and OG card. When the body carries
 * a title it is stored on create AND on the reuse path, so re-sharing an
 * existing link with a new title renames it.
 *
 * Returns { url, id, token, title }. Idempotent: an existing non-revoked
 * link for the same target is returned instead of minting a duplicate (a
 * partial unique index enforces one active link per target either way).
 *
 * Tokens are 32-char base64url from 192 random bits, generated here — the
 * database never invents tokens. Anyone with the URL can watch, so the
 * check is strict ownership (match.user_id), NOT has_match_access: coaches
 * may view a match but only the owner may publish it.
 */

const UUID_RE = /^[0-9a-f-]{36}$/i;

function shareBase(req: Request): string {
  // Canonical domain in prod; the request origin in dev so local
  // verification round-trips.
  if (process.env.NODE_ENV === "production") return "https://www.ponglens.com";
  return new URL(req.url).origin;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let matchId: string;
  let pointId: string;
  let requestedKind: string;
  let title: string | null = null;
  let titleProvided = false;
  try {
    const body = await req.json();
    matchId = String(body.matchId ?? "");
    pointId = String(body.pointId ?? "");
    requestedKind = String(body.kind ?? "");
    if ("title" in body) {
      titleProvided = true;
      title = String(body.title ?? "").trim().slice(0, 80).trim() || null;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (
    !UUID_RE.test(matchId) ||
    (pointId && !UUID_RE.test(pointId)) ||
    (requestedKind && !["point", "match", "starred"].includes(requestedKind)) ||
    (requestedKind === "starred" && pointId) ||
    (requestedKind === "point" && !pointId)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Strict ownership (not coach access).
  const { data: match } = await supabase
    .from("matches")
    .select("id, user_id")
    .eq("id", matchId)
    .maybeSingle();
  if (!match || match.user_id !== user.id) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  if (pointId) {
    const { data: point } = await supabase
      .from("points")
      .select("id, deleted")
      .eq("id", pointId)
      .eq("match_id", matchId)
      .maybeSingle();
    if (!point || point.deleted) {
      return NextResponse.json({ error: "Point not found" }, { status: 404 });
    }
  }

  const kind = pointId
    ? "point"
    : requestedKind === "starred"
      ? "starred"
      : "match";

  // Return the existing active link when there is one; a provided title
  // renames it (re-sharing is how the owner edits the headline).
  let existing = supabase
    .from("share_links")
    .select("id, token, title")
    .eq("match_id", matchId)
    .eq("kind", kind)
    .is("revoked_at", null);
  existing = pointId ? existing.eq("point_id", pointId) : existing;
  const { data: found } = await existing.limit(1);
  if (found && found.length > 0) {
    let storedTitle = found[0].title as string | null;
    if (titleProvided && title !== storedTitle) {
      const { error: renameError } = await supabase
        .from("share_links")
        .update({ title })
        .eq("id", found[0].id);
      if (!renameError) storedTitle = title;
    }
    return NextResponse.json({
      id: found[0].id,
      token: found[0].token,
      title: storedTitle,
      url: `${shareBase(req)}/s/${found[0].token}`,
    });
  }

  const token = randomBytes(24).toString("base64url"); // 192 bits, 32 chars
  const { data: created, error } = await supabase
    .from("share_links")
    .insert({
      owner: user.id,
      match_id: matchId,
      point_id: pointId || null,
      kind,
      token,
      title,
    })
    .select("id, token, title")
    .single();
  if (error || !created) {
    // 23505 = two requests raced on the active-link unique index; the other
    // one won, so hand back its link.
    if (error?.code === "23505") {
      const { data: raced } = await existing.limit(1);
      if (raced && raced.length > 0) {
        return NextResponse.json({
          id: raced[0].id,
          token: raced[0].token,
          title: raced[0].title ?? null,
          url: `${shareBase(req)}/s/${raced[0].token}`,
        });
      }
    }
    console.error("share create error:", error);
    return NextResponse.json(
      { error: "Could not create the link. Try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    id: created.id,
    token: created.token,
    title: created.title ?? null,
    url: `${shareBase(req)}/s/${created.token}`,
  });
}
