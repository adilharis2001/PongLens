#!/usr/bin/env python3
"""Clone the Adil vs Gui match onto the demo account as 'Alex'.

    cd worker && venv/bin/python ../scripts/demos/clone_match.py

Demo staging (July 2026). Creates a demo-owned copy of match
a0fb8f44 (same R2 media, new rows): all 60 points with their real
scoring and vision output, plus staged extras — stars and tags on
game-2 points (idx 26-42, where the opponent plays the near side with
his back to the camera), a player note, two coach notes from Miguel,
and an annotated-frame note whose sketch is generated from the real
clip frame. Prints the new match id; idempotent-ish (refuses to run
twice by checking for an existing demo 'Alex' clone of this cut).
"""

import io
import json
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "worker"))
import worker  # noqa: E402

from PIL import Image, ImageDraw  # noqa: E402

SRC_MATCH = "a0fb8f44-89b1-464e-a2a5-388b502dbda5"
DEMO_USER = "6eb09df4-7d44-4ef9-b1cc-8cdfc4119fc4"
COACH_USER = "f15e9358-a722-4d07-9a0d-3379c696497a"
MEDIA_BUCKET = "ponglens-media"

STARS = {35, 37, 52}
HOWS = {  # idx -> (confirmed_how, direction, serve_spin, serve_sidespin, serve_length)
    33: ("clean_winner", "fh", None, None, None),
    36: ("service_ace", None, "back", True, "short"),
    37: ("clean_winner", "bh", None, None, None),
    39: ("receive_error", None, "top", False, "long"),
}
TAG_POINTS = {
    "footwork": [33, 35],
    "third ball attack": [37, 40],
    "backhand error": [41, 54],
}

SKETCH_IDX = 37


