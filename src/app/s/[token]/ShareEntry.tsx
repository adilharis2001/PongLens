"use client";

import { useEffect, useState } from "react";
import type { ResolvedShareEntry } from "./shareData";
import { LinkedText } from "@/components/LinkedText";

/**
 * The body of a shared journal entry (154) — the same shape the owner's
 * own card has, minus everything that acts: no tags, no Working-on
 * buttons, no edit or delete. Takeaways are the card; the raw transcript
 * stays one tap away. A short entry with no takeaways shows its
 * transcript as the body, exactly as it does in the journal.
 *
 * The photo is never in the HTML: the browser asks the share media route
 * for a short-TTL URL with the token as its only credential, so a revoked
 * link's photo dies with the link.
 */
export function ShareEntry({
  entry,
  token,
}: {
  entry: Pick<
    ResolvedShareEntry,
    "transcript" | "takeaways"
  > & { hasImage: boolean };
  token: string;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [copied, setCopied] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!entry.hasImage) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/share/media?token=${encodeURIComponent(token)}`
        );
        const data = res.ok ? await res.json() : null;
        if (!cancelled && data?.url) setImageUrl(data.url);
      } catch {
        // the entry text stands on its own
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, entry.hasImage]);

  const copyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(entry.transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // selection stays possible in the expanded view
    }
  };

  const t = entry.takeaways;

  return (
    <section className="mt-5 rounded-2xl border border-edge bg-surface p-4 sm:p-5">
      {t ? (
        <div className="space-y-3">
          {t.themes.map((theme) => (
            <div key={theme.name}>
              <p className="text-xs font-semibold uppercase tracking-wider text-cyan-glow/80">
                {theme.name}
              </p>
              <ul className="mt-1 space-y-1">
                {theme.points.map((p) => (
                  <li
                    key={p}
                    className="flex gap-2 text-sm leading-relaxed text-zinc-200"
                  >
                    <span className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
                    <span className="min-w-0 flex-1">
                      <LinkedText text={p} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
          <LinkedText text={entry.transcript} />
        </p>
      )}

      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt="Photo attached to this entry"
          loading="lazy"
          decoding="async"
          className="mt-3 max-h-72 w-full rounded-xl border border-edge object-cover"
        />
      )}

      {t && (
        <div className="mt-4 border-t border-edge/60 pt-2.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowTranscript((v) => !v)}
              className="text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
            >
              {showTranscript ? "Hide transcript" : "Transcript"}
            </button>
            {showTranscript && (
              <button
                type="button"
                onClick={() => void copyTranscript()}
                className="text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          {showTranscript && (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
              <LinkedText text={entry.transcript} />
            </p>
          )}
        </div>
      )}
    </section>
  );
}
