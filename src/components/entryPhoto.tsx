"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One photo on an entry, in one place.
 *
 * The journal composer had this first; the coach's composer now runs the
 * same thing, so a coach entry and a player entry end up identical rows
 * and every screen that already draws an entry photo draws both.
 *
 * The upload route checks the picture before it stores anything, which is
 * why the photo is uploaded while the composer is still open rather than
 * on save: a picture that comes back refused should say so while there is
 * still something to do about it. A photo attached and then abandoned is
 * deleted on the way out.
 */

export interface AttachedPhoto {
  /** Local object URL, so the thumbnail appears before the round trip. */
  preview: string;
  /** r2:// path from /api/entry-image, once the check has passed. */
  path: string | null;
  checking: boolean;
}

/** Downscale to <=1600px JPEG: smaller uploads, cheaper vision calls. */
export function shrinkImage(file: File): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas
        .getContext("2d")
        ?.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.85);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

export function useEntryPhoto(onError: (line: string) => void) {
  const [photo, setPhoto] = useState<AttachedPhoto | null>(null);
  // The live value, for the discard that runs on the way out of a closure
  // that captured an older render.
  const latest = useRef<AttachedPhoto | null>(null);
  latest.current = photo;

  const attach = useCallback(
    async (file: File) => {
      if (latest.current?.checking) return;
      const preview = URL.createObjectURL(file);
      setPhoto({ preview, path: null, checking: true });
      try {
        const form = new FormData();
        form.append("image", await shrinkImage(file), "photo.jpg");
        const res = await fetch("/api/entry-image", {
          method: "POST",
          body: form,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.image_path) {
          URL.revokeObjectURL(preview);
          setPhoto(null);
          onError(data?.error ?? "Couldn't add that photo.");
          return;
        }
        setPhoto({ preview, path: data.image_path, checking: false });
      } catch {
        URL.revokeObjectURL(preview);
        setPhoto(null);
        onError("Couldn't add that photo.");
      }
    },
    [onError],
  );

  /** Throw the photo away, including the object it already uploaded. */
  const discard = useCallback(() => {
    const current = latest.current;
    if (!current) return;
    URL.revokeObjectURL(current.preview);
    if (current.path) {
      void fetch("/api/entry-image", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagePath: current.path }),
        keepalive: true,
      });
    }
    setPhoto(null);
  }, []);

  /** Saved: the entry owns the object now, so let go without deleting. */
  const release = useCallback(() => {
    if (latest.current) URL.revokeObjectURL(latest.current.preview);
    setPhoto(null);
  }, []);

  return { photo, attach, discard, release };
}

/** The dashed pill that opens the file picker, with its hidden input. */
export function AddPhotoButton({
  disabled,
  onPick,
}: {
  disabled?: boolean;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onPick(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-edge px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:border-cyan-glow/40 hover:text-zinc-300 disabled:opacity-50"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path strokeLinecap="round" d="m6 15 4-4 4 4 2-2 2 2" />
          <circle cx="9.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
        </svg>
        Add photo
      </button>
    </>
  );
}

/** The thumbnail while composing, with its own way back out. */
export function PhotoPreview({
  photo,
  onRemove,
}: {
  photo: AttachedPhoto;
  onRemove: () => void;
}) {
  return (
    <div className="mt-2.5 flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.preview}
        alt="Photo to attach"
        className={`h-14 w-14 rounded-lg border border-edge object-cover ${
          photo.checking ? "opacity-50" : ""
        }`}
      />
      {photo.checking ? (
        <span className="animate-pulse text-xs text-zinc-400">
          Checking the photo…
        </span>
      ) : (
        <button
          type="button"
          onClick={onRemove}
          className="rounded-full border border-edge px-3 py-1 text-xs font-medium text-zinc-400 transition-colors hover:border-amber-500/60 hover:text-amber-200"
        >
          Remove
        </button>
      )}
    </div>
  );
}

/**
 * An entry's photo, wherever the entry is drawn. Signed on mount rather
 * than behind a tap, because a photo should just be there.
 *
 * The signing route decides who may see it (163): the author always, and a
 * student the entry was shared with. A photo that comes back refused
 * simply does not draw, because the words are the entry and a broken image
 * frame beside them is worse than no image at all.
 */
/**
 * Signed URLs already fetched, keyed by entry. A list that shows a
 * thumbnail and then a full-size photo when the card opens would
 * otherwise sign the same object twice, and again on every scroll back.
 * The URL lasts an hour and the map dies with the page, so there is
 * nothing to expire; a photo that changes clears its own key on save.
 */
const signedUrls = new Map<string, string>();

export function forgetEntryImage(lessonId: string) {
  signedUrls.delete(lessonId);
}

export function EntryImage({
  lessonId,
  className = "mt-3 max-h-72 w-full rounded-xl border border-edge object-cover",
}: {
  lessonId: string;
  /** The card's own framing. The default is the full-width one a feed
   *  card uses; a thumbnail or an editor passes its own. */
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(
    () => signedUrls.get(lessonId) ?? null,
  );
  useEffect(() => {
    const cached = signedUrls.get(lessonId);
    if (cached) {
      setUrl(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/media-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lessonId, image: true }),
        });
        const data = res.ok ? await res.json() : null;
        if (data?.url) signedUrls.set(lessonId, data.url);
        if (!cancelled && data?.url) setUrl(data.url);
      } catch {
        // the entry text stands on its own
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lessonId]);
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="Photo attached to this entry"
      loading="lazy"
      decoding="async"
      className={className}
    />
  );
}
