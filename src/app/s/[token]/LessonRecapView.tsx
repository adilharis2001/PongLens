"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LessonChapter } from "@/lib/lessonVideo/model";
import {
  lessonChapterIndexAt,
  lessonChapterStart,
} from "@/lib/lessonVideo/presentation";
import { shareFileSize } from "@/lib/lessonVideo/shareFile";
import type { PublicLessonChapter } from "./shareData";

/**
 * Client half of a shared lesson recap.
 *
 * What plays here is the CLEAN video with the chapter text drawn by the
 * page, exactly how the apps show it, so nothing has to be rendered
 * between a coach creating a link and it working. The download is the
 * other copy, the one with the words burnt into the picture, and the
 * server only names it while it still matches the recap's current
 * wording — so "no download key" means the control is simply absent. A
 * stranger is never told a file is behind.
 *
 * Media never reaches the HTML: the browser asks /api/share/media for a
 * short-TTL presigned URL with the token as its only credential, so a
 * revoked link dies for a page someone kept open.
 */

async function mediaUrl(
  token: string,
  what: "video" | "poster" | "download",
): Promise<string | null> {
  try {
    const qs = new URLSearchParams({ token, what });
    const res = await fetch(`/api/share/media?${qs.toString()}`);
    const data = res.ok ? await res.json() : null;
    return typeof data?.url === "string" ? data.url : null;
  } catch {
    return null;
  }
}

/**
 * One of the two lists that bracket a recap: what the lesson set out to
 * improve, and what to practise afterwards. The same words the video draws
 * on its first and last cards. A lesson that stated neither renders
 * neither, never a heading with nothing under it.
 */
