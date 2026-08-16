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
 * They carry small pads (0.3/0.4) rather than production's 1.2/1.3, because
 * these cards already open before the serve and close after the rally dies.
 * Re-padding them made every card bleed 2.5s into its neighbours, so
 * consecutive points played nearly the same footage.
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
    id: "c294170c-4794-4263-9c52-5108e29bf378",
    name: "Ishan (recut 08-13)",
    venue: "LYTTC",
    points: 171,
    served: 82,
    realRallies: 81,
    productionCards: 142,
  },
  {
    id: "3e7ead39-6c17-4e9d-be99-73a8fa53e9d2",
    name: "Prabhas (recut 08-13)",
    venue: "LYTTC",
    points: 112,
    served: 57,
    realRallies: 55,
    productionCards: 103,
  },
  {
    id: "e7a83f97-0c81-4ce4-b379-8c139c0f3640",
    name: "Chris (15 Aug, 17.5 min)",
    venue: "PingPod",
    points: 127,
    served: 78,
    realRallies: 86,
    productionCards: 109,
  },
  {
    id: "61f0e887-6fff-4388-9723-dcdd9140a225",
    name: "Chris (recut 08-13)",
    venue: "PingPod",
    points: 47,
    served: 36,
    realRallies: 38,
    productionCards: 47,
  },
  {
    id: "4cde73ed-3b81-4075-81a1-4475aef436d3",
    name: "Ch (15 Aug, 11.3 min) — no table found",
    venue: "PingPod",
    points: 69,
    served: 0,
    realRallies: 59,
    productionCards: 72,
  },
];
