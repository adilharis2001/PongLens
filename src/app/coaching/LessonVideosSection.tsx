"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { LessonVideo } from "@/lib/lessonVideo/model";

/** The same section/card rows used by the coaching roster and orders. */
export function LessonVideosSection({ studentId }: { studentId?: string }) {
  const [videos, setVideos] = useState<LessonVideo[]>([]);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const query = studentId ? `?studentId=${encodeURIComponent(studentId)}` : "";
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch(`/api/lesson-video${query}`);
        if (!response.ok) throw new Error("Could not load lesson videos");
        const data = await response.json();
        if (active) { setVideos(data.videos); setError(false); setLoaded(true); }
      } catch { if (active) { setError(true); setLoaded(true); } }
    }
    void load();
    const timer = setInterval(() => { void load(); }, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [query]);
  const row = "flex items-center justify-between gap-4 px-5 py-4 text-sm font-medium text-zinc-200 transition-colors hover:bg-surface-2";
  const chevron = <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" /></svg>;
  return (
    <section className="mt-8" aria-label="Lesson Videos">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Lesson Videos</h2>
      <div className="divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
        {videos.slice(0, 3).map(video => (
          <Link key={video.id} href={`/lesson-video/${video.id}`} className={row}>
            <span className="min-w-0">
              <span className="block">{video.edit?.title ?? video.original_name}</span>
              <span className="mt-0.5 block text-xs font-normal text-zinc-500">{video.status === "review" ? "Ready to review" : video.status === "ready" ? "Ready" : video.status === "failed" ? "Needs attention" : video.stage ?? "Preparing recap"}</span>
            </span>{chevron}
          </Link>
        ))}
        {videos.length === 0 && <p className="px-5 py-4 text-sm text-zinc-400">{!loaded ? "Loading…" : error ? "Could not load lesson videos." : "No lesson videos yet."}</p>}
        <Link href={`/coaching/videos${query}`} className={row}><span>{videos.length > 0 ? "All lesson videos" : "Import a lesson video"}</span>{chevron}</Link>
      </div>
    </section>
  );
}
