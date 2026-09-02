#!/usr/bin/env python3
"""Why no serve was found inside each card that has none.

The serve detector does not score a serve, it accepts a bounce PAIR. Six
rules stand between a pair and acceptance, so the honest way to explain a
card with no serve is to walk the same six over the same bounces and
record which one turned each pair away. Guessing from the outside — "the
camera is flat", "the ball was occluded" — is how a morning gets spent on
the wrong rule.

The constants come from points_v2 by import rather than by copy. A page
built on numbers that have drifted from the detector is worse than no
page, because it reads as evidence.

Reads the evidence dumps a research_reprocess run left in its workroot and
writes `<id>.serves.json` beside the bundle in R2, for /research/serve-misses.

    python research_serve_misses.py --workroot <dir> [--prefix research/crossings]
"""
import argparse
import bisect
import json
import logging
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from points_v2 import (  # noqa: E402
    APEX_MIN_PX, BACKTRACK_MAX_M, NET_MARGIN_M, NET_V, PAIR_MAX_S,
    PRIOR_CROSS_MAX, PRIOR_CROSS_WINDOW_S, homography_from_corners,
    on_surface, project, serve_motifs,
)
import points_v2  # noqa: E402
from research_reprocess import MEDIA_BUCKET, PREFIX, config, s3_client  # noqa: E402
try:  # package import in tests; direct import in worker scripts
    from .inferred_bounces import (CardInput, HardBounce, KnownContact,
                                   Observation, infer_card_bounces)
except ImportError:  # pragma: no cover - exercised by script entry points
    from inferred_bounces import (CardInput, HardBounce, KnownContact,
                                  Observation, infer_card_bounces)


log = logging.getLogger(__name__)


def apply_shipped_settings(env, pad=None, merge=None):
    """Match the constants production is actually running.

    Two of the serve rule's constants are read per job from app_config
    (`serve_surface_pad_m`, `serve_merge_s`) rather than fixed in the source,
    so importing points_v2 gives the module DEFAULTS, not what shipped. This
    page was generated that way and drifted the moment those settings moved:
    after the 2026-08-28 widening it went on reporting 216 cards with no serve
    where production had 175. That is exactly what this file's own docstring
    warns about - a page built on drifted numbers reads as evidence.
    """
    if pad is None or merge is None:
        try:
            import psycopg2
            with psycopg2.connect(env["DATABASE_URL"]) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "select key, value from public.app_config where key "
                        "in ('serve_surface_pad_m','serve_merge_s')")
                    got = dict(cur.fetchall())
            pad = pad if pad is not None else float(got["serve_surface_pad_m"])
            merge = merge if merge is not None else float(got["serve_merge_s"])
        except Exception as e:
            # Fail LOUD. Silently generating at the defaults is how this page
            # drifted in the first place.
            raise SystemExit(
                f"could not read the shipped serve settings: {e}\n"
                "pass --serve-surface-pad and --serve-merge-s to run anyway")
    points_v2.PAIR_SURFACE_PAD_M = float(pad)
    points_v2.CLUSTER_S = float(merge)
    return float(pad), float(merge)

CORNER_ORDER = ["A_near_1", "B_near_2", "C_far_2", "D_far_1"]


def net_segment(H):
    """The physical net's image: (u=0, v=L/2) and (u=W, v=L/2) mapped back
    through the calibration, as [[x, y], [x, y]].

    Until 2026-09-02 this was the pixel midpoint of the sidelines, which
    under perspective sits 30-41 cm into the NEAR half on every camera
    measured — the far half of the table is compressed, so the real net is
    always nearer the far end than the pixel midpoint. Every decision rule
    already projected through H and was unaffected; only the drawn line
    (and anyone judging against it) was wrong.
    """
    inv = np.linalg.inv(np.asarray(H, float))

    def unproject(u, v):
        p = inv @ np.array([u, v, 1.0])
        return [float(p[0] / p[2]), float(p[1] / p[2])]

    return [unproject(0.0, points_v2.L_M / 2.0),
            unproject(points_v2.W_M, points_v2.L_M / 2.0)]

