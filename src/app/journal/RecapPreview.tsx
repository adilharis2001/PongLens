"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { LessonEdit } from "@/lib/lessonVideo/model";
import { recapHref } from "@/lib/lessonVideo/entries";
import { lessonRecapMinutes } from "@/lib/lessonVideo/presentation";

/**
 * The recap behind a shared entry, as a thing to press: the poster, how
 * long it is, and one link that opens it in this tab.
 *
 * The poster is a signed link, so it is fetched when the card is opened
 * rather than carried by the journal feed; a missing poster still leaves a
 * working link, the same as the lesson page.
 */
export function RecapPreview({ id }: { id: string }) {
  const [detail, setDetail] = useState<{ posterUrl?: string; video: { edit: LessonEdit | null } } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/lesson-video?id=" + id)
      .then(async (r) => {
        if (!r.ok) throw new Error("unavailable");
        const d = await r.json();
        if (active) setDetail(d);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [id]);

  const edit = detail?.video.edit;
  return (
    <Link
      href={recapHref(id)}
      onClick={(e) => e.stopPropagation()}
      className="group block overflow-hidden rounded-xl border border-edge bg-ink transition-colors hover:border-cyan-glow/50"
    >
      <div className="relative aspect-video w-full bg-surface-2">
        {detail?.posterUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={detail.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <span className="absolute inset-0 bg-black/10 transition-colors group-hover:bg-black/20" />
        <span className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 4.5v15l12-7.5z" />
          </svg>
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="text-sm font-medium text-zinc-100">Watch the recap</span>
        <span className="shrink-0 text-xs text-zinc-500">
          {edit ? `${edit.chapters.length} chapters · ${lessonRecapMinutes(edit)} min` : failed ? "Not available right now" : "Loading…"}
        </span>
      </div>
    </Link>
  );
}
