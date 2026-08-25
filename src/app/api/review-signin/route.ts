import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/review-signin — App Review's way in.
 *
 * Sign-in is an emailed six-digit code, and a reviewer cannot read our
 * mailboxes — apps get rejected on exactly this. So one account, named in
 * admin-only config, accepts one fixed code: the pair is checked here and
 * the route answers with the same one-time token a magic link carries,
 * which the app redeems through its normal verify path. To the reviewer
 * it is indistinguishable from the ordinary flow.
 *
 * The guardrails, in order of importance:
 *
 *  - The kill switch is the config itself. Blank either key (or delete
 *    it) and the door does not exist; the reviewer address falls back to
 *    being an ordinary account that needs its real emailed code. Turn it
 *    off once the app is approved.
 *  - Only the configured address can ever be minted for. The email is an
 *    equality check against config, never an input to generateLink from
 *    the caller's side.
 *  - Comparisons are constant-time and a failure costs a deliberate wait,
 *    so guessing the code is slow and tells you nothing about how close
 *    you were. The account behind it holds staged demo data only.
 *
 * The account is created on first successful use (confirmed, with a
 * display name), so nothing has to remember to provision it and deleting
 * it between review cycles is always safe.
 */

const REVIEWER_NAME = "PongLens Reviewer";

function equalConstantTime(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Same-shape work on the way to "no", so length is not a timing oracle.
    timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  const code = String(body.code ?? "").trim();
  if (!email || !code || email.length > 254 || code.length > 32) {
    return NextResponse.json({ code: "invalid" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("app_config")
    .select("key, value")
    .in("key", ["review_signin_email", "review_signin_code"]);
  const config = Object.fromEntries(
    (rows ?? []).map((r) => [r.key as string, String(r.value ?? "")])
  );
  const wantEmail = (config.review_signin_email ?? "").trim().toLowerCase();
  const wantCode = (config.review_signin_code ?? "").trim();
  if (!wantEmail || !wantCode) {
    return NextResponse.json({ code: "disabled" }, { status: 404 });
  }

  const ok =
    equalConstantTime(email, wantEmail) && equalConstantTime(code, wantCode);
  if (!ok) {
    await sleep(1500);
    return NextResponse.json({ code: "invalid" }, { status: 401 });
  }

  let link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: wantEmail,
  });
  if (link.error) {
    const { error: createError } = await admin.auth.admin.createUser({
      email: wantEmail,
      email_confirm: true,
      user_metadata: { full_name: REVIEWER_NAME },
    });
    if (createError && !String(createError.message).includes("already")) {
      console.error("review-signin create:", createError);
      return NextResponse.json({ code: "mint_failed" }, { status: 500 });
    }
    link = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: wantEmail,
    });
  }
  const tokenHash = link.data?.properties?.hashed_token;
  if (!tokenHash) {
    console.error("review-signin mint:", link.error);
    return NextResponse.json({ code: "mint_failed" }, { status: 500 });
  }
  return NextResponse.json({ tokenHash });
}
