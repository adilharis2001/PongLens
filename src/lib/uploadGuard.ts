/**
 * Tiny cross-component flag: is an upload currently in flight?
 * UploadCard sets it; AppNav consults it before in-app navigation,
 * mirroring the beforeunload guard for tab closes.
 */
let uploading = false;

export function setUploading(active: boolean) {
  uploading = active;
}

/** Returns true if it is OK to navigate away (confirms with the user). */
export function confirmLeaveDuringUpload(): boolean {
  if (!uploading) return true;
  return window.confirm(
    "Upload in progress. If you leave, it pauses and you can resume later. Leave?"
  );
}
