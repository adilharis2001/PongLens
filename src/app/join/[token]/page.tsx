import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { JoinCoach } from "./JoinCoach";

export const metadata: Metadata = {
  title: "Join your coach",
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

/**
 * A coach's student invite (156). The mirror of /coach-invite: there a
 * player admits a coach, here a player joins one. Accepting is an explicit
 * button, not an auto-run — it hands the coach standing access to the
 * matches this player uploads, and that sentence deserves a reading before
 * the click.
 */
export default async function JoinPage({
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
          This invite link isn&apos;t valid. Ask your coach for a fresh link.
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
        <h1 className="text-xl font-semibold">Your coach is on PongLens</h1>
        <p className="mt-2 text-sm text-zinc-400">
          They keep lesson notes here and review matches. Sign in to connect
          with them — creating an account takes a minute.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(`/join/${token}`)}`}
          className="glow-cta mt-6 inline-block w-full rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink"
        >
          Sign in to continue
        </Link>
      </Shell>
    );
  }

  const { data } = await supabase.rpc("student_invite_info", {
    p_token: token,
  });
  const info = Array.isArray(data) ? data[0] : data;

  if (!info) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Invite not found</h1>
        <p className="mt-2 text-sm text-zinc-400">
          This invite link isn&apos;t valid. Ask your coach for a fresh link.
        </p>
      </Shell>
    );
  }

  if (info.is_own_invite) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">This is your invite link</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Send it to your student. When they join, their matches connect to
          your students list.
        </p>
        <Link
          href="/coaching"
          className="mt-6 inline-block text-sm text-cyan-glow underline underline-offset-2"
        >
          Back to coaching
        </Link>
      </Shell>
    );
  }

  if (info.status === "revoked") {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Invite revoked</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Your coach revoked this link. Ask them for a new one.
        </p>
      </Shell>
    );
  }

  if (info.already_linked) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">
          You&apos;re connected to {info.coach_name}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          They can see the matches you upload, and the notes they share land
          in your journal.
        </p>
        <Link
          href="/journal"
          className="glow-cta mt-6 inline-block w-full rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink"
        >
          Open your journal
        </Link>
      </Shell>
    );
  }

  // A brand-new account arrives here before the name step of onboarding,
  // and the coach's roster copies the name at the moment of joining (161).
  const needsName = !(
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    (user.user_metadata?.name as string | undefined)?.trim()
  );

  return (
    <Shell>
      <h1 className="text-xl font-semibold">
        {info.coach_name} invited you as a student
      </h1>
      <p className="mt-2 text-sm text-zinc-400">
        Lesson notes they share land in your journal. You choose which
        matches they can see.
      </p>
      <JoinCoach
        token={token}
        coachName={info.coach_name}
        needsName={needsName}
      />
    </Shell>
  );
}
