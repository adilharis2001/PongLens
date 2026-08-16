"use client";

import { useEffect, useState } from "react";
import { UPLOADING_EVENT, isUploading } from "@/lib/uploadGuard";

/**
 * Takes its children off the screen while an upload is running.
 *
 * The upload page carried three unguarded ways out — the balances tile's
 * "Get more", the card's "add space" link, and "Report an issue" — all
 * sitting a thumb's width from a progress bar, and none of them behind the
 * nav guard. Confirming each one would be three dialogs for something
 * nobody needs mid-upload; removing them for the duration is the honest
 * version, and it leaves the page showing the one thing that is happening.
 */
export function HideWhileUploading({
  children,
}: {
  children: React.ReactNode;
}) {
  const [uploading, setUploadingState] = useState(false);

  useEffect(() => {
    // The card may already be uploading when this mounts (a resume).
    setUploadingState(isUploading());
    const onChange = (e: Event) => {
      setUploadingState(Boolean((e as CustomEvent).detail?.active));
    };
    window.addEventListener(UPLOADING_EVENT, onChange);
    return () => window.removeEventListener(UPLOADING_EVENT, onChange);
  }, []);

  if (uploading) return null;
  return <>{children}</>;
}
