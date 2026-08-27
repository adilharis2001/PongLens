"""Score the game-end detector against what Adil actually saw.

The corpus has two records of where the games ended and they do not
agree. One is the owner's scoring, reconstructed per game by
`game_truth`; it covers everything but it is a record of what he had time
to tap during a match, and it drifts by one to four rallies and
occasionally misses a game entirely. The other is this: on 2026-08-27 he
watched three rallies either side of 141 breaks and said, one by one,
whether the players had changed ends.

Where they disagree the video wins. That is not a preference, it is what
`game_end_override` has meant since migration 021 — the boundary is the
side switch you can see, and the score sheet is a proxy for it.

Two files hold the judgements:

  2026-08-27-game-end-verdicts.json   110 breaks the detector fired on or
                                      was expected at: swapped/same/unclear
  2026-08-27-missed-notes.json        31 more he was asked to explain,
                                      free text plus a cause

Both are keyed `{first 8 of match id}@{rally index}`, and BOTH are needed:
the first is where the fires were judged, the second is where the misses
and the borderline candidates were. A key in either file is a place a
human looked.

Scored per BOUNDARY, not per key. Two judgements a rally or two apart are
one changeover looked at twice — once where the truth sat and once where
a different setting fired — and counting them separately would invent
misses that never happened. That collapse is worth seven boundaries on
this corpus.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping, Sequence

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "docs" / "research"
VERDICTS = DOCS / "2026-08-27-game-end-verdicts.json"
NOTES = DOCS / "2026-08-27-missed-notes.json"

# How many rallies apart two judgements may sit and still be the same
# physical changeover, and how far a fire may land from one and still
# count as finding it. The same 3 that `eval_side_changes.score_match`
# forgives for scoring drift, for the same reason: a changeover is a
# thing that takes half a minute, not a rally index.
TOLERANCE = 3

# The nine breaks shown as "would a looser bar be right to fire here?".
# Adil answered in prose rather than by pressing the buttons — "this is
# clearly a change", "it seems pretty obvious" — so the verdicts are
# read from the notes here rather than being inferred by a rule.
CANDIDATES_REAL = (
    "04112a24@57", "04112a24@111", "7e02fbb9@20", "81b609e6@20",
    "cb0e7027@91", "efff9208@18", "efff9208@39",
)
# "I think the table on this match was just wrong. I would ignore this
# match from the calculation altogether." Excluded rather than counted as
# a miss: a match with a wrong quad is not evidence about appearance, and
# leaving it in would make every future change look better than it is.
EXCLUDED_MATCHES = ("6a3777db",)


def judgements() -> dict[str, str]:
    """Every break a human looked at, as {match8@idx: swapped|same}."""
    out = {}
    if VERDICTS.exists():
        out.update(json.loads(VERDICTS.read_text()))
    for key in CANDIDATES_REAL:
        out[key] = "swapped"
    return {k: v for k, v in out.items()
            if not k.startswith(EXCLUDED_MATCHES)}


def boundaries(judged: Mapping[str, str] | None = None) -> dict[str, dict]:
    """Judged rally positions collapsed into physical boundaries."""
    judged = judgements() if judged is None else judged
    per_match: dict[str, list[tuple[int, str]]] = {}
    for key, verdict in judged.items():
        match8, _, index = key.partition("@")
        per_match.setdefault(match8, []).append((int(index), verdict))
    out = {}
    for match8, items in per_match.items():
        groups: list[list[int]] = []
        for index in sorted(i for i, v in items if v == "swapped"):
            if groups and index - groups[-1][-1] <= TOLERANCE:
                groups[-1].append(index)
            else:
                groups.append([index])
        out[match8] = {
            "real": groups,
            "same": sorted(i for i, v in items if v == "same"),
        }
    return out


def score(
    fires_by_match: Mapping[str, Sequence[int]],
    tolerance: int = TOLERANCE,
) -> dict[str, Any]:
    """Hits, misses and false fires against the judged boundaries.

    `unjudged` is not a failure and not a success: a fire in a match
    nobody reviewed, or at a break nobody was shown. It is reported
    separately and never folded into precision, because a change that
    lifts recall by inventing fires in unreviewed matches would otherwise
    read as free.
    """
    truth = boundaries()
    found = missed = false = 0
    misses: list[str] = []
    unjudged: list[str] = []
    for match8, fires in fires_by_match.items():
        if match8.startswith(EXCLUDED_MATCHES):
            continue
        info = truth.get(match8)
        if not info:
            unjudged.extend(f"{match8}@{f}" for f in fires)
            continue
        used = set()
        for group in info["real"]:
            hit = [f for f in fires
                   if any(abs(f - i) <= tolerance for i in group)]
            if hit:
                found += 1
                used.update(hit)
            else:
                missed += 1
                misses.append(f"{match8}@{group[0]}")
        for fire in fires:
            if fire in used:
                continue
            if any(abs(fire - i) <= tolerance for i in info["same"]):
                false += 1
            else:
                unjudged.append(f"{match8}@{fire}")
    # Boundaries in matches that produced no fires at all still count as
    # missed; a match absent from fires_by_match is one the detector
    # withheld, and withholding a real changeover is a miss.
    for match8, info in truth.items():
        if match8 in fires_by_match:
            continue
        missed += len(info["real"])
        misses.extend(f"{match8}@{g[0]}" for g in info["real"])
    total = found + missed
    return {
        "boundaries": total,
        "found": found,
        "missed": missed,
        "false": false,
        "unjudged": sorted(unjudged),
        "miss_list": sorted(misses),
        "recall": found / total if total else 0.0,
        "precision": found / (found + false) if found + false else 0.0,
    }
