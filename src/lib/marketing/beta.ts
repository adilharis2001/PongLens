/**
 * The beta allowance as the public pages state it.
 *
 * The live values are app_config `free_processing_minutes` (migration 096)
 * and the storage grant beside it, both editable from /admin/commerce.
 * These are the numbers the landing pages, the FAQ, the structured data
 * and the guides promise, so they are written once here: change the
 * config and this together, or the site promises one thing and the
 * account page shows another.
 */
export const BETA_ALLOWANCE = {
  processingMinutes: 250,
  storageGb: 25,
  /** In words, the way the hero says it: "Analyze four matches for free". */
  matchesWord: "four",
} as const;