def make_sketch(clip_bytes: bytes) -> bytes:
    """A frame from the clip with Annotator-style cyan strokes drawn on."""
    with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
        f.write(clip_bytes)
        f.flush()
        dur = float(subprocess.check_output(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "csv=p=0", f.name]).strip() or 3)
        frame = subprocess.check_output(
            ["ffmpeg", "-v", "quiet", "-ss", str(dur * 0.55), "-i", f.name,
             "-frames:v", "1", "-f", "image2", "-vcodec", "mjpeg", "-"])
    img = Image.open(io.BytesIO(frame)).convert("RGB")
    w, h = img.size
    d = ImageDraw.Draw(img)
    cyan = (34, 211, 238)
    # an arc over the near half (the footwork path)...
    import math
    arc = [(w * (0.3 + t * 0.28),
            h * (0.72 - math.sin(t * math.pi) * 0.16)) for t in
           [i / 20 for i in range(21)]]
    d.line(arc, fill=cyan, width=max(4, w // 180), joint="curve")
    # ...and an arrow to where the counter should land
    x1, y1, x2, y2 = w * 0.6, h * 0.38, w * 0.8, h * 0.55
    d.line([(x1, y1), (x2, y2)], fill=cyan, width=max(4, w // 180))
    ang = math.atan2(y2 - y1, x2 - x1)
    ah = w // 45
    for da in (2.6, -2.6):
        d.line([(x2, y2), (x2 + ah * math.cos(ang + da),
                           y2 + ah * math.sin(ang + da))],
               fill=cyan, width=max(4, w // 180))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=88)
    return out.getvalue()


def main():
    conn = worker.connect()
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("select cut_path from matches where id=%s", (SRC_MATCH,))
    src_cut = cur.fetchone()[0]
    cur.execute(
        "select id from matches where user_id=%s and cut_path=%s",
        (DEMO_USER, src_cut))
    if cur.fetchone():
        sys.exit("demo clone already exists; refusing to clone twice")

    new_match = str(uuid.uuid4())
    cur.execute(
        """insert into matches (id, user_id, job_id, opponent_name, played_at,
             cut_path, match_json_path, status, user_side, player_near_name,
             player_far_name, match_type, first_server, venue, thumb_path)
           select %s, %s, job_id, 'Alex', '2026-07-26', cut_path,
             match_json_path, status, user_side, null, null, 'league',
             first_server, venue, thumb_path
           from matches where id=%s""",
        (new_match, DEMO_USER, SRC_MATCH))

    cur.execute(
        """select id, idx from points where match_id=%s and not deleted
           order by idx""", (SRC_MATCH,))
    idx_to_new = {}
    for old_id, idx in cur.fetchall():
        new_id = str(uuid.uuid4())
        idx_to_new[idx] = new_id
        cur.execute(
            """insert into points (id, match_id, idx, t0, t1, clip_path,
                 server, placement, suggestion, confirmed_winner,
                 confirmed_how, starred, deleted, edited, warmup,
                 server_override, is_let, cut_t0, tight_start, tight_end,
                 game_end_override, direction, serve_spin, serve_sidespin,
                 serve_length, loss_reasons)
               select %s, %s, idx, t0, t1, clip_path, server, placement,
                 suggestion, confirmed_winner, confirmed_how, %s, deleted,
                 edited, warmup, server_override, is_let, cut_t0,
                 tight_start, tight_end, game_end_override, direction,
                 serve_spin, serve_sidespin, serve_length, loss_reasons
               from points where id=%s""",
            (new_id, new_match, idx in STARS, old_id))

    for idx, (how, direction, spin, side, length) in HOWS.items():
        cur.execute(
            """update points set confirmed_how=%s, direction=%s,
                 serve_spin=%s, serve_sidespin=%s, serve_length=%s
               where id=%s""",
            (how, direction, spin, side, length, idx_to_new[idx]))

    for label, idxs in TAG_POINTS.items():
        cur.execute(
            "select id from tags where owner_id=%s and label=%s",
            (DEMO_USER, label))
        row = cur.fetchone()
        if not row:
            print(f"tag {label!r} missing, skipping")
            continue
        for idx in idxs:
            cur.execute(
                """insert into point_tags (point_id, tag_id, created_by)
                   values (%s, %s, %s) on conflict do nothing""",
                (idx_to_new[idx], row[0], DEMO_USER))

    def note(idx, author, body, image_path=None):
        cur.execute(
            """insert into notes (id, match_id, point_id, author_id, body,
                 image_path)
               values (%s, %s, %s, %s, %s, %s)""",
            (str(uuid.uuid4()), new_match, idx_to_new[idx], author, body,
             image_path))

    note(38, DEMO_USER,
         "Best rally of the night. The wide block set up the counter.")
    note(33, COACH_USER,
         "Strong second game. Serve variation won you the close points, "
         "keep opening with it.")
    note(41, COACH_USER,
         "You backed off the table here. Hold your ground on the third ball.")

    # annotated-frame note: sketch generated from the point's real clip
    cur.execute("select clip_path from points where id=%s",
                (idx_to_new[SKETCH_IDX],))
    loc = worker.parse_r2_path(cur.fetchone()[0])
    clip = worker.r2().get_object(Bucket=loc[0], Key=loc[1])["Body"].read()
    sketch = make_sketch(clip)
    key = f"sketch/{DEMO_USER}/{uuid.uuid4()}.jpg"
    worker.r2().put_object(Bucket=MEDIA_BUCKET, Key=key, Body=sketch,
                           ContentType="image/jpeg")
    note(SKETCH_IDX, DEMO_USER,
         "Step around earlier here. The arrow marks where the counter "
         "should land.",
         f"r2://{MEDIA_BUCKET}/{key}")

    # the old featured demo match steps aside
    cur.execute(
        "update matches set opponent_name='Marco' where id=%s",
        ("aa42d3b9-2109-4e02-a638-10297d0606e8",))

    print(json.dumps({"match": new_match,
                      "p37": idx_to_new[37], "sketch": key}))


if __name__ == "__main__":
    main()
