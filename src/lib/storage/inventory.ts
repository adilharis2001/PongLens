/**
 * Who owns each object in the buckets, and what kind of thing it is.
 *
 * Every file the product writes sits under a fixed prefix and, one segment
 * in, the id of the account that made it. The two exceptions are reels,
 * which are keyed by the match (or tag) they were cut from, and the
 * platform's own files (research corpora, tutorial chapters, feedback and
 * QA screenshots), which belong to nobody's allowance.
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

const PLATFORM_PREFIXES = new Set(["research", "tutorial", "qa", "feedback"]);

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
 */
function reel(name: string | undefined): Classified {
  if (!name) return { kind: "unknown" };
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
  unattributedBytes: number;
  unattributedObjects: number;
  /** A few examples, so the admin page can name the prefix at fault. */
  unattributed: UnattributedSample[];
  totalBytes: number;
  totalObjects: number;
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
): Inventory {
  const inv: Inventory = {
    accounts: new Map(),
    platformBytes: 0,
    platformObjects: 0,
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
