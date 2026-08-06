import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { createClient } from "@/lib/supabase/server";
import { RedeemForm } from "./RedeemForm";
import { RequestInvite } from "./RequestInvite";

export const metadata: Metadata = {
  title: "Early access",
  robots: { index: false, follow: false },
};

/**
 * The gate. Signed-in accounts without an app_access row land here (see
 * middleware) and get in with an invite code. Coaches never need this
 * page: accepting a coach invite grants access on its own, and setting
 * up a coach page (/coaching/start) does too.
 */
export default async function EarlyAccessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: requestRow } = await supabase
    .from("access_requests")
    .select("status")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <main className="bg-arena flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-edge bg-surface p-8">
          <h1 className="text-center text-xl font-semibold">
            PongLens is invite-only right now
          </h1>
          <p className="mt-2 text-center text-sm leading-relaxed text-zinc-400">
            Enter your invite code to get started. Invited by a player as
            their coach? Open their invite link instead; it lets you straight
            in.
          </p>
          <RedeemForm />
          <div className="mt-6 border-t border-edge/60 pt-5">
            <RequestInvite
              initialStatus={
                (requestRow?.status as "pending" | "approved" | "denied") ??
                null
              }
            />
          </div>
          <p className="mt-5 border-t border-edge/60 pt-5 text-center text-sm text-zinc-400">
            Here to coach?{" "}
            <Link
              href="/coaching/start"
              className="text-cyan-glow hover:underline"
            >
              Set up your coach page
            </Link>{" "}
            and you&apos;re in.
          </p>
        </div>
        <p className="mt-6 text-center text-xs text-zinc-500">
          Signed in as {user.email}
        </p>
      </div>
    </main>
  );
}
