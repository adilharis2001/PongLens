/**
 * Who owns each object in the buckets, and what kind of thing it is.
 *
 * Every file the product writes sits under a fixed prefix and, one segment
 * in, the id of the account that made it. The two exceptions are reels,
 * which are keyed by the match (or tag) they were cut from, and the
 * platform's own files (research corpora, tutorial chapters, feedback and
 * QA screenshots, the cloud twin's parity replays), which belong to
 * nobody's allowance.
 *
 * This is the rule the nightly measurement runs on, so an object under a
 * prefix nobody has taught it about is reported, never silently dropped:
 * an unattributed count on the admin page is how a new feature that
 * forgot to register its prefix announces itself.
 */

export type StorageCategory =
  | "match_original"
  | "match_cut"
  | "match_clips"
  | "lesson_video"
  | "reels"
  | "notes_media"
  | "coach_media";

export const STORAGE_CATEGORIES: readonly StorageCategory[] = [
  "match_original",
  "match_cut",
  "match_clips",
  "lesson_video",
  "reels",
  "notes_media",
  "coach_media",
];

/** Plain words for the Account page and the admin table. */
export const CATEGORY_LABELS: Record<StorageCategory, string> = {
  match_original: "Match videos",
  match_cut: "Cut versions",
  match_clips: "Point clips and match data",
  lesson_video: "Lesson videos",
  reels: "Reels and highlights",
  notes_media: "Voice notes, sketches and photos",
  coach_media: "Coaching files",
};

export type Classified =
  | { kind: "owned"; owner: string; category: StorageCategory }
  | { kind: "match"; matchId: string; category: "reels" }
  | { kind: "tag"; tagId: string; category: "reels" }
  | { kind: "platform" }
  | { kind: "unknown" };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OWNED_PREFIXES: Record<string, StorageCategory> = {
  results: "match_cut",
  points: "match_clips",
  "lesson-video": "lesson_video",
  voice: "notes_media",
  sketch: "notes_media",
  entry: "notes_media",
  review: "coach_media",
  avatar: "coach_media",
  offer: "coach_media",
};

/**
 * parity/<job id>/<label>/ is the cloud twin's shadow and parity replays
 * (worker/cloud_release shadow.py, modal_app.py): our own test output from
 * re-running a player's upload to compare the Mac with Modal, never the
 * player's own files, so it counts against no allowance.
 */
const PLATFORM_PREFIXES = new Set(["research", "tutorial", "qa", "feedback", "parity"]);

function owned(
  id: string | undefined,
  category: StorageCategory,
): Classified {
  return id && UUID.test(id)
    ? { kind: "owned", owner: id.toLowerCase(), category }
    : { kind: "unknown" };
}

/**
 * Reels are named by what they were cut from:
 *   <matchId>.mp4, <matchId>-full.mp4, <matchId>-<scope>.mp4,
 *   <matchId>-highlights-<revision>.mp4, v-<matchId>-<scope>.mp4 (vertical
 *   share render) and tag-<tagId>.mp4.
 * A starred selection spans matches, so it is named by its owner instead:
 *   sel-<userId>-<attempt>.mp4 (2026-09-22).
 */
function reel(name: string | undefined): Classified {
  if (!name) return { kind: "unknown" };
  const selection = name.match(/^sel-([0-9a-f-]{36})/i);
  if (selection) return owned(selection[1], "reels");
  const tag = name.match(/^tag-([0-9a-f-]{36})/i);
  if (tag && UUID.test(tag[1])) {
    return { kind: "tag", tagId: tag[1].toLowerCase(), category: "reels" };
  }
  const vertical = name.match(/^v-([0-9a-f-]{36})/i);
  if (vertical && UUID.test(vertical[1])) {
    return { kind: "match", matchId: vertical[1].toLowerCase(), category: "reels" };
  }
  const match = name.match(/^([0-9a-f-]{36})/i);
  if (match && UUID.test(match[1])) {
    return { kind: "match", matchId: match[1].toLowerCase(), category: "reels" };
  }
  return { kind: "unknown" };
}

export function classifyKey(
  bucket: "ponglens-raw" | "ponglens-media",
  key: string,
): Classified {
  const parts = key.split("/");
  if (bucket === "ponglens-raw") {
    // Originals sit at the bucket root under the owner's id.
    return parts.length >= 2 ? owned(parts[0], "match_original") : { kind: "unknown" };
  }
  const [prefix, second] = parts;
  if (prefix in OWNED_PREFIXES) {
    return parts.length >= 3 ? owned(second, OWNED_PREFIXES[prefix]) : { kind: "unknown" };
  }
  if (prefix === "reels") return reel(second);
  if (PLATFORM_PREFIXES.has(prefix)) return { kind: "platform" };
  if (key === "healthcheck.txt") return { kind: "platform" };
  return { kind: "unknown" };
}

export interface BucketObject {
  bucket: "ponglens-raw" | "ponglens-media";
  key: string;
  size: number;
}

export interface AccountUsage {
  bytes: number;
  objects: number;
  breakdown: Partial<Record<StorageCategory, number>>;
}

export interface UnattributedSample {
  bucket: string;
  key: string;
  size: number;
  reason: "unknown_prefix" | "orphan_reel";
}

