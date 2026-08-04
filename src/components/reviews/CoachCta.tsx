"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * The one quiet line that turns a free coach into a paid one. Shows only
 * to people without a coach profile, and stays dismissed forever via user
 * metadata (the first-steps-checklist pattern). No banners, no nagging.
 */
export function CoachCta({ compact = false }: { compact?: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || user.user_metadata?.coach_cta_dismissed) return;
      const { data: profile } = await supabase
        .from("coach_profiles")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (alive && !profile) setShow(true);
    };
    void check();
    return () => {
      alive = false;
    };
  }, []);

  async function dismiss() {
    setShow(false);
    await createClient()
      .auth.updateUser({ data: { coach_cta_dismissed: true } })
      .catch(() => {});
  }

  if (!show) return null;

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-2xl border border-edge bg-surface px-4 py-3 ${
        compact ? "" : "mt-4"
      }`}
    >
      <p className="text-sm text-zinc-400">
        You can offer paid reviews here too.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href="/coaching"
          className="rounded-full border border-cyan-glow/40 px-3.5 py-1.5 text-xs font-medium text-cyan-glow transition-colors hover:bg-cyan-glow/10"
        >
          See how
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="rounded-full p-1.5 text-zinc-600 hover:text-zinc-400"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
