/**
 * Tiny cross-component flag: is an upload currently in flight?
 * UploadCard sets it; AppNav consults it before in-app navigation,
 * mirroring the beforeunload guard for tab closes, and the upload page
 * uses the event to clear everything else off the screen while it runs.
 *
 * The guard used to cover only the nav links and the FAB, which left the
 * three exits sitting on the upload page itself — the balances tile, the
 * "add space" link and the feedback link — able to kill an upload in one
 * tap with no warning. Hiding them for the duration is a better answer
 * than confirming each one: there is nothing on that page worth doing
 * while a video is going up.
 */
let uploading = false;

export const UPLOADING_EVENT = "ponglens:uploading";

export function setUploading(active: boolean) {
  if (uploading === active) return;
  uploading = active;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(UPLOADING_EVENT, { detail: { active } })
    );
  }
}

export function isUploading(): boolean {
  return uploading;
}

/** Returns true if it is OK to navigate away (confirms with the user). */
export function confirmLeaveDuringUpload(): boolean {
  if (!uploading) return true;
  return window.confirm(
    "Upload in progress. If you leave, it pauses and you can resume later. Leave?"
  );
}

/**
 * Browser Back and the iOS edge swipe are client-side navigations, so
 * neither beforeunload nor the nav links' guard sees them — the most
 * common gesture on a phone was also the one silent way to lose an
 * upload. Push a sentinel entry while uploading and confirm on popstate,
 * re-pushing when the user chooses to stay.
 */
export function installBackGuard(): () => void {
  if (typeof window === "undefined") return () => {};
  const marker = { ponglensUploadGuard: true };
  history.pushState(marker, "");
  const onPop = () => {
    if (!uploading) return;
    if (confirmLeaveDuringUpload()) {
      history.back();
      return;
    }
    history.pushState(marker, "");
  };
  window.addEventListener("popstate", onPop);
  return () => window.removeEventListener("popstate", onPop);
}
