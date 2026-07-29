import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { createClient } from "@/lib/supabase/server";
import { getSupportEmail } from "@/lib/config";
import { RedeemForm } from "./RedeemForm";

export const metadata: Metadata = {
  title: "Early access",
  robots: { index: false, follow: false },
};

/**
 * The gate. Signed-in accounts without an app_access row land here (see
 * middleware) and get in with an invite code. Coaches never need this
 * page: accepting a coach invite grants access on its own.
 */
export default async function EarlyAccessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const supportEmail = await getSupportEmail();

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
          <p className="mt-6 text-center text-xs leading-relaxed text-zinc-500">
            No code?{" "}
            <a
              href={`mailto:${supportEmail}`}
              className="text-zinc-300 underline underline-offset-2 hover:text-cyan-glow"
            >
              Ask us for one
            </a>
            .
          </p>
        </div>
        <p className="mt-6 text-center text-xs text-zinc-500">
          Signed in as {user.email}
        </p>
      </div>
    </main>
  );
}
