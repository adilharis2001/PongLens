"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LessonVideoCoachBrief,
  LessonVideoPlayerBrief,
} from "@/components/LessonBriefs";
import { createClient } from "@/lib/supabase/client";
import {
  RECORDING_BRIEF_DONE,
  type LessonBriefKind,
  lessonBriefGate,
  lessonBriefMetadataKey,
  lessonBriefStorageKey,
  readSeenCount,
} from "@/lib/cameraGuideGate";

/**
 * Whether a lesson-video brief opens in front of an import page.
 *
 * The same shape as RecordingBriefFirstRun, and for the same reasons: the
 * account's copy of the count is read on the server and handed down so
 * nothing waits on a round trip, the local mirror is written first because
 * it cannot fail, and SEEN MEANS FINISHED — the count is written when the
 * last page's button is tapped, so quitting halfway brings it back from
 * page one.
 *
 * Both doors run through this one component rather than a copy each. They
 * differ in exactly two values, the brief and the key, and a copy would
 * have been two places for the gate rule to drift.
 *
 * Twin of the Swift LessonBriefFirstRun.
 */

function read(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
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

export function LessonVideoBriefFirstRun({
  audience,
  userId,
  seenFromAccount,
  hasAnyLessonVideo,
}: {
  /** Which door this is. A coach sends the recap; a player keeps it. */
  audience: "coach" | "player";
  userId: string;
  /** This door's seen count from user_metadata, read by the server page. */
  seenFromAccount: unknown;
  /**
   * Whether they have already imported one THROUGH THIS DOOR. Counting
   * every lesson video the account owns would let a coach's own imports
   * suppress the player brief, on an account that holds both roles.
   */
  hasAnyLessonVideo: boolean;
}) {
  const kind: LessonBriefKind =
    audience === "coach" ? "videoCoach" : "videoPlayer";
  const [open, setOpen] = useState(false);
  const decided = useRef(false);

  const persist = useCallback(
    (value: number) => {
      const local =
        typeof window === "undefined" ? undefined : window.localStorage;
      write(local, lessonBriefStorageKey(kind, userId), String(value));
      void createClient()
        .auth.updateUser({ data: { [lessonBriefMetadataKey(kind)]: value } })
        .catch(() => {
          /* the local mirror already covered this */
        });
    },
    [kind, userId],
  );

  useEffect(() => {
    if (decided.current) return;
    decided.current = true;
    const local =
      typeof window === "undefined" ? undefined : window.localStorage;
    const decision = lessonBriefGate({
      seen: readSeenCount(
        seenFromAccount,
        read(local, lessonBriefStorageKey(kind, userId)),
      ),
      hasDoneBefore: hasAnyLessonVideo,
    });
    if (decision.seed !== null) persist(decision.seed);
    if (decision.show) setOpen(true);
  }, [kind, userId, seenFromAccount, hasAnyLessonVideo, persist]);

  const done = useCallback(() => {
    persist(RECORDING_BRIEF_DONE);
    setOpen(false);
  }, [persist]);

  return audience === "coach" ? (
    <LessonVideoCoachBrief open={open} onDone={done} />
  ) : (
    <LessonVideoPlayerBrief open={open} onDone={done} />
  );
}
