"use client";

import { useState } from "react";

/** One finding on the public sample page; media URLs come pre-signed. */
export function SampleFinding({
  finding,
}: {
  finding: {
    id: string;
    title: string;
    body: string;
    audioUrl: string | null;
    imageUrl: string | null;
    points: { displayNo: number; clipUrl: string | null }[];
  };
}) {
  const [openClip, setOpenClip] = useState<number | null>(null);

  return (
    <div className="rounded-2xl border border-edge bg-surface p-5">
      {finding.title && (
        <h3 className="text-sm font-semibold text-zinc-100">
          {finding.title}
        </h3>
      )}
      {finding.body && (
        <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-zinc-300">
          {finding.body}
        </p>
      )}
      {finding.audioUrl && (
        <audio controls src={finding.audioUrl} className="mt-3 w-full" />
      )}
      {finding.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={finding.imageUrl}
          alt="Coach drawing"
          className="mt-3 w-full rounded-xl border border-edge"
        />
      )}
      {finding.points.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {finding.points.map(
            (p, i) =>
              p.clipUrl && (
                <div key={i} className={openClip === i ? "w-full" : ""}>
                  <button
                    type="button"
                    onClick={() => setOpenClip(openClip === i ? null : i)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      openClip === i
                        ? "border-cyan-glow/60 text-cyan-glow"
                        : "border-edge bg-surface-2 text-zinc-300 hover:border-cyan-glow/40"
                    }`}
                  >
                    Point {p.displayNo}
                  </button>
                  {openClip === i && (
                    <video
                      src={p.clipUrl}
                      autoPlay
                      playsInline
                      controls={false}
                      onClick={(e) => {
                        const v = e.currentTarget;
                        if (v.paused) void v.play();
                        else v.pause();
                      }}
                      onEnded={(e) => {
                        e.currentTarget.currentTime = 0;
                      }}
                      className="mt-2 w-full rounded-xl border border-edge bg-black"
                    />
                  )}
                </div>
              ),
          )}
        </div>
      )}
    </div>
  );
}
