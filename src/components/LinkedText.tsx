"use client";

import { Fragment } from "react";
import { linkify } from "@/lib/linkify";

/**
 * Plain text with its web addresses made tappable.
 *
 * The text stays plain text: what the reader sees is always where the tap
 * goes, because the link is built from the address itself rather than from
 * any markup the writer typed. `src/lib/linkify.ts` carries the rule and
 * the reasoning.
 *
 * `rel` is four things and only one of them is decorative. `noreferrer` is
 * load-bearing: a shared entry's URL carries its token in the path, so
 * without it, following a coach's link would hand that token to whatever
 * site the reader lands on. `noopener` denies the opened page a handle on
 * this one, and `nofollow ugc` says plainly that a link somebody typed
 * into an entry is not an endorsement by us.
 *
 * The click is stopped from travelling because these cards are often rows
 * you tap to expand: without it, following a link also collapses the thing
 * you were reading.
 */
export function LinkedText({ text }: { text: string }) {
  const segments = linkify(text);
  if (segments.length === 1 && segments[0].kind === "text") return <>{text}</>;
  return (
    <>
      {segments.map((segment, i) =>
        segment.kind === "link" ? (
          <a
            key={i}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            onClick={(e) => e.stopPropagation()}
            className="break-words text-cyan-glow underline decoration-cyan-glow/40 underline-offset-2 transition-colors hover:decoration-cyan-glow"
          >
            {segment.text}
          </a>
        ) : (
          <Fragment key={i}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
