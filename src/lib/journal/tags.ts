import type { Tag } from "@/lib/types";

export function journalTagsForOwner(tags: Tag[], ownerId: string): Tag[] {
  return tags.filter((tag) => tag.owner_id === ownerId);
}
