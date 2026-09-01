"use client";

import Link from "next/link";
import type { AudioImpactResearchAssignment } from "./types";

export function AudioImpactLabeler({
  initialAssignments,
}: {
  initialAssignments: AudioImpactResearchAssignment[];
  isAdmin: boolean;
}) {
  if (initialAssignments.length === 0) {
    return (
      <main className="min-h-screen bg-arena p-8 text-center text-zinc-100">
        <h1 className="text-2xl font-bold">No audio-impact assignments yet</h1>
        <p className="mt-2 text-zinc-400">
          The batch has not been seeded or assigned to this account.
        </p>
        <Link href="/research" className="mt-6 inline-block text-cyan-glow">
          Back to research
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-arena p-8 text-zinc-100">
      Audio-impact review is loading.
    </main>
  );
}
