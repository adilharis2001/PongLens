"""Replay the reviewed recovery rule against locally downloaded scored matches.

Usage:
    python3 docs/research/2026-09-16-second-bounce-recovery/replay.py \
        /private/tmp/adil-serve-eval

The input directories are deliberately external to the repository. Each match
directory contains the production `match.json`, its scored `db.json`, and the
`rotation.json` reconstructed from the scorekeeper.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from worker.placement_reconstruction import recover_second_bounce  # noqa: E402


def landing_id(hypothesis: dict) -> str | None:
    serve = next(
        (
            shot
            for shot in hypothesis.get("shots", [])
            if shot.get("phase") == "serve"
        ),
        None,
    )
    landing = (serve or {}).get("landing") or {}
    return landing.get("event_id")


def other(side: str) -> str:
    return "far" if side == "near" else "near"


def replay_match(directory: Path) -> list[dict]:
    db = json.loads((directory / "db.json").read_text())
    artifact = json.loads((directory / "match.json").read_text())
    rotation = json.loads((directory / "rotation.json").read_text())["rows"]
    generated = {int(point["idx"]): point for point in artifact.get("points", [])}
    scored = {int(row["idx"]): row for row in rotation}
    user_side = db["match"]["user_side"]
    deleted = {int(point["idx"]): bool(point["deleted"]) for point in db["points"]}
    results = []

    for idx, point in generated.items():
        serve_s = point.get("serve_s")
        placement = point.get("placement") or {}
        candidates = placement.get("candidates") or []
        row = scored.get(idx)
        if (
            serve_s is None
            or not row
            or row.get("server") not in {"user", "opponent"}
        ):
            continue
        server_side = user_side if row["server"] == "user" else other(user_side)
        current = (placement.get("hypotheses") or {}).get(server_side)
        if not isinstance(current, dict):
            continue
        recovered = recover_second_bounce(
            current,
            candidates,
            server_side,
            serve_s,
            point.get("suggestion"),
        )
        before = landing_id(current)
        after = landing_id(recovered)
        if before == after:
            continue
        landing = next(
            shot["landing"]
            for shot in recovered["shots"]
            if shot.get("phase") == "serve" and shot.get("landing")
        )
        contact_id = next(
            (event_id for event_id in recovered["used_event_ids"] if event_id != after),
            None,
        )
        contact = next(
            (
                candidate
                for candidate in candidates
                if candidate.get("id") == contact_id
            ),
            {},
        )
        results.append({
            "match": db["match"]["id"],
            "label": db["match"]["opponent_name"],
            "point": idx,
            "game": row.get("game"),
            "deleted": deleted.get(idx),
            "serverSide": server_side,
            "serve_s": serve_s,
            "oldStatus": current.get("status"),
            "oldLanding": before,
            "newLanding": after,
            "newLandingT": landing.get("t"),
            "receiverContactT": contact.get("t"),
            "landingToContactS": (
                round(float(contact["t"]) - float(landing["t"]), 4)
                if contact.get("t") is not None else None
            ),
        })
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    rows = []
    for directory in sorted(args.root.iterdir()):
        if not directory.is_dir():
            continue
        required = ("db.json", "match.json", "rotation.json")
        if not all((directory / name).exists() for name in required):
            continue
        rows.extend(replay_match(directory))
    payload = {"changed": len(rows), "rows": rows}
    encoded = json.dumps(payload, indent=2)
    if args.output:
        args.output.write_text(encoded + "\n")
    print(encoded)


if __name__ == "__main__":
    main()
