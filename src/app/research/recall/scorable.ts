/**
 * The new pipeline's points, published as ordinary matches so the real
 * scorekeeper can open them.
 *
 * Rebuilding the Keep-score experience on a research page would have been a
 * worse copy of something that already exists, so these are real `matches`
 * rows carrying the lab's cards. They reuse the cut video of the match they
 * came from — no re-encode, no new storage — and their cut_t0 is computed
 * against that same cut, so every seek lands where it should.
 *
 * They carry no clip files. Keep score plays the cut and seeks by cut_t0, so
 * scoring works; the single-point view shows its no-clip message.
 *
 * Do not delete these from the app. The delete trigger negates the storage
 * ledger by key, and the cut file they point at belongs to the real match
 * too, so removing one would subtract a video that is still there. They are
 * removed with `s12_shadow_match.py --remove`, which puts the ledger back.
 *
 * Regenerate with:
 *   TTVid/recall-lab/s12_shadow_match.py <keys…>
 * and paste the ids it prints here.
 */
export interface ScorableMatch {
  readonly id: string;
  readonly name: string;
  readonly venue: string | null;
  readonly points: number;
  /** Cards whose start came from a detected serve rather than ball motion. */
  readonly served: number;
  /** Points in the owner-curated original, for a like-for-like count. */
  readonly realRallies: number;
  readonly productionCards: number;
}

export const SCORABLE: readonly ScorableMatch[] = [
  {
    id: "c5b3da33-fb1a-49d4-9c94-e7532a15b223",
    name: "Ishan (recut 08-13)",
    venue: "LYTTC",
    points: 177,
    served: 82,
    realRallies: 81,
    productionCards: 142,
  },
  {
    id: "10a7e889-1091-4d38-b011-004d6a37249e",
    name: "Prabhas (recut 08-13)",
    venue: "LYTTC",
    points: 114,
    served: 57,
    realRallies: 55,
    productionCards: 103,
  },
  {
    id: "aa72ac3f-dd65-4b0e-ab20-bfd12f3ff639",
    name: "Chris (15 Aug, 17.5 min)",
    venue: "PingPod",
    points: 129,
    served: 78,
    realRallies: 86,
    productionCards: 109,
  },
  {
    id: "3a9d5664-2082-470c-9578-3ac8d57e1846",
    name: "Chris (recut 08-13)",
    venue: "PingPod",
    points: 47,
    served: 36,
    realRallies: 38,
    productionCards: 47,
  },
  {
    id: "1f80363c-7357-4468-8eb0-a60cda5939b3",
    name: "Ch (15 Aug, 11.3 min) — no table found",
    venue: "PingPod",
    points: 69,
    served: 0,
    realRallies: 59,
    productionCards: 72,
  },
];