export interface Inventory {
  accounts: Map<string, AccountUsage>;
  platformBytes: number;
  platformObjects: number;
  /** Files of a cut the player replaced (or a re-cut of theirs that
   *  failed), kept 30 days for support and counted against nobody: they
   *  stopped counting when the new cut went live (retiredMediaKeys). */
  retiredBytes: number;
  retiredObjects: number;
  unattributedBytes: number;
  unattributedObjects: number;
  /** A few examples, so the admin page can name the prefix at fault. */
  unattributed: UnattributedSample[];
  totalBytes: number;
  totalObjects: number;
}

/** A retired processing version, as public.retired_processing_versions
 *  returns it. */
export interface RetiredVersion {
  version_id: string;
  match_id: string;
  user_id: string;
  cut_path: string | null;
  /** The match's first cut: it wrote straight into the match's folder. */
  first_cut: boolean;
}

const MEDIA_URI = "r2://ponglens-media/";
const VERSION_FOLDER = /^(points\/[^/]+\/[^/]+\/versions\/[^/]+\/)/;
const MATCH_FOLDER_FILE = /^(points\/[^/]+\/[^/]+\/)[^/]+$/;

/**
 * The media keys in a listing that belong to retired versions: a cut the
 * player replaced with a re-cut of their own, or a re-cut of theirs that
 * failed (Cut again, 2026-09-25). That is the version's cut video, its own
 * folder (points/<owner>/<match>/versions/<version>/), and, for a match's
 * first cut, the files directly in the match's folder. The caller removes
 * the keys something else still uses (public.media_keys_in_use) before
 * treating the rest as retired. The worker's retired-version sweep
 * deletes the same files 30 days on.
 */
export function retiredMediaKeys(objects: BucketObject[], versions: RetiredVersion[]): string[] {
  const cuts = new Set<string>();
  const folders = new Set<string>();
  const firstCutFolders = new Set<string>();
  for (const v of versions) {
    if (v.cut_path?.startsWith(MEDIA_URI)) cuts.add(v.cut_path.slice(MEDIA_URI.length));
    folders.add(`points/${v.user_id}/${v.match_id}/versions/${v.version_id}/`);
    if (v.first_cut) firstCutFolders.add(`points/${v.user_id}/${v.match_id}/`);
  }
  const out: string[] = [];
  for (const o of objects) {
    if (o.bucket !== "ponglens-media") continue;
    const version = o.key.match(VERSION_FOLDER);
    const matchFile = o.key.match(MATCH_FOLDER_FILE);
    if (
      cuts.has(o.key) ||
      (version && folders.has(version[1])) ||
      (matchFile && firstCutFolders.has(matchFile[1]))
    ) {
      out.push(o.key);
    }
  }
  return out;
}

/** Match and tag ids a listing refers to, so the caller can look up owners. */
export function reelReferences(objects: BucketObject[]): {
  matchIds: string[];
  tagIds: string[];
} {
  const matchIds = new Set<string>();
  const tagIds = new Set<string>();
  for (const o of objects) {
    const c = classifyKey(o.bucket, o.key);
    if (c.kind === "match") matchIds.add(c.matchId);
    if (c.kind === "tag") tagIds.add(c.tagId);
  }
  return { matchIds: [...matchIds], tagIds: [...tagIds] };
}

export function summarize(
  objects: BucketObject[],
  owners: { matchOwner: Map<string, string>; tagOwner: Map<string, string> },
  sampleLimit = 12,
  /** Media keys of retired versions no one uses (retiredMediaKeys minus
   *  public.media_keys_in_use): counted against nobody. */
  retired: ReadonlySet<string> = new Set(),
): Inventory {
  const inv: Inventory = {
    accounts: new Map(),
    platformBytes: 0,
    platformObjects: 0,
    retiredBytes: 0,
    retiredObjects: 0,
    unattributedBytes: 0,
    unattributedObjects: 0,
    unattributed: [],
    totalBytes: 0,
    totalObjects: 0,
  };
  const add = (owner: string, category: StorageCategory, size: number) => {
    const row = inv.accounts.get(owner) ?? { bytes: 0, objects: 0, breakdown: {} };
    row.bytes += size;
    row.objects += 1;
    row.breakdown[category] = (row.breakdown[category] ?? 0) + size;
    inv.accounts.set(owner, row);
  };
  const skip = (o: BucketObject, reason: UnattributedSample["reason"]) => {
    inv.unattributedBytes += o.size;
    inv.unattributedObjects += 1;
    if (inv.unattributed.length < sampleLimit) {
      inv.unattributed.push({ bucket: o.bucket, key: o.key, size: o.size, reason });
    }
  };
  for (const o of objects) {
    inv.totalBytes += o.size;
    inv.totalObjects += 1;
    if (o.bucket === "ponglens-media" && retired.has(o.key)) {
      inv.retiredBytes += o.size;
      inv.retiredObjects += 1;
      continue;
    }
    const c = classifyKey(o.bucket, o.key);
    switch (c.kind) {
      case "owned":
        add(c.owner, c.category, o.size);
        break;
      case "match": {
        const owner = owners.matchOwner.get(c.matchId);
        if (owner) add(owner, "reels", o.size);
        else skip(o, "orphan_reel");
        break;
      }
      case "tag": {
        const owner = owners.tagOwner.get(c.tagId);
        if (owner) add(owner, "reels", o.size);
        else skip(o, "orphan_reel");
        break;
      }
      case "platform":
        inv.platformBytes += o.size;
        inv.platformObjects += 1;
        break;
      default:
        skip(o, "unknown_prefix");
    }
  }
  return inv;
}
