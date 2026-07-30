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