# Every way a pair can be turned away, in the order the detector applies
# them. The text is what the page shows, so it says what happened rather
# than naming the constant that stopped it.
REASONS = {
    "no_pair": "fewer than two bounces to pair at all",
    "off_surface": "the bounces did not land on the table surface",
    "same_side": "both bounces on the same half of the table",
    "too_far_apart": f"more than {PAIR_MAX_S}s between the two bounces",
    "on_the_net_line": f"a bounce sat within {NET_MARGIN_M}m of the net",
    "no_apex": "the ball never rose off the table between them",
    "backtracked": "the ball travelled backwards on the way",
    "rally_running": "a rally was already in progress",
    "would_have_passed": "these rules alone would have accepted a pair here",
}


def bounce_pixels(blob):
    """Bounces carry a time and an on-table flag; their position comes from
    the nearest tracked frame, which is how research_shape draws them too."""
    track = [(float(t), float(x), float(y)) for t, x, y in blob["track"]]
    times = [p[0] for p in track]
    out = []
    for t, on_table in blob["bounces"]:
        i = min(bisect.bisect_left(times, t), len(track) - 1)
        if i > 0 and abs(times[i - 1] - t) < abs(times[i] - t):
            i -= 1
        out.append((float(t), track[i][1], track[i][2], int(on_table)))
    return track, times, out


def walk_rules(t0, t1, bnc, track, times, crossings, H):
    """Every pair inside one card, and the first rule that rejected it."""
    inside = [b for b in bnc if t0 <= b[0] <= t1]
    proj = [(t, x, y, project(H, x, y), on_tbl) for t, x, y, on_tbl in inside]
    surface = [p for p in proj if p[3] and on_surface(p[3])]

    res = {"bounces": len(inside), "on_surface": len(surface),
           "pairs": 0, "rejects": {}, "reason": None, "detail": []}
    if len(inside) < 2:
        res["reason"] = "no_pair"
        return res, proj
    if len(surface) < 2:
        res["reason"] = "off_surface"
        return res, proj

    def bump(k):
        res["rejects"][k] = res["rejects"].get(k, 0) + 1

    cross = np.asarray(crossings, float)
    for i, (ta, xa, ya, pa, _) in enumerate(surface):
        for tb, xb, yb, pb, _ in surface[i + 1:]:
            dt = tb - ta
            if dt <= 0.05:
                continue
            res["pairs"] += 1
            note = None
            if dt > PAIR_MAX_S:
                note = "too_far_apart"
            elif (1 if pa[1] > NET_V else -1) == (1 if pb[1] > NET_V else -1):
                note = "same_side"
            elif (abs(pa[1] - NET_V) < NET_MARGIN_M
                  or abs(pb[1] - NET_V) < NET_MARGIN_M):
                note = "on_the_net_line"
            else:
                ia = bisect.bisect_left(times, ta)
                ib = bisect.bisect_left(times, tb)
                span = track[ia + 1:ib]
                if len(span) < 2:
                    note = "no_apex"
                else:
                    apex = min(p[2] for p in span)
                    if min(ya, yb) - apex < APEX_MIN_PX:
                        note = "no_apex"
                    else:
                        direction = 1 if pb[1] > pa[1] else -1
                        back, run = 0.0, pa[1]
                        for p in span:
                            q = project(H, p[1], p[2])
                            if not q:
                                continue
                            d = (q[1] - run) * direction
                            if d < 0:
                                back = max(back, -d)
                            run = q[1]
                        if back > BACKTRACK_MAX_M:
                            note = "backtracked"
                        elif len(cross) and int(
                            ((cross >= ta - PRIOR_CROSS_WINDOW_S)
                             & (cross < ta - 0.05)).sum()) > PRIOR_CROSS_MAX:
                            note = "rally_running"
            res["detail"].append([round(ta, 2), round(tb, 2),
                                  note or "would_have_passed"])
            if note is None:
                res["reason"] = "would_have_passed"
                return res, proj
            bump(note)
            if note == "too_far_apart":
                break        # the inner loop is time-ordered, as in the detector
    res["reason"] = (max(res["rejects"].items(), key=lambda kv: kv[1])[0]
                     if res["rejects"] else "no_pair")
    return res, proj


