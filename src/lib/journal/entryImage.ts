const ENTRY_IMAGE_BUCKET = "ponglens-media";

export interface OwnedEntryImage {
  bucket: typeof ENTRY_IMAGE_BUCKET;
  key: string;
}

export function parseOwnedEntryImage(
  path: string,
  userId: string,
): OwnedEntryImage | null {
  const match = path.match(/^r2:\/\/([^/]+)\/(.+)$/);
  if (!match || match[1] !== ENTRY_IMAGE_BUCKET) return null;
  const key = match[2];
  if (!key.startsWith(`entry/${userId}/`)) return null;
  return { bucket: ENTRY_IMAGE_BUCKET, key };
}

export type EntryImageDeleteRequest =
  | {
      ok: true;
      imagePath: string;
      image: OwnedEntryImage;
    }
  | {
      ok: false;
      error: "invalid_image";
    };

export function entryImageDeleteRequest(
  path: unknown,
  userId: string,
): EntryImageDeleteRequest {
  if (typeof path !== "string") {
    return { ok: false, error: "invalid_image" };
  }
  const image = parseOwnedEntryImage(path, userId);
  return image
    ? { ok: true, imagePath: path, image }
    : { ok: false, error: "invalid_image" };
}
