"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LessonVideoBrief } from "@/components/LessonBriefs";
import { createClient } from "@/lib/supabase/client";
import {
  RECORDING_BRIEF_DONE,
  lessonBriefGate,
  lessonBriefMetadataKey,
  lessonBriefStorageKey,
  readSeenCount,
} from "@/lib/cameraGuideGate";

/**
 * Whether the lesson-video brief opens in front of the import page.
 *
 * The same shape as RecordingBriefFirstRun, and for the same reasons: the
 * account's copy of the count is read on the server and handed down so
 * nothing waits on a round trip, the local mirror is written first because
 * it cannot fail, and SEEN MEANS FINISHED — the count is written when the
 * last page's button is tapped, so quitting halfway brings it back from
 * page one.
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
  userId,
  seenFromAccount,
  hasAnyLessonVideo,
}: {
  userId: string;
  /** user_metadata.lesson_video_brief_seen, read by the server page. */
  seenFromAccount: unknown;
  /** A coach who has already imported one does not get interrupted. */
  hasAnyLessonVideo: boolean;
}) {
  const [open, setOpen] = useState(false);
  const decided = useRef(false);

  const persist = useCallback(
    (value: number) => {
      const local = typeof window === "undefined" ? undefined : window.localStorage;
      write(local, lessonBriefStorageKey("video", userId), String(value));
      void createClient()
        .auth.updateUser({ data: { [lessonBriefMetadataKey("video")]: value } })
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
    const decision = lessonBriefGate({
      seen: readSeenCount(
        seenFromAccount,
        read(local, lessonBriefStorageKey("video", userId)),
      ),
      hasDoneBefore: hasAnyLessonVideo,
    });
    if (decision.seed !== null) persist(decision.seed);
    if (decision.show) setOpen(true);
  }, [userId, seenFromAccount, hasAnyLessonVideo, persist]);

  const done = useCallback(() => {
    persist(RECORDING_BRIEF_DONE);
    setOpen(false);
  }, [persist]);

  return <LessonVideoBrief open={open} onDone={done} />;
}