def anchored_serves(blob, H):
    """Which serves the detector finds NOW, not when the bundle was written.

    Each stored card carries the serve time the reprocess run found, and this
    file used to select "cards with no serve" by testing that value for None.
    That value froze at whatever constants were live that day, so after the
    2026-08-28 widening the page went on showing 41 cards whose serve
    production had since learned to find. Recomputing costs milliseconds.
    """
    fps = float(blob["fps"])
    track = {}
    for t, x, y in blob["track"]:
        track[int(round(t * fps))] = (float(x), float(y))
    bounces = []
    for t, _on_table in blob["bounces"]:
        f = int(round(t * fps))
        if f in track:
            bounces.append((f, track[f][0], track[f][1]))
    # serve_motifs measures the apex in PIXELS and scales it by video width; a
    # 640-wide match judged at 1.0 loses real serves silently.
    scale = float(blob["w"]) / 1920.0
    motifs = serve_motifs(track, sorted(bounces), H, fps, scale,
                          [float(t) for t in blob.get("crossings") or []])
    # The PAIR, not just the contact. A card shows every bounce the detector
    # saw and they all look alike; which two of them the serve rule actually
    # accepted is the thing you want to see, and it is thrown away here if
    # only the contact time survives.
    return sorted(
        ({"contact": round(m["contact_s"], 2),
          "bounces": [round(m["bounce1_s"], 2), round(m["bounce2_s"], 2)]}
         for m in motifs),
        key=lambda m: m["contact"])


def tracked_runs(track, t0, t1, fps):
    """Stretches inside the card where the ball was actually being tracked.

    The card's own `track` is decimated on the way out, so counting its
    points is not a reading of how well the ball was held — every third
    frame looks like a gap that is not there. These runs are computed from
    the undecimated track and shipped separately.

    A run breaks on a gap of more than four frames, which is a seventh of a
    second at 30fps: long enough that a couple of dropped detections in a
    fast rally stay one bar, short enough that losing the ball behind a
    player shows up as the break it is.
    """
    max_gap = 4.0 / max(fps, 1.0)
    runs, start, last = [], None, None
    for t, _x, _y in track:
        if t < t0:
            continue
        if t > t1:
            break
        if start is None:
            start, last = t, t
        elif t - last > max_gap:
            runs.append([round(start, 2), round(last, 2)])
            start = t
        last = t
    if start is not None:
        runs.append([round(start, 2), round(last, 2)])
    return runs


def card_audio_slice(audio, t0, t1):
    """The envelope and the impacts that fall inside one card.

    Sliced rather than shipped whole: a match is mostly not cards, and the
    portal only ever draws the audio under a card it is showing.

    `t0` is the time of the FIRST bin returned, not the card's start. The
    bins are on the file's own grid and a card does not begin on one, so a
    reader that assumed otherwise would draw the envelope up to a bin early.
    """
    if not audio:
        return None
    bin_s = float(audio["bin_s"])
    wave = audio["wave"]
    i0 = max(0, int(t0 / bin_s))
    i1 = min(len(wave), int(t1 / bin_s) + 1)
    return {
        "t0": round(i0 * bin_s, 3),
        "bin": round(bin_s, 3),
        "wave": wave[i0:i1],
        "impacts": [[round(t, 2), c] for t, c in audio["impacts"]
                    if t0 <= t <= t1],
    }


