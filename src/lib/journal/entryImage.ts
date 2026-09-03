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

/**
 * What an edit is asking to do with the entry's photo.
 *
 * The field is optional on both editors: leaving it out means "the photo
 * is not what I am changing", which is what every save that predates
 * photo editing does. Sending null (or an empty string) removes it, and
 * sending a path attaches that one — but only when it sits in the
 * caller's own entry folder, because the value is client-written text on
 * a row they own and a path is not a permission.
 */
export type EntryImageEdit =
  | { kind: "unchanged" }
  | { kind: "set"; imagePath: string | null }
  | { kind: "invalid" };

export function entryImageEdit(
  body: Record<string, unknown>,
  userId: string,
): EntryImageEdit {
  if (!("imagePath" in body)) return { kind: "unchanged" };
  const raw = body.imagePath;
  if (raw === null || raw === "") return { kind: "set", imagePath: null };
  if (typeof raw !== "string") return { kind: "invalid" };
  return parseOwnedEntryImage(raw, userId)
    ? { kind: "set", imagePath: raw }
    : { kind: "invalid" };
}
