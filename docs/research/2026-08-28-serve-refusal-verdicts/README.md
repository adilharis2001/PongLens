# Which serve refusals are wrong — Adil's verdicts

`verdicts.json` is Adil's own review of cards where the pipeline found no
serve at all. It is the ruler for any change to `serve_motifs`, because the
alternative — reasoning about the rule from outside it — produced three
numbers in one day that shrank on contact with the real code.

**Partial: 84 of 175, marked 2026-08-28.** Not a sample; he works through
the list in order. Four reasons are COMPLETE — bounce_too_near_net (23),
no_apex (8), pair_too_far_apart (37), rally_already_running (13) — and
same_side_of_net is 3 of 45 with travelled_backwards untouched. Do not read
a rate off a reason that is still being worked.

## How to read it

- `n` — 1-based card number on the review page, so `C[n-1]` in
  `unanchored_cards.json`.
- `reason` — the gate inside `serve_motifs` that refused the pair which got
  furthest through the six tests. Recorded by the rule itself via its
  `reject` sink, not inferred.
- `verdict` — `missed` means Adil saw a serve the rule should have found;
  `fair` means the refusal was correct; `unclear` means he could not tell.

## Where the rest of it lives

- Page: `~/Desktop/ponglens-serve-review/unanchored.html` (served on 8899).
- Cards: `unanchored_cards.json` beside it, and the clips in `clipsun/`.
- Regenerate: `worker/eval/serve_refusal_census.py` over the cached evidence
  bundles.
- The page keeps marks in `localStorage` under `serve-unanchored`, keyed by
  card number. Refreshing does not lose them; clearing site data does.

## The reason label drifts, the verdict does not

`reason` is the gate that refused the pair which got FURTHEST through the
six tests, and that pair is not always the serve. Measured on
`rally_already_running`: the refused pair sits a median of 3.97 s into its
own card and 20 of 22 sit more than 2 s in, so what was refused is a
mid-rally pair and the rule was right — the real serve was lost earlier,
for another reason. Adil marked all 13 of those `missed`, which agrees:
a serve WAS there to be found, just not the thing the gate rejected.

So read `verdict` as trustworthy and `reason` as a rough sort. Before acting
on any group, re-derive why the real serve was lost.

## What this is NOT

These verdicts say a serve was there to be found. They do not say the rule's
threshold is the right place to move, and they carry no measurement of what
loosening it would let in. Anything built on them still has to be measured
by replaying the shipped rule over the bundles and diffing, the way the
+47 anchored cards and the 12/0 placement seed were.
