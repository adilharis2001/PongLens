import type { Metadata } from "next";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { SignOutButton } from "@/app/dashboard/SignOutButton";
import type { Match, Note, Point } from "@/lib/types";
import { MatchView } from "./MatchView";

export const metadata: Metadata = {
  title: "Match",
  robots: { index: false, follow: false },
};

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // RLS scopes all three queries to has_match_access(): the owner plus any
  // accepted coach (all-matches scope or this match specifically).
  const [matchRes, pointsRes, notesRes] = await Promise.all([
    supabase.from("matches").select("*").eq("id", id).single(),
    supabase
      .from("points")
      .select("*")
      .eq("match_id", id)
      .order("idx", { ascending: true }),
    supabase
      .from("notes")
      .select("*")
      .eq("match_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (matchRes.error || !matchRes.data) {
    notFound();
  }

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-edge/70 bg-ink/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Logo href="/dashboard" />
          <div className="flex items-center gap-4">
            {avatarUrl && (
              <Image
                src={avatarUrl}
                alt=""
                width={32}
                height={32}
                unoptimized
                className="rounded-full border border-edge"
              />
            )}
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="bg-arena flex-1">
        <MatchView
          match={matchRes.data as Match}
          initialPoints={(pointsRes.data ?? []) as Point[]}
          initialNotes={(notesRes.data ?? []) as Note[]}
          userId={user.id}
        />
      </main>
    </>
  );
}