function FocusList({ heading, lines }: { heading: string; lines: string[] }) {
  if (!lines.length) return null;
  return (
    <section>
      <h2 className="px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {heading}
      </h2>
      <ul className="mt-2 space-y-1.5">
        {lines.map((line, index) => (
          <li
            key={index}
            className="flex gap-3 px-3 text-sm leading-relaxed text-zinc-300"
          >
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
            <span className="min-w-0 flex-1">{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LessonRecapView({
  token,
  chapters,
  goals,
  workOn,
  canDownload,
  downloadBytes,
}: {
  token: string;
  chapters: PublicLessonChapter[];
  /** Both empty when the lesson stated neither, which renders as nothing. */
  goals: string[];
  workOn: string[];
  /** The server found a current downloadable file. */
  canDownload: boolean;
  downloadBytes: number | null;
}) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [chapter, setChapter] = useState(0);
  const [preparing, setPreparing] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Where playback had got to at the last tick, and whether it was
  // running. Read after a media error, when the element's own clock has
  // already reset to zero.
  const lastTime = useRef(0);
  const wasPlaying = useRef(false);
  // A signed URL lasts an hour, so a long watch can outlive it. One
  // silent re-mint, on the element's error event and nowhere else: no
  // timer, and a second failure is a real failure.
  const reminted = useRef(false);
  const resumeAt = useRef<{ time: number; playing: boolean } | null>(null);

  /**
   * The chapters in the shape the shared helpers read. A public payload
   * carries only the summary clock, so the source timings stand in for it
   * — which keeps `lessonChapterStart`'s fallback (the running total of
   * the chapters before this one) arriving at the same answer when a
   * recap predates the clock being stored.
   */
  const timed: LessonChapter[] = useMemo(
    () =>
      chapters.map((c) => ({
        title: c.title,
        cues: c.cues,
        start_s: 0,
        end_s: Math.max(0, (c.summary_end_s ?? 0) - (c.summary_start_s ?? 0)),
        ...(c.summary_start_s === null
          ? {}
          : { summary_start_s: c.summary_start_s }),
        ...(c.summary_end_s === null ? {} : { summary_end_s: c.summary_end_s }),
      })),
    [chapters],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const url = await mediaUrl(token, "video");
      if (cancelled) return;
      if (url) setVideoUrl(url);
      else setError("Couldn't load the video. Try again shortly.");
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const url = await mediaUrl(token, "poster");
      if (!cancelled && url) setPosterUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // A <video> removed from the document keeps playing, with sound.
  useEffect(() => {
    const v = videoRef.current;
    return () => v?.pause();
  }, []);

  // A fresh address after a re-mint: reload the element, then put the
  // playhead back where the viewer left it (onLoadedMetadata below).
  useEffect(() => {
    if (!videoUrl || !resumeAt.current) return;
    videoRef.current?.load();
  }, [videoUrl]);

  const play = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setStarted(true);
    void v.play().catch(() => {});
  }, []);

  const goToChapter = useCallback(
    (index: number) => {
      const start = lessonChapterStart(timed, index);
      if (start === null) return;
      setChapter(index);
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = start;
      lastTime.current = start;
      setStarted(true);
      void v.play().catch(() => {});
    },
    [timed],
  );

  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    lastTime.current = v.currentTime;
    wasPlaying.current = !v.paused;
    const index = lessonChapterIndexAt(timed, v.currentTime);
    setChapter((current) => (current === index ? current : index));
  }, [timed]);

  const onMediaError = useCallback(() => {
    if (reminted.current) {
      setError("Couldn't load the video. Try again shortly.");
      return;
    }
    reminted.current = true;
    resumeAt.current = {
      time: lastTime.current,
      playing: wasPlaying.current,
    };
    void (async () => {
      const url = await mediaUrl(token, "video");
      if (url) setVideoUrl(url);
      else setError("Couldn't load the video. Try again shortly.");
    })();
  }, [token]);

  const onLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    const target = resumeAt.current;
    if (!v || !target) return;
    resumeAt.current = null;
    v.currentTime = Math.max(
      0,
      Math.min(target.time, Math.max(0, v.duration - 0.1)),
    );
    if (target.playing) void v.play().catch(() => {});
  }, []);

  const download = useCallback(async () => {
    setPreparing(true);
    const url = await mediaUrl(token, "download");
    setPreparing(false);
    if (url) window.location.href = url;
  }, [token]);

  const size = shareFileSize(downloadBytes);

  return (
    <div className="lg:flex lg:items-start lg:gap-6">
      <div className="lg:min-w-0 lg:flex-1">
        {/* Media-first: edge to edge on a phone, where a rounded card in a
            padded column only makes the picture smaller. */}
        <div className="relative aspect-video w-full overflow-hidden border-y border-edge bg-black sm:rounded-2xl sm:border">
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              poster={posterUrl ?? undefined}
              // Idle, the browser paints its own play button and scrubber
              // over the picture. The controls arrive with playback.
              controls={started}
              playsInline
              preload="metadata"
              className="h-full w-full object-contain"
              onPlay={() => setStarted(true)}
              onTimeUpdate={onTimeUpdate}
              onLoadedMetadata={onLoadedMetadata}
              onError={onMediaError}
            />
          ) : error ? null : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-zinc-600">Loading…</p>
            </div>
          )}

          {/* Drawn OVER the picture rather than instead of it: a URL that
              lapsed mid-watch has a video element sitting there, and
              swapping the element out for a sentence would take the last
              frame away as well. */}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-ink/90 px-6">
              <p className="text-center text-sm text-red-300">{error}</p>
            </div>
          )}

          {videoUrl && !started && !error && (
            <button
              type="button"
              onClick={play}
              aria-label="Play the recap"
              className="absolute inset-0 flex items-center justify-center bg-ink/20 transition-colors hover:bg-ink/10"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full border border-white/20 bg-ink/70 backdrop-blur-sm">
                <svg
                  viewBox="0 0 24 24"
                  className="ml-1 h-7 w-7"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M8 5v14l11-7L8 5Z" />
                </svg>
              </span>
            </button>
          )}
        </div>

        {canDownload && (
          <div className="mt-4 px-4 sm:px-0">
            <button
              type="button"
              onClick={() => void download()}
              disabled={preparing}
              className="flex min-h-11 w-full items-center justify-center rounded-full border border-edge px-5 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-50 sm:w-auto"
            >
              {preparing
                ? "Preparing…"
                : size
                  ? `Download the video (${size})`
                  : "Download the video"}
            </button>
          </div>
        )}
      </div>

      {(chapters.length > 0 || goals.length > 0 || workOn.length > 0) && (
        <div className="mt-6 space-y-6 px-4 sm:px-0 lg:mt-0 lg:w-96 lg:shrink-0">
          <FocusList heading="Lesson goals" lines={goals} />

          {chapters.length > 0 && (
            <ol className="space-y-1">
              {chapters.map((item, index) => (
                <li
                  key={index}
                  className={
                    "rounded-xl px-3 py-2 transition-colors " +
                    (chapter === index ? "bg-white/5" : "")
                  }
                >
                  <button
                    type="button"
                    onClick={() => goToChapter(index)}
                    aria-current={chapter === index ? "true" : undefined}
                    className="flex min-h-11 w-full items-center gap-3 text-left focus-visible:outline focus-visible:outline-cyan-glow"
                  >
                    <span
                      className={
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold " +
                        (chapter === index
                          ? "bg-cyan-glow text-ink"
                          : "bg-surface-2 text-zinc-400")
                      }
                    >
                      {index + 1}
                    </span>
                    <span
                      className={
                        "min-w-0 flex-1 text-sm font-medium leading-snug " +
                        (chapter === index ? "text-zinc-100" : "text-zinc-300")
                      }
                    >
                      {item.title}
                    </span>
                  </button>
                  {item.cues.length > 0 && (
                    <ul className="mt-1 space-y-1 pl-10">
                      {item.cues.map((cue, i) => (
                        <li
                          key={i}
                          className="text-sm leading-relaxed text-zinc-400"
                        >
                          {cue}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}

          <FocusList heading="Things to work on" lines={workOn} />
        </div>
      )}
    </div>
  );
}