def build(blob, include_all=False, observation_confidence=None,
          confidence_provenance="missing", known_contacts=()):
    """Per-card evidence for one match.

    `include_all` is what the admin portal asks for. The research page wants
    only the cards with no serve, because its question is why the detector
    refused; the portal's question is broader — was the placement right, was
    the FIRST bounce right — and that has to be answerable on a card whose
    serve was found. Same walk either way, so the two views can never
    disagree about a card they both show.
    """
    quad_d = blob.get("quad")
    if not quad_d:
        raise ValueError("no table quad; nothing to project against")
    H = homography_from_corners({k: tuple(v) for k, v in quad_d.items()})
    quad = [[float(quad_d[k][0]), float(quad_d[k][1])] for k in CORNER_ORDER]
    net = net_segment(H)

    track, times, bnc = bounce_pixels(blob)
    w, h = float(blob["w"]), float(blob["h"])
    serves = anchored_serves(blob, H)
    cards = []
    for card in blob["cards"]:
        t0, t1 = float(card[0]), float(card[1])
        # Recomputed against today's constants, not the value frozen into
        # the bundle — see anchored_serve_times.
        inside = [m for m in serves if t0 <= m["contact"] <= t1]
        if inside and not include_all:
            continue
        res, proj = walk_rules(t0, t1, bnc, track, times,
                               blob["crossings"], H)
        ia = bisect.bisect_left(times, t0)
        ib = bisect.bisect_left(times, t1)
        output_card = {
            "t0": round(t0, 2), "t1": round(t1, 2),
            "dur": round(t1 - t0, 2),
            # Where the detector put bat on ball, or null when it found
            # none. The portal reads this to tell an anchored card from a
            # refused one; the research page only ever gets nulls.
            "serve_s": inside[0]["contact"] if inside else None,
            # The two bounces the serve rule accepted, so the page can pick
            # them out of the ten the card carries.
            "serve_bounces": inside[0]["bounces"] if inside else None,
            # fractions of the frame, so the overlay survives any size
            "track": [[round(t, 2), round(x / w, 5), round(y / h, 5)]
                      for t, x, y in track[ia:ib]],
            "bounces": [{
                "t": round(t, 2),
                "x": round(x / w, 5), "y": round(y / h, 5),
                "u": round(p[0], 3) if p else None,
                "v": round(p[1], 3) if p else None,
                "onTable": bool(on_tbl),
                "onSurface": bool(p and on_surface(p)),
            } for t, x, y, p, on_tbl in proj],
            "crossings": [round(float(s), 2) for s in blob["crossings"]
                          if t0 <= s <= t1],
            # Where the ball was held, from the undecimated track.
            "seen": tracked_runs(track, t0, t1, float(blob["fps"])),
            # What the microphone heard. Absent on every match processed
            # before the worker learned to listen, which the page shows as
            # "not measured" rather than as silence.
            "audio": card_audio_slice(blob.get("audio"), t0, t1),
            "why": res,
        }
        if include_all:
            try:
                fps = float(blob["fps"])
                measured = confidence_provenance == "measured"
                observations = []
                for t, x, y in track[ia:ib]:
                    frame = int(round(t * fps))
                    confidence = (observation_confidence or {}).get(frame)
                    has_measurement = bool(
                        measured and confidence is not None
                        and np.isfinite(float(confidence))
                    )
                    observations.append(Observation(
                        float(t), float(x), float(y),
                        float(confidence) if has_measurement else None,
                        has_measurement,
                    ))
                hard_bounces = tuple(HardBounce(
                    float(t), float(x), float(y),
                    float(p[0]) if p else None,
                    float(p[1]) if p else None,
                    bool(on_tbl and p and on_surface(p)),
                ) for t, x, y, p, on_tbl in proj)
                audio = output_card["audio"] or {}
                impacts = tuple(
                    (float(t), float(strength))
                    for t, strength in audio.get("impacts", [])
                )
                calibration = blob.get("calibration")
                healthy = not (isinstance(calibration, dict)
                               and calibration.get("healthy") is False)
                shadow_input = CardInput(
                    t0=t0,
                    t1=t1,
                    fps=fps,
                    width_px=w,
                    height_px=h,
                    observations=tuple(observations),
                    hard_bounces=hard_bounces,
                    crossings=tuple(float(s) for s in blob["crossings"]
                                    if t0 <= float(s) <= t1),
                    audio_impacts=impacts,
                    homography=H,
                    accepted_serve_bounces=tuple(
                        float(t) for t in (
                            inside[0]["bounces"] if inside else []
                        )
                    ),
                    known_contacts=tuple(
                        contact for contact in known_contacts
                        if isinstance(contact, KnownContact)
                        and t0 <= contact.t <= t1
                    ),
                    calibration_healthy=healthy,
                )
                output_card["inferred_bounce_evidence"] = (
                    infer_card_bounces(shadow_input)
                )
            # This field is diagnostic-only.  An unforeseen shadow bug must
            # omit its envelope, never abort the Admin artifact or upload.
            except Exception as e:
                log.warning("inferred-bounce shadow skipped card %.2f-%.2f: %s",
                            t0, t1, e)
        cards.append(output_card)
    return {
        "key": blob["match_id"],
        "w": w, "h": h,
        "duration": blob["duration"],
        "quad": quad, "net": net, "prism": blob.get("prism") or quad,
        "cards": cards,
        "total_cards": len(blob["cards"]),
        "meta": {
            "opponent": blob.get("opponent"), "venue": blob.get("venue"),
            "created": blob.get("created"), "route": blob.get("route"),
            "serves_per_min": blob.get("serves_per_min"),
            "camera": blob.get("camera"),
            "calibration": blob.get("calibration"),
        },
        "reasons": REASONS,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workroot", required=True)
    ap.add_argument("--prefix", default=PREFIX)
    ap.add_argument("--no-upload", action="store_true")
    ap.add_argument("--serve-surface-pad", type=float, default=None,
                    help="override app_config.serve_surface_pad_m")
    ap.add_argument("--serve-merge-s", type=float, default=None,
                    help="override app_config.serve_merge_s")
    ap.add_argument("ids", nargs="*")
    args = ap.parse_args()

    env = config()
    pad, merge = apply_shipped_settings(env, args.serve_surface_pad,
                                        args.serve_merge_s)
    print(f"serve rule at the shipped settings: surface pad {pad} m, "
          f"merge {merge} s")
    s3 = None if args.no_upload else s3_client(env)
    for name in sorted(os.listdir(args.workroot)):
        if args.ids and name not in args.ids:
            continue
        src = os.path.join(args.workroot, name, "evidence.json")
        if not os.path.exists(src):
            continue
        with open(src) as fh:
            blob = json.load(fh)
        try:
            page = build(blob)
        except ValueError as e:
            print(f"{name[:8]}  skipped: {e}")
            continue
        # Stamped so the page can say which settings produced it. A number
        # with no provenance is what made this page wrong for a fortnight.
        page["meta"]["serve_surface_pad_m"] = pad
        page["meta"]["serve_merge_s"] = merge
        dest = os.path.join(args.workroot, name, "serves.json")
        with open(dest, "w") as fh:
            json.dump(page, fh, separators=(",", ":"))
        if s3:
            s3.upload_file(dest, MEDIA_BUCKET,
                           f"{args.prefix}/{name}.serves.json",
                           ExtraArgs={"ContentType": "application/json"})
        tally = {}
        for c in page["cards"]:
            tally[c["why"]["reason"]] = tally.get(c["why"]["reason"], 0) + 1
        top = ", ".join(f"{v} {k}" for k, v in
                        sorted(tally.items(), key=lambda kv: -kv[1])[:3])
        print(f"{name[:8]}  {len(page['cards']):3d} of "
              f"{page['total_cards']:3d} cards with no serve  ->  {top}"
              f"   ({os.path.getsize(dest) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
