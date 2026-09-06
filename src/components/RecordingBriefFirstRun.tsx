"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraGuide } from "@/components/CameraGuide";
import { RecordingBrief } from "@/components/RecordingBrief";
import { createClient } from "@/lib/supabase/client";
import {
  RECORDING_BRIEF_DONE,
  RECORDING_BRIEF_METADATA_KEY,
  readSeenCount,
  recordingBriefGate,
  recordingBriefStorageKey,
} from "@/lib/cameraGuideGate";

/**
 * The "How to record" link on /upload, plus the decision about whether
 * the recording brief opens in front of the page.
 *
 * The counting lives here rather than in RecordingBrief, which stays a
 * dialog with no opinion about who has read it. The account's own copy of
 * the count is read on the server and handed down, so nothing waits on a
 * round trip to Supabase before deciding — otherwise the page paints and
 * the brief drops onto it a moment later.
 *
 * Seen means FINISHED. The count is written when the last page's button
 * is tapped, never when the brief opens, so a refresh halfway through
 * brings it back from page one. See src/lib/cameraGuideGate.ts.
 *
 * Twin of RecordingBriefFirstRun.swift.
 */

function read(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    // Private mode and blocked third-party storage both throw here. A
    // missing local mirror only costs an extra showing; throwing would
    // cost the page.
    return null;
  }
}

function write(store: Storage | undefined, key: string, value: string) {
  try {
    store?.setItem(key, value);
  } catch {
    /* see read() */
  }
}

export function RecordingBriefFirstRun({
  userId,
  seenFromAccount,
  hasAnyMatch,
  className = "",
}: {
  userId: string;
  /** user_metadata.recording_brief_seen, read by the server page. */
  seenFromAccount: unknown;
  /** Does this account already have footage in it — the back-fill input. */
  hasAnyMatch: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // React runs effects twice in development (mount → cleanup → mount).
  // Decide once per mounted component, ever.
  const decided = useRef(false);

  const persist = useCallback(
    (value: number) => {
      // Local first, and unconditionally. It cannot fail, and it is the
      // half that holds the cap when the network does not.
      const local = typeof window === "undefined" ? undefined : window.localStorage;
      write(local, recordingBriefStorageKey(userId), String(value));
      void createClient()
        .auth.updateUser({ data: { [RECORDING_BRIEF_METADATA_KEY]: value } })
        .catch(() => {
          /* the local mirror already covered this */
        });
    },
    [userId],
  );

  useEffect(() => {
    if (decided.current) return;
    decided.current = true;

    const local = typeof window === "undefined" ? undefined : window.localStorage;
    const decision = recordingBriefGate({
      seen: readSeenCount(seenFromAccount, read(local, recordingBriefStorageKey(userId))),
      hasAnyMatch,
    });

    if (decision.seed !== null) persist(decision.seed);
    if (decision.show) setOpen(true);
  }, [userId, seenFromAccount, hasAnyMatch, persist]);

  const done = useCallback(() => {
    persist(RECORDING_BRIEF_DONE);
    setOpen(false);
  }, [persist]);

  return (
    <>
      {/* The manual way in stays exactly as it was, and never counts. */}
      <CameraGuide variant="link" className={className} />
      <RecordingBrief open={open} context="web" onDone={done} />
    </>
  );
}
