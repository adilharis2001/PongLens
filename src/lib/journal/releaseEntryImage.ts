import { deleteObjects } from "@/lib/r2";
import { parseOwnedEntryImage } from "./entryImage";

/**
 * Let go of an entry photo that is no longer attached to anything.
 *
 * Three callers: deleting an entry, replacing its photo, and removing its
 * photo. All three leave an object in the bucket that nothing points at,
 * and all three have the same right answer — drop the object and negate
 * what it was billed at.
 *
 * Fail-open, deliberately. The row is already correct by the time this
 * runs, so a failure here costs an orphaned object that the worker's own
 * two-day sweep collects; turning that into a failed save would lose the
 * writer's words over a piece of housekeeping.
 */
export async function releaseEntryImage(
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  },
  imagePath: string | null | undefined,
  userId: string,
): Promise<void> {
  const image = parseOwnedEntryImage(String(imagePath ?? ""), userId);
  if (!image) return;
  try {
    await deleteObjects(image.bucket, [image.key]);
    const { error } = await supabase.rpc("ledger_negate_entry_image", {
      p_key: imagePath,
    });
    if (error) console.error("entry image ledger negate failed:", error);
  } catch (error) {
    console.error("entry image cleanup failed:", error);
  }
}
