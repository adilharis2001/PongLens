import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { AcceptInvite } from "./AcceptInvite";

export const metadata: Metadata = {
  title: "Coach invite",
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-arena flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-edge bg-surface p-8 text-center">
          {children}
        </div>
      </div>
    </main>
  );
}

export default async function CoachInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!UUID_RE.test(token)) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Invite not found</h1>
        <p className="mt-2 text-sm text-zinc-400">
          This invite link isn&apos;t valid. Ask for a fresh link.
        </p>
      </Shell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">You&apos;re invited</h1>
        <p className="mt-2 text-sm text-zinc-400">
          A player wants to share their table tennis matches with you on
          PongLens. Sign in to view them.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(`/coach-invite/${token}`)}`}
          className="glow-cta mt-6 inline-block w-full rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink"
        >
          Sign in to continue
        </Link>
      </Shell>
    );
  }

  const { data } = await supabase.rpc("coach_invite_info", { token });
  const info = Array.isArray(data) ? data[0] : data;

  if (!info) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Invite not found</h1>
        <p className="mt-2 text-sm text-zinc-400">
          This invite link isn&apos;t valid. Ask for a fresh link.
        </p>
      </Shell>
    );
  }

  if (info.is_own_invite) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">This is your invite link</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Send it to your coach. When they accept, they can watch your
          matches and leave notes.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block text-sm text-cyan-glow underline underline-offset-2"
        >
          Back to dashboard
        </Link>
      </Shell>
    );
  }

  if (info.accepted_by_me) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Already accepted</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {info.player_name}&apos;s matches are in your dashboard under
          &quot;Shared with me&quot;.
        </p>
        <Link
          href="/dashboard"
          className="glow-cta mt-6 inline-block w-full rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink"
        >
          Go to dashboard
        </Link>
      </Shell>
    );
  }

  if (info.status !== "pending") {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">
          {info.status === "revoked" ? "Invite revoked" : "Invite already used"}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          {info.status === "revoked"
            ? "The player revoked this invite. Ask them for a new link."
            : "Someone already accepted this invite. Ask the player for a new link."}
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-xl font-semibold">
        {info.player_name} shared{" "}
        {info.scope === "all" ? "their matches" : "a match"} with you
      </h1>
      <p className="mt-2 text-sm text-zinc-400">
        {info.scope === "all"
          ? "Accept to watch all their matches, point by point, and leave coach notes."
          : "Accept to watch this match, point by point, and leave coach notes."}
      </p>
      <AcceptInvite token={token} />
    </Shell>
  );
}
