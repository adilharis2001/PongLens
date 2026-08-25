"use client";

import { useEffect, useRef, useState } from "react";
import { CameraGuide } from "@/components/CameraGuide";
import { createClient } from "@/lib/supabase/client";
import {
  CAMERA_GUIDE_METADATA_KEY,
  cameraGuideGate,
  cameraGuideStorageKey,
  readSeenCount,
} from "@/lib/cameraGuideGate";

/**
 * The "How to record" trigger on /upload, plus the decision about whether
 * to open it without being asked.
 *
 * The counting lives here rather than in CameraGuide, which stays what it
 * has always been — a trigger and a sheet with no opinion about who has
 * read it — because three other places render that component and none of
 * them should acquire a counter by accident.
 *
 * The account's own copy of the count is read on the server and handed
 * down, so nothing waits on a round trip to Supabase before deciding.
 * See src/lib/cameraGuideGate.ts for the rule itself.
 */

/** Per tab, not per account: this is the "one showing per session" half. */
const SESSION_KEY = "pl-camera-guide-shown-session";

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

export function CameraGuideFirstRun({
  userId,
  seenFromAccount,
  hasAnyMatch,
  className = "",
}: {
  userId: string;
  /** user_metadata.camera_guide_seen, read by the server page. */
  seenFromAccount: unknown;
  /** Does this account already have footage in it — the back-fill input. */
  hasAnyMatch: boolean;
  className?: string;
}) {
  const [autoOpen, setAutoOpen] = useState(false);
  // React runs effects twice in development (mount → cleanup → mount), and
  // a counter that advances twice per visit would spend the whole budget
  // on one page load. Decide once per mounted component, ever.
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current) return;
    decided.current = true;

    const local = typeof window === "undefined" ? undefined : window.localStorage;
    const session = typeof window === "undefined" ? undefined : window.sessionStorage;
    const deviceKey = cameraGuideStorageKey(userId);

    const decision = cameraGuideGate({
      seen: readSeenCount(seenFromAccount, read(local, deviceKey)),
      hasAnyMatch,
      shownThisSession: read(session, SESSION_KEY) === "1",
    });

    if (decision.persist !== null) {
      // Local first, and unconditionally. It cannot fail, and it is the
      // half that holds the cap when the network does not.
      write(local, deviceKey, String(decision.persist));
      void createClient()
        .auth.updateUser({ data: { [CAMERA_GUIDE_METADATA_KEY]: decision.persist } })
        .catch(() => {
          /* the local mirror already covered this */
        });
    }

    if (decision.show) {
      write(session, SESSION_KEY, "1");
      setAutoOpen(true);
    }
  }, [userId, seenFromAccount, hasAnyMatch]);

  return <CameraGuide variant="link" className={className} autoOpen={autoOpen} />;
}
