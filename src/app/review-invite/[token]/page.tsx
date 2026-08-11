import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ClaimInvite } from "./ClaimInvite";

export const metadata: Metadata = {
  title: "Review invitation",
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /review-invite/<token> — a coach covered a review (096). Works logged
 * out like the coach-invite page: the info RPC is anon-callable and
 * reveals only who, what, and whether the link still works. Claiming
 * needs a session; the wall between the QA and live economies lives in
 * claim_sponsored_invite.
 */
export default async function ReviewInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!UUID_RE.test(token)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: info } = await supabase.rpc("sponsored_invite_info", {
    p_token: token,
  });
  const invite = info as {
    status: string;
    coach_name: string;
    offering_title: string;
    turnaround_days: number;
    order_id: string | null;
  } | null;
  if (!invite) notFound();

  // The claimer's own order: straight there, any time they reopen the link.
  if (invite.order_id) {
    redirect(`/orders/${invite.order_id}`);
  }

  return (
    <main className="bg-arena grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface p-6">
        <h1 className="text-lg font-semibold text-zinc-100">
          {invite.coach_name} is covering a review for you
        </h1>
        {invite.status !== "pending" ? (
          <p className="mt-3 text-sm text-zinc-400">
            This link is no longer active. Ask {invite.coach_name} for a new
            one.
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm text-zinc-400">
              {invite.offering_title}, at no cost to you. You send a match,
              and {invite.coach_name} usually turns a review around in{" "}
              {invite.turnaround_days}{" "}
              {invite.turnaround_days === 1 ? "day" : "days"}.
            </p>
            {user ? (
              <ClaimInvite token={token} />
            ) : (
              <Link
                href={`/login?next=/review-invite/${token}`}
                className="glow-cta mt-5 block rounded-full bg-cyan-glow px-5 py-2.5 text-center text-sm font-semibold text-ink"
              >
                Sign in to accept
              </Link>
            )}
          </>
        )}
      </div>
    </main>
  );
}
