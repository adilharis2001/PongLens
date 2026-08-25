#!/usr/bin/env python3
"""Stage the App Review account with a processed match.

    cd worker && venv/bin/python ../scripts/demos/stage_reviewer.py

Same idea as clone_match.py (which staged the demo account), with one
deliberate difference: every media object is COPIED into keys the
reviewer owns, never shared. A reviewer who taps delete exercises the
real deletion path, and /api/delete-match removes whatever cut_path and
clip paths the row carries — shared keys there would let the review
account's cleanup take the original's video with it.

Cloned from the same source match as the demo account's 'Alex': all
points with their real scoring and vision output, three stars (so the
Starred shelf has content), one player note and two coach notes.
Idempotent: refuses to run twice.
"""

import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "worker"))
import worker  # noqa: E402

SRC_MATCH = "a0fb8f44-89b1-464e-a2a5-388b502dbda5"
REVIEWER_USER = "4fc5deb6-1a2e-4119-afe1-6912d481d5e0"
COACH_USER = "f15e9358-a722-4d07-9a0d-3379c696497a"  # demo coach Miguel
MEDIA_BUCKET = "ponglens-media"

STARS = {35, 37, 52}


def copy_object(src_path: str, dst_key: str) -> str:
    """Server-side copy inside R2; returns the new r2:// path."""
    bucket, key = worker.parse_r2_path(src_path)
    worker.r2().copy_object(
        Bucket=MEDIA_BUCKET,
        CopySource={"Bucket": bucket, "Key": key},
        Key=dst_key,
    )
    return f"r2://{MEDIA_BUCKET}/{dst_key}"


def main():
    conn = worker.connect()
    cur = conn.cursor()

    cur.execute(
        "select id from matches where user_id=%s", (REVIEWER_USER,))
    if cur.fetchone():
        sys.exit("reviewer already has a match; refusing to stage twice")

    cur.execute(
        """select cut_path, match_json_path, thumb_path, job_id, status,
                  user_side, first_server, venue
           from matches where id=%s""", (SRC_MATCH,))
    (src_cut, src_json, src_thumb, job_id, status, user_side,
     first_server, venue) = cur.fetchone()

    new_match = str(uuid.uuid4())
    points_prefix = f"points/{REVIEWER_USER}/{new_match}"

    cut_path = copy_object(
        src_cut, f"results/{REVIEWER_USER}/{uuid.uuid4()}.mp4")
    json_path = copy_object(src_json, f"{points_prefix}/match.json")
    thumb_path = copy_object(
        src_thumb, f"{points_prefix}/{Path(src_thumb).name}")

    cur.execute(
        """insert into matches (id, user_id, job_id, opponent_name,
             played_at, cut_path, match_json_path, status, user_side,
             match_type, first_server, venue, thumb_path)
           values (%s, %s, %s, 'Alex', '2026-08-20', %s, %s, %s, %s,
             'league', %s, %s, %s)""",
        (new_match, REVIEWER_USER, job_id, cut_path, json_path, status,
         user_side, first_server, venue, thumb_path))

    cur.execute(
        """select id, idx, clip_path from points
           where match_id=%s and not deleted order by idx""", (SRC_MATCH,))
    rows = cur.fetchall()
    idx_to_new = {}
    for old_id, idx, clip_path in rows:
        new_id = str(uuid.uuid4())
        idx_to_new[idx] = new_id
        new_clip = None
        if clip_path:
            new_clip = copy_object(
                clip_path, f"{points_prefix}/{Path(clip_path).name}")
        cur.execute(
            """insert into points (id, match_id, idx, t0, t1, clip_path,
                 server, placement, suggestion, confirmed_winner,
                 confirmed_how, starred, deleted, edited, warmup,
                 server_override, is_let, cut_t0, tight_start, tight_end,
                 game_end_override, direction, serve_spin, serve_sidespin,
                 serve_length, loss_reasons)
               select %s, %s, idx, t0, t1, %s, server, placement,
                 suggestion, confirmed_winner, confirmed_how, %s, deleted,
                 edited, warmup, server_override, is_let, cut_t0,
                 tight_start, tight_end, game_end_override, direction,
                 serve_spin, serve_sidespin, serve_length, loss_reasons
               from points where id=%s""",
            (new_id, new_match, new_clip, idx in STARS, old_id))

    def note(idx, author, body):
        cur.execute(
            """insert into notes (id, match_id, point_id, author_id, body)
               values (%s, %s, %s, %s, %s)""",
            (str(uuid.uuid4()), new_match, idx_to_new[idx], author, body))

    note(38, REVIEWER_USER,
         "Best rally of the night. The wide block set up the counter.")
    note(33, COACH_USER,
         "Strong second game. Serve variation won you the close points, "
         "keep opening with it.")
    note(41, COACH_USER,
         "You backed off the table here. Hold your ground on the third ball.")

    print(json.dumps({"match": new_match, "points": len(rows),
                      "clips_copied": sum(1 for *_, c in rows if c)}))


if __name__ == "__main__":
    main()
