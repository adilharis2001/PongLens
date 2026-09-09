"""Serve rule, second bounce only.

Production needs TWO bounces on opposite halves. When the server's own half
is hidden — a body in the way, a camera behind them — the first bounce is
never seen and the whole pair fails. This drops that requirement and keeps
the rest:

    a BOUNCE on the table                       (not merely a ball position:
                                                 that is what fired 393 times)
    the ball ARRIVED from off the table         (it came onto the table,
                                                 rather than already rallying)
    optionally, it came from a PERSON            (the server's own box)
    no rally already running                     (production's own
                                                 PRIOR_CROSS_WINDOW test)

Every gate is switchable so the effect of each can be read separately.
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))          # the worker directory
import points_v2 as V2                                            # noqa: E402
from points_v2 import (bounces, build_track, homography_from_corners,   # noqa: E402
                       load_multi, project)

PAD = 0.10

# THE MATCH'S OWN FRAME RATE, set once per run by serve_v3.configure().
#
# In the lab this came from labmatch, one module per match. Here the module
# global is assigned before any rule runs, which is safe because the worker
# gives each match its own process, and it is what keeps the code below
# character-for-character the lab's. A default of 30 is not a fallback worth
# having, so configure() refuses a rate it was not given.
FPS = 30.0

# EVERY RAW PIXEL LENGTH AND RAW FRAME COUNT LEFT IN THE LIVE PATH, CONVERTED.
#
# The file's own rule at the top of this module -- lengths in table widths,
# durations in seconds -- is kept everywhere except in five places that were
# added later and slipped through. They are a no-op on the seven-match corpus
# (all ~30fps; tables 194 to 378px) and they are not a no-op on a 60fps upload
# or a closer camera, which is what the rule exists to protect against.
#
#   hands_still_px  1px   "the tracker has not moved"      -> table widths
#   hands_parked_px 8px   "beside a spot it was parked on" -> table widths
#   boxes_at        6 people-frames of lookback            -> seconds
#   slow_at         3 frames between neighbours            -> seconds
#   _held_n         a 40-entry slice of the track          -> seconds
#
# V3_PORTABLE=1 turns them all on together; each also has its own flag.
# Portable units are not optional here: production takes 60 fps uploads,
# and the corpus these rules were measured on is 30 fps, where the five
# raw constants below happen to agree with their converted forms.
PORTABLE = True


def _flag(_name):
    return True


# EVERY LENGTH IN THIS FILE IS A MULTIPLE OF THE TABLE'S OWN WIDTH, and every
# duration is in seconds. Neither is decoration.
#
# A threshold written in raw pixels only means what it meant on the camera it
# was chosen on. On 89b35ee0 the table's end line is 221px across, so "250px"
# is really "about one table width". Film the same match from twice as far
# away and 250px becomes two and a half table widths, and a rule that removed
# two junk detections starts removing real serves. The same applies in time:
# "4 frames" is 0.13s at 30fps and 0.07s at 60fps, and PongLens already takes
# 60fps uploads.
#
# So: `_table_w` converts, the callers pass table widths and seconds, and the
# only place a raw pixel or a frame count appears is inside the conversion.


# The table width every threshold in this lab was measured against: 89b35ee0
# at 1920 wide. Anything expressed as a multiple of the table converts
# through `_table_w`; production's own BOUNCE_REVERSAL_PX / BOUNCE_MOTION_PX
# convert through this ratio instead, because `bounces` takes a `scale`
# argument for exactly that and every caller in the repo passes 1.0.
# Carried to full precision on purpose. BOUNCE_REVERSAL_PX is 1.0, so a
# ratio of 1.0002 rather than 1.0 is enough to move five bounces on this
# match -- and this file's whole job is to leave 89b35ee0 untouched while
# becoming portable.
TABLE_W_REF = 220.81102434502495


def _table_w(quad):
    """Pixels per table WIDTH — the mean of the two 1.525 m end lines.

    The end lines are used rather than the sides because both are the same
    real length, so the mean of the two absorbs most of the perspective:
    on 89b35ee0 the near line is 241px and the far one 200px, and the mean,
    221px, is the width of the table halfway down. That is where a serve
    happens. The sides would have to be halved to compare and would carry
    the foreshortening straight into the answer.
    """
    (ax, ay), (bx, by), (cx, cy), (dx, dy) = quad
    near = ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5
    far = ((dx - cx) ** 2 + (dy - cy) ** 2) ** 0.5
    return (near + far) / 2.0


def _pad_ok(quad, H_, x, y, padpx, ends_only):
    """The picture's answer to "is this on the table", used beside the metre one.

    ends_only keeps the extra tolerance to the ENDS of the table, where the
    metre test is unfairly tight, and refuses it at the sides, where it is
    not. That is not tidiness -- it is what the two populations look like.
    Of the 71 bounces the metre test rejects and a 0.03-width pixel pad
    would accept on 89b35ee0, 45 sit just past an end line with the ball
    between the sidelines (v = 2.84 to 3.03: long serves, exactly the shape
    of Adil's 19:43), and 26 sit just OUTSIDE a sideline (u = -0.11 to
    -0.22: balls off the table sideways, which is what the metre test is
    right to refuse). Widening in both directions at once buys the first
    group and the second, and the second costs three points their card.
    """
    if _quad_gap(quad, x, y) > padpx:
        return False
    if not ends_only:
        return True
    p = project(H_, x, y)
    return bool(p and -PAD <= p[0] <= V2.W_M + PAD)


def derived(quad, fps=None, table_run_s=0.0, table_run_w=0.54,
            table_run_hole_s=0.10, table_run_jump_w=0.0,
            person_jump_w=16.3, person_hole_s=0.10, **_ignored):
    """The pixel and frame values a given camera turns the settings into.

    Exists so the conversion can be tested and printed without reaching
    inside `serves`, and so a future session can see at a glance what a
    match's own camera makes of these numbers.
    """
    fps = fps or FPS
    tw = _table_w(quad)
    return dict(
        table_w_px=round(tw, 1),
        table_run_jump=round(table_run_jump_w * tw / fps, 1),
        table_run=0 if table_run_s <= 0 else max(1, int(round(table_run_s * fps))),
        table_run_px=round(table_run_w * tw, 1),
        table_run_hole=max(1, int(round(table_run_hole_s * fps))),
        person_jump=round(person_jump_w * tw / fps, 1),
        person_hole=int(round(person_hole_s * fps)))


def _quad_gap(quad, x, y):
    """Pixels from (x, y) to the table quad. 0 inside, positive outside."""
    best = 1e9
    inside = False
    n = len(quad)
    for i in range(n):
        ax, ay = quad[i]
        bx, by = quad[(i + 1) % n]
        # distance to the segment a->b
        dx, dy = bx - ax, by - ay
        t = 0.0 if dx == dy == 0 else max(0.0, min(
            1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
        best = min(best, ((x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2) ** 0.5)
        if (ay > y) != (by > y) and x < ax + (y - ay) / (by - ay) * dx:
            inside = not inside
    return 0.0 if inside else best


def serves(calib, b, EB, H, track, people,
           need_bounce=True, need_arrival=True, need_person=False,
           no_rally=True, arrival_gap=0.5, person_pad=0.25,
           bounce_within=0.0, min_travel=0.0, travel_win=0.5,
           quiet_bounces=0, quiet_win=1.5,
           person_bounce_fallback=False,
           person_jump_w=16.3, person_hole_s=0.10, person_frac=0.0,
           person_near_w=0.0,
           player_at=None,
           fallback_near_only=False, fallback_pair_win=0.0,
           table_run_s=0.0, table_run_w=0.54, table_run_hole_s=0.10,
           table_run_jump_w=0.0, net_margin_m=0.0, collect=None,
           unpaired_stay_s=0.0, unpaired_fast_w=0.0,
           unpaired_stay_pct=0.0, unpaired_fast_pct=0.0, calib_min=30,
           net_margin_paired_only=False,
           bounce_pad_w=None, bounce_pad_ends_only=True,
           fps=None, gate_log=None,
           pair_trumps_person=False, pair_trumps_arrival=False,
           arrival_same_ball=False, person_abstain_if_far=False,
           arrival_ignore_held=False, held_pad=0.0,
           hands_box_per_frame=False, hands_drop_still_s=0.0,
           hands_empty_abstain=False, hands_still_px=1.0,
           hands_parked_px=0.0, hands_abstain_rally=None,
           unpaired_rally=None, cluster_prefer_paired=False,
           hands_look_in_box=False,
           hands_near_m=0.0, net_partner_clear_m=0.0, unpaired_occl_frac=0.0,
           hands_toss_column=False, held_slow_w=0.0, held_min_s=0.0,
           held_trumps_rally=False, held_trumps_arrival=False, held_rally=None,
           unpaired_next_gap=0.0, held_pad_slow_w=0.0, held_same_end=False,
           recent_needs_held=0.0):
    """[(contact_s, bounce_s, server_side)] under the chosen gates.

    The server falls out of the geometry for free: the arrival test catches
    the ball coming ONTO the table, and the first place it lands is the
    server's OWN half — the serve's first bounce. So the server is the half
    the bounce is on.

    This was inverted at first, on the assumption that the server's own
    bounce is usually hidden behind them and the one we see is the
    receiver's. Measured against the scorekeeper's rotation on 126 cards,
    that read 31%; the right way round reads 81%.
    """
    QUAD0 = [tuple(calib["corners"][k]) for k in
             ("A_near_1", "B_near_2", "C_far_2", "D_far_1")]
    PADPX = None if bounce_pad_w is None else bounce_pad_w * _table_w(QUAD0)
    on, strict, half = {}, {}, {}
    for f in sorted(track):
        p = project(H, *track[f])
        on[f] = bool(p and -PAD <= p[0] <= V2.W_M + PAD
                     and -PAD <= p[1] <= V2.L_M + PAD)
        strict[f] = on[f]
        if PADPX is not None and not on[f]:
            # "On the table" asked in the PICTURE as WELL as in metres, and
            # the two are OR'd rather than swapped. The metre pad is the
            # more generous of the two at the near end -- 10cm there is 14px
            # against this test's 7 -- so replacing it costs three points
            # their card. Adding to it costs nothing and recovers the far
            # end, where the metre test is impossibly tight.
            #
            # The serve at 19:43 has no frame the metre test calls on-table
            # until the ball has crossed the net and gone long, so its own
            # bounce sits 0.4s BEFORE the first candidate arrival and can
            # never qualify one.
            on[f] = _pad_ok(QUAD0, H, *track[f], PADPX, bounce_pad_ends_only)
        if p:
            # v = 0 is the NEAR end line (points_v2 canonicalises the quad
            # so A is the near end), so v below the midline is the near half
            half[f] = "near" if p[1] < V2.L_M / 2 else "far"
    fr = sorted(track)
    QUAD = [tuple(calib["corners"][k]) for k in
            ("A_near_1", "B_near_2", "C_far_2", "D_far_1")]

    # ------------------------------------------------------------------
    # Everything above is in table widths and seconds. Everything below is
    # in pixels and frames. This is the only place the two meet, and it is
    # the only place a camera-specific number is allowed to appear.
    #
    # On 89b35ee0: TW = 220.8px, FPS_ = 30, so the shipping settings come
    # out as table_run 4 frames within 121px with holes up to 3, and
    # person_jump 120px a frame over 3 frames -- the raw numbers these
    # rules were measured on.
    # ------------------------------------------------------------------
    FPS_ = float(fps or FPS)
    TW = _table_w(QUAD)   # px per table width; every length below converts through it
    table_run = 0 if table_run_s <= 0 else max(1, int(round(table_run_s * FPS_)))
    table_run_px = table_run_w * TW
    table_run_hole = max(1, int(round(table_run_hole_s * FPS_)))
    person_jump = person_jump_w * TW / FPS_          # table widths/s -> px/frame
    person_hole = int(round(person_hole_s * FPS_))
    # every table bounce, by production's own bounce finder
    #
    # WHICH BOUNCES COUNT AS "ON THE TABLE" -- and this is not the innocent
    # question it looks like.
    #
    # The default test is in TABLE METRES with a 10cm pad, which sounds
    # generous and is not. Perspective decides what 10cm is worth: at the
    # near end line it is 14 pixels, at the far end 7, and where the camera
    # sits almost level with the far end the projection flattens so far that
    # a bounce FIVE pixels outside the drawn quad reads as a quarter of a
    # metre past the end line.
    #
    # Adil's long serve at 19:43 is exactly that. The far player serves fast
    # and flat, the ball bounces on their own half -- 4.9px outside the quad
    # in the picture, v = 2.99 in table metres -- crosses the net, lands on
    # the near end line and goes long. Both bounces are thrown out of `bset`
    # as "off the table", so there is no qualifying bounce, and a serve that
    # is plain to watch produces nothing at all.
    #
    # `bounce_pad_w` asks the same question in the picture instead: how far
    # from the drawn table, as a fraction of its width. That is one number
    # meaning one thing everywhere on the table.
    bset = set()
    for f, x, y in bounces(track, 1.0):
        p = project(H, x, y)
        if p and -PAD <= p[0] <= V2.W_M + PAD and -PAD <= p[1] <= V2.L_M + PAD:
            bset.add(f)
        elif (bounce_pad_w is not None
              and _pad_ok(QUAD, H, x, y, bounce_pad_w * _table_w(QUAD),
                          bounce_pad_ends_only)):
            bset.add(f)

    cross = np.asarray([float(t) for t in EB.cross], float)
    # NOT `cand` -- that name is already taken by a local inside the loop,
    # and shadowing it replaces this list with a list of frame numbers.
    # A SERVE WITH BOTH BOUNCES OUTRANKS THE SOFTER TESTS. Adil's production-
    # parity idea: production opens a card on two bounces, opposite halves,
    # within 1.6s, and asks nothing else. When that pair is present the
    # arrival and hands tests below are asking for extra evidence of a thing
    # the pair has already proved. Both switches default off; measured
    # across three matches before either is turned on.
    _PAIR_F = int(round(1.6 * FPS_))
    _bs = sorted(bset)

    # ------------------------------------------------------------------
    # CAMERA GEOMETRY, READ OFF THE CORNERS (2026-09-06). Three rules below
    # depend on how this camera sees the table, and each asks its own
    # question through the homography rather than through a 'camera type':
    #   * hands_near_m       -- a ball up to this many METRES behind either end
    #                            line could be the ball being tossed. One metre
    #                            behind the near end is 0.74 table widths on
    #                            89b35ee0, 1.31 on d15aad4d and 2.49 on 77fc4dee,
    #                            so a fixed pixel band cannot say it.
    #   * net_partner_clear_m -- a near-net first bounce is a clean serve when
    #                            its partner lands this far past the net.
    #   * unpaired_occl_frac  -- the player at the other end hides that half of
    #                            the table, so a single visible bounce is what
    #                            a serve looks like from here.
    # ------------------------------------------------------------------
    _Hinv = np.linalg.inv(np.asarray(H, float))

    def _P(u, v):
        x, y, w = _Hinv @ np.array([u, v, 1.0])
        return (x / w, y / w)

    def _in_quad(poly, x, y):
        # convex polygon, consistent winding not assumed
        s = 0
        for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
            c = (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0)
            if abs(c) < 1e-9: continue
            if s == 0: s = 1 if c > 0 else -1
            elif (c > 0) != (s > 0): return False
        return True

    _BEHIND = None
    if hands_near_m > 0:
        _m = hands_near_m
        _BEHIND = [[_P(-0.5, 0.0), _P(V2.W_M + 0.5, 0.0), _P(V2.W_M + 0.5, -_m), _P(-0.5, -_m)],
                   [_P(-0.5, V2.L_M), _P(V2.W_M + 0.5, V2.L_M), _P(V2.W_M + 0.5, V2.L_M + _m), _P(-0.5, V2.L_M + _m)]]

    def _above_quad(q, x, y):
        # Inside the ground region, or anywhere ABOVE it in the picture: a
        # tossed ball is a metre or more off the floor, and from a low camera
        # that is hundreds of pixels above the patch of floor it stands on.
        # d15aad4d's point 51: the toss reads 250-350px above the region.
        ys = []
        for (x0, y0), (x1, y1) in zip(q, q[1:] + q[:1]):
            if (x0 <= x <= x1) or (x1 <= x <= x0):
                if abs(x1 - x0) < 1e-9: ys.extend([y0, y1])
                else: ys.append(y0 + (y1 - y0) * (x - x0) / (x1 - x0))
        return bool(ys) and y <= max(ys)

    def _behind_end(x, y):
        return _BEHIND is not None and any(_above_quad(q, x, y) for q in _BEHIND)

    _GRID = {}
    if unpaired_occl_frac > 0:
        for _h in ('near', 'far'):
            _vs = np.linspace(0.05, V2.NET_V - 0.05, 15) if _h == 'near' else np.linspace(V2.NET_V + 0.05, V2.L_M - 0.05, 15)
            _GRID[_h] = [_P(u, v) for u in np.linspace(0.05, V2.W_M - 0.05, 15) for v in _vs]

    def _half_cover(box, h):
        if not people or h not in _GRID: return 0.0
        _ox, _oy = people['crop'][0], people['crop'][1]
        x0, y0, x1, y1 = box[0] + _ox, box[1] + _oy, box[2] + _ox, box[3] + _oy
        return sum(1 for x, y in _GRID[h] if x0 <= x <= x1 and y0 <= y <= y1) / len(_GRID[h])

    def _pair_after(b0):
        h0 = half.get(b0)
        return h0 is not None and any(b0 < g <= b0 + _PAIR_F and half.get(g) not in (None, h0) for g in _bs)

    # Player boxes at a moment, and whether the ball at frame g sits inside
    # one. Hoisted out of the hands test so the arrival test can ask the
    # same question: a ball in a player's HAND is not a ball on the table,
    # however the projection reads it. See arrival_ignore_held.
    # HOW FAR BACK TO LOOK FOR THE PLAYERS' BOXES. Six people-frames is a fifth
    # of a second only while the people file is keyed on 30fps frames. The
    # boxes are written every fifth frame today, with four matches already
    # showing occasional ten-frame steps -- so this has about one frame of
    # margin and misses on 0.0 to 0.06% of frames. Sample the same 6 Hz on a
    # 60fps upload and every step is ten frames: `boxes_at` would answer None
    # three times in ten, and the person gate reads None as "no boxes" and
    # refuses the serve outright -- an INSERT, the expensive failure.
    # V3_BOXES_S says it in seconds.
    _BOX_BACK = "0.2"
    _box_back_f = (max(1, int(round(float(_BOX_BACK) * (people["fps"] if people else 30.0))))
                   if _BOX_BACK else 6)

    def boxes_at(t_s):
        if not people:
            return None
        pf_ = int(round(t_s * people["fps"]))
        box = None
        for k in range(pf_ - _box_back_f, pf_ + 1):
            if str(k) in people["frames"]:
                box = people["frames"][str(k)]
        return box

    def in_box_at(g, pad):
        box = boxes_at(g / FPS)
        if not box:
            return False
        _ox, _oy, W, Hh = people["crop"]
        bx, by = track[g]
        for q in box:
            x0, y0, x1, y1 = q[0] * W, q[1] * Hh, q[2] * W, q[3] * Hh
            w, h = x1 - x0, y1 - y0
            if (x0 - pad * w <= bx - _ox <= x1 + pad * w
                    and y0 - pad * h <= by - _oy <= y1 + pad * h):
                return True
        return False

    def in_column_at(g, pad):
        # THE TOSS COLUMN. A legal serve throws the ball near-vertically at
        # least 16 cm up, and most players throw it far higher -- above the
        # head, out of the top of their own box. A frame straight ABOVE a
        # player's box, within its width, is that player's toss.
        box = boxes_at(g / FPS)
        if not box:
            return False
        _ox, _oy, W, Hh = people["crop"]
        bx, by = track[g]
        for q in box:
            x0, y0, x1 = q[0] * W, q[1] * Hh, q[2] * W
            w = x1 - x0
            if x0 - pad * w <= bx - _ox <= x1 + pad * w and by - _oy < y0:
                return True
        return False

    _IDX = {g_: i_ for i_, g_ in enumerate(fr)}

    # THREE FRAMES between neighbouring detections is 0.10s at 30fps and 0.05s
    # at 60, and a 40-entry slice of the track is 1.3s at 30fps and 0.67s at
    # 60 -- just short of the 0.7s window it is meant to cover.
    _NEIGH = max(1, int(round(0.10 * FPS_))) if PORTABLE else 3
    _HELD_SLICE = max(40, int(round(0.75 * FPS_)) + 2) if PORTABLE else 40

    def slow_at(g, max_w):
        # A HELD BALL IS SLOW. ITTF 2.6.1: the ball rests freely on the open
        # palm of the stationary hand, then is thrown near vertically. Speed
        # read against the neighbouring tracked frames, in table widths a
        # second; a struck ball travels 5-15 m/s, a toss under 4 m/s.
        i_ = _IDX[g]; best = None
        for a_, c_ in ((fr[i_ - 1], g) if i_ > 0 else (None, None), (g, fr[i_ + 1]) if i_ + 1 < len(fr) else (None, None)):
            if a_ is None or c_ - a_ > _NEIGH: continue
            d = ((track[c_][0] - track[a_][0]) ** 2 + (track[c_][1] - track[a_][1]) ** 2) ** 0.5 / TW * FPS_ / (c_ - a_)
            best = d if best is None else min(best, d)
        return best is not None and best <= max_w

    def held_at(g, pad):
        return held_slow_w > 0 and in_box_at(g, pad) and slow_at(g, held_slow_w)

    def held_end_at(g, pad):
        # WHOSE hand: the end of the player whose box holds the slow ball.
        if not (held_slow_w > 0 and player_at is not None and slow_at(g, held_slow_w)):
            return None
        pl = player_at(g / FPS)
        if not pl or not people:
            return None
        _ox, _oy = people["crop"][0], people["crop"][1]
        bx, by = track[g][0] - _ox, track[g][1] - _oy
        ends = []
        for e_, q in pl.items():
            if not q: continue
            w, h = q[2] - q[0], q[3] - q[1]
            if q[0] - pad * w <= bx <= q[2] + pad * w and q[1] - pad * h <= by <= q[3] + pad * h:
                ends.append(e_)
        return ends[0] if len(ends) == 1 else None

    cands = []
    for i, f in enumerate(fr):
        if not on[f]:
            continue
        t = f / FPS
        _by_excuse = False
        _held_n = 0
        if held_slow_w > 0:
            _lo = int((t - 0.7) * FPS) - 1; _hi = int((t - 0.05) * FPS) + 1
            _held_n = sum(1 for g in fr[max(0, i - _HELD_SLICE):i] if _lo <= g <= _hi and t - 0.7 <= g / FPS < t - 0.05 and held_at(g, person_pad))
        _held = held_min_s > 0 and _held_n >= max(1, int(round(held_min_s * FPS_)))
        if need_bounce:
            if bounce_within > 0:
                # "passes onto the table AND THEN bounces": the arrival need
                # not itself be the bounce, but one has to follow it shortly.
                # Requiring them on the same frame lost a third of the real
                # serves, because the ball is still in flight when it first
                # projects inside the table.
                if not any(f <= g <= f + int(bounce_within * FPS) for g in bset):
                    if gate_log is not None: gate_log.append((f, 'bounce'))
                    continue
            elif f not in bset:
                if gate_log is not None: gate_log.append((f, 'bounce'))
                continue
        # The bounce that qualified this arrival. Hoisted above the person
        # gate because the gate's fallback needs the half it landed on.
        bf = f
        if bounce_within > 0:
            cand = [g for g in bset if f <= g <= f + int(bounce_within * FPS)]
            if cand:
                bf = min(cand)
        if _held and held_same_end:
            # THE BALL RESTS IN THE SERVER'S HAND AND FIRST BOUNCES ON THE
            # SERVER'S OWN HALF (ITTF 2.6.1-2.6.2). A ball held at one end
            # that then lands on the OTHER half was thrown across, not served.
            _land = half.get(bf)
            _lo = int((t - 0.7) * FPS) - 1; _hi = int((t - 0.05) * FPS) + 1
            _same = sum(1 for g in fr[max(0, i - _HELD_SLICE):i]
                        if _lo <= g <= _hi and t - 0.7 <= g / FPS < t - 0.05 and held_end_at(g, person_pad) == _land)
            _held = _same >= max(1, int(round(held_min_s * FPS_)))
        if need_arrival:
            # nothing on the table for arrival_gap before this.
            #
            # ASKED OF THE STRICT TABLE, while the arrival itself is allowed
            # the wide one. The two questions want opposite answers: "the
            # ball has arrived" should be generous, because a serve landing
            # a few centimetres past the end line has still arrived; "a
            # rally was already running here" should not, because every
            # frame we newly call on-table is a frame that can veto a real
            # serve. Using the wide set for both silently removed three
            # detections that were each a point's only card -- Adil's cards
            # 3, 62 and 75 -- for no gain anywhere.
            prior = [g for g in fr if t - arrival_gap <= g / FPS < t - 0.03
                     and strict[g]]
            if prior and arrival_same_ball:
                # A ball on the table half a second ago only disqualifies this
                # frame as an ARRIVAL if it is the SAME ball: an unbroken track
                # from there to here. The previous point's ball still crossing
                # the table, or a pass, leaves a hole or a jump in the track,
                # and then this frame is the new ball's first appearance.
                seq = [g for g in fr if prior[-1] <= g <= f]
                broke = any(v - u > person_hole
                            or ((track[v][0] - track[u][0]) ** 2
                                + (track[v][1] - track[u][1]) ** 2) ** 0.5 > 0.5 * TW * (v - u)
                            for u, v in zip(seq, seq[1:]))
                if broke:
                    prior = []
            if prior and arrival_ignore_held:
                # A ball held at the end line projects inside the table, and
                # a pass caught by the server ends in their hand. Neither is
                # a rally: drop the prior frames that sit inside a box.
                prior = [g for g in prior if not (in_box_at(g, held_pad)
                                                  and (held_pad_slow_w <= 0 or slow_at(g, held_pad_slow_w)))]
            if prior and held_trumps_arrival and _held:
                # The ball was RESTING in a hand just before this: whatever
                # projected onto the table was not a rally.
                prior = []
            if prior and not (pair_trumps_arrival and _pair_after(bf)):
                if gate_log is not None: gate_log.append((f, 'arrival', dict(
                    prior=[(g, in_box_at(g, 0.0), in_box_at(g, 0.25)) for g in prior],
                    pair=_pair_after(bf), bf=bf)))
                continue
        if need_person and people:
            pf_ = int(round(t * people["fps"]))
            box = None
            for k in range(pf_ - 6, pf_ + 1):
                if str(k) in people["frames"]:
                    box = people["frames"][str(k)]
            if not box:
                if gate_log is not None: gate_log.append((f, 'no boxes'))
                continue
            # The crop the boxes are fractions of, and its origin in the
            # source frame. Attached to `people` at load time from the
            # match's own files -- never a literal, because 902x506 at
            # (462,158) is only this match's crop. See cropinfo.py.
            _ox, _oy, W, Hh = people["crop"]

            def in_a_box(bx, by):
                # NOTE: ball is in SOURCE pixels, boxes in CROP pixels
                for q in box:
                    x0, y0, x1, y1 = q[0] * W, q[1] * Hh, q[2] * W, q[3] * Hh
                    w, h = x1 - x0, y1 - y0
                    if (x0 - person_pad * w <= bx - _ox <= x1 + person_pad * w
                            and y0 - person_pad * h <= by - _oy <= y1 + person_pad * h):
                        return True
                return False

            # Where was the ball just before it reached the table?
            #
            # back[0] is the OLDEST frame in a 0.7s window, not the newest,
            # and that is deliberate however wrong it reads. Two hundredths
            # of a second before a bounce the ball is over the table, clear
            # of everybody; two thirds of a second before it is still at the
            # player who hit it. Reading back[-1] instead was tried and
            # costs six points their card outright.
            back = [g for g in fr if t - 0.7 <= g / FPS < t - 0.05]

            # HOW MUCH OF THE RUN-UP WAS AT A PLAYER, rather than one frame
            # of it. `back[0]` alone is decided by a single detection, and a
            # single detection is the least reliable thing we have.
            #
            # Adil's serve at 22:14 is the case. Fourteen frames lead into
            # it; THIRTEEN have the ball inside the far player's box, rising
            # and falling through the toss, plain to watch. The fourteenth
            # is the oldest -- a stray at the far left of the frame, nowhere
            # near either player -- and it is the only one the rule reads.
            # One bad frame outvotes thirteen good ones and the serve is
            # never seen.
            # COUNT ONLY THE FRAMES THAT COULD BE THE BALL.
            #
            # Reading one frame let a stray outvote thirteen good ones
            # (card 85). Requiring half lets a tracker PARKED on the wall
            # television outvote the good ones: before the serve at 16:53.4
            # the tracker sits on that TV -- 1.6 table widths away -- for
            # seven of the ten frames in the window, so the run-up reads 30%
            # and a plain serve is refused.
            #
            # A ball about to be served is near the table. A television is
            # not. Judging the run-up on the frames that could be the ball,
            # and ignoring the rest, answers both cases with one rule.
            look_ = ([g for g in back
                      if _quad_gap(QUAD, *track[g]) <= person_near_w * TW
                      or (hands_look_in_box and in_box_at(g, person_pad))
                      or (hands_toss_column and in_column_at(g, person_pad))
                      or _behind_end(*track[g])]
                     if person_near_w > 0 else back)
            # hands_look_in_box: a frame AT A PLAYER could be the ball too,
            # however far that player stands from the table. On Lester's
            # wide side-on frame the near player tosses 0.7-0.9 table
            # widths out, so five of the six run-up frames before the serve
            # at 12:52 were thrown away as "could not be the ball" and the
            # one frame left decided it.
            if hands_drop_still_s > 0 and len(look_) > 1:
                # A "ball" that does not move is not a ball. Before Lester's
                # serves at 19:49, 20:40 and 22:13 the tracker sits on the
                # ball rack beside the far end -- 0.38 table widths from the
                # table, inside the "could be the ball" band -- for ten to
                # eighteen frames, and outvotes the five frames of the real
                # toss. Drop any frame inside a run of identical positions
                # at least hands_drop_still_s long.
                # 1px and 8px were read off a 221px table. Koko 2's is 378px,
                # so the same tracker twitch moves 1.7x as many pixels there
                # and both tests are 1.7x stricter -- backwards, since a
                # bigger table means a bigger twitch. Scaling them is a
                # no-op on the corpus (the rule sits on a plateau: still 1px
                # and 2px measure the same, 4px costs Anton two points), and
                # it is what keeps them meaning one thing on every camera.
                _sc = (TW / TABLE_W_REF) if _flag("V3_HANDS_W") else 1.0
                _still_px = hands_still_px * _sc
                _parked_px = hands_parked_px * _sc
                _still_n = max(2, int(round(hands_drop_still_s * FPS_)))
                _drop = set()
                _run = [look_[0]]
                for u_, v_ in zip(look_, look_[1:]):
                    if (abs(track[v_][0] - track[u_][0]) <= _still_px
                            and abs(track[v_][1] - track[u_][1]) <= _still_px):
                        _run.append(v_)
                    else:
                        if len(_run) >= _still_n: _drop.update(_run)
                        _run = [v_]
                if len(_run) >= _still_n: _drop.update(_run)
                if _parked_px > 0 and _drop:
                    # ...and any frame sitting within hands_parked_px of a
                    # spot the tracker was parked on. The stray ball on the
                    # table at (543,524) is read at (539,525) for the last
                    # two frames before Lester's serve at 22:13 -- a 4px
                    # twitch that leaves the run and outvotes the toss.
                    _parked = []
                    _run = [look_[0]]
                    for u_, v_ in zip(look_, look_[1:]):
                        if (abs(track[v_][0] - track[u_][0]) <= _still_px
                                and abs(track[v_][1] - track[u_][1]) <= _still_px):
                            _run.append(v_)
                        else:
                            if len(_run) >= _still_n:
                                _parked.append((sum(track[g][0] for g in _run) / len(_run),
                                                sum(track[g][1] for g in _run) / len(_run)))
                            _run = [v_]
                    if len(_run) >= _still_n:
                        _parked.append((sum(track[g][0] for g in _run) / len(_run),
                                        sum(track[g][1] for g in _run) / len(_run)))
                    for g in look_:
                        if any(((track[g][0] - px) ** 2 + (track[g][1] - py) ** 2) ** 0.5 <= _parked_px
                               for px, py in _parked):
                            _drop.add(g)
                look_ = [g for g in look_ if g not in _drop]
            # The boxes read at each run-up frame's OWN moment, not the
            # boxes at the arrival. A player stepping into a serve moves;
            # card 21's toss is inside the near box at 4:43.0 and outside
            # the box the player has moved to by 4:43.7.
            _inb = ((lambda g: in_box_at(g, person_pad)) if hands_box_per_frame
                    else (lambda g: in_a_box(*track[g])))
            if hands_toss_column:
                _inb0 = _inb
                _inb = lambda g: _inb0(g) or in_column_at(g, person_pad)
            frac = (sum(1 for g in look_ if _inb(g)) / len(look_)
                    if look_ else 0.0)
            if person_frac > 0:
                hit = bool(back) and frac >= person_frac
                if not hit and hands_empty_abstain and back and not look_:
                    # Nothing in the run-up could have been the ball, so
                    # there is nothing to judge. Absence of evidence.
                    hit = True
                    if hands_abstain_rally:
                        # ...but only when a rally follows. Abstaining
                        # blind let a between-points knock at 18:55 on
                        # 89b35ee0 open a card; a real serve is followed by
                        # net crossings and that one was not.
                        _nc, _win = hands_abstain_rally
                        hit = int(((cross > t) & (cross <= t + _win)).sum()) >= _nc
            else:
                hit = bool(back) and in_a_box(*track[back[0]])

            # THE SECOND WAY IN, and it only ever adds. Nothing that passes
            # above can fail here.
            #
            # A near-end server stands between the camera and their own
            # half. The ball is behind them for the whole serve, so its
            # first sighting IS the bounce and there is no "before" to look
            # back at -- back[0] is whatever the tracker latched onto in the
            # meantime, usually someone walking behind the table. That is
            # Adil's card 5 at 0:52.6: both serve bounces found, on the
            # right halves, every other gate passing, and the last thing
            # the tracker saw 0.07s earlier was 288 pixels away in the
            # opposite corner.
            #
            # So when the trail into the bounce is BROKEN, the bounce itself
            # is asked one narrow question: did it land inside the box of
            # the player AT THAT END? A serve's first bounce lands in front
            # of the server, on the server's own half, and from this camera
            # that patch of table is inside the server's own box. Asking the
            # loose version -- any box at all -- gains the same card and
            # costs two other points theirs, because a mid-rally bounce then
            # opens a card that swallows the point after it.
            if not hit and person_bounce_fallback and player_at is not None:
                seq = [g for g in fr if back and back[0] <= g <= f]
                # Speed alone is not enough to spot a broken trail, because
                # the break DIVIDES by the frames it skipped. Before the real
                # serve on card 9 the tracker sits motionless on a wall-mounted
                # TV for a third of a second, then teleports 249px to the
                # table across a 3-frame hole: 83px per frame, under any
                # sane speed limit, and plainly not a ball. A HOLE in the
                # trail is the honest signal -- frames are missing exactly
                # because the tracker had lost it.
                broke = not back or any(
                    (v - u) > person_hole > 0
                    or (((track[v][0] - track[u][0]) ** 2
                         + (track[v][1] - track[u][1]) ** 2) ** 0.5
                        / max(v - u, 1)) > person_jump
                    for u, v in zip(seq, seq[1:]))
                if broke:
                    landed_ = half.get(bf)
                    pl = player_at(t)
                    own = pl.get(landed_) if pl else None
                    if fallback_near_only and landed_ != "near":
                        own = None
                    if own and fallback_pair_win > 0:
                        # A serve's own bounce is one of a PAIR: the next
                        # bounce is on the receiver's half, a few tenths
                        # later. A bounce with no partner is a rally bounce.
                        other = "far" if landed_ == "near" else "near"
                        if not any(half.get(g) == other
                                   for g in bset
                                   if bf < g <= bf + int(fallback_pair_win * FPS)):
                            own = None
                    if own:
                        bx, by = track[f]
                        w_, h_ = own[2] - own[0], own[3] - own[1]
                        hit = (own[0] - person_pad * w_ <= bx - _ox
                               <= own[2] + person_pad * w_
                               and own[1] - person_pad * h_ <= by - _oy
                               <= own[3] + person_pad * h_)
            if not hit and person_abstain_if_far and look_ and not any(
                    in_a_box(*track[g]) for g in look_):
                # The hands test guards against the ball being in the OTHER
                # player's hands -- a pass. If the run-up ball was in nobody's
                # box at all, that is absence of evidence, not evidence of a
                # pass: abstain rather than refuse.
                hit = True
            if not hit and not (pair_trumps_person and _pair_after(bf)):
                if gate_log is not None: gate_log.append((f, 'hands', dict(
                    back=[(g, round(_quad_gap(QUAD, *track[g]) / TW, 2), in_a_box(*track[g]),
                           in_box_at(g, 0.0)) for g in back],
                    look=len(look_), frac=round(frac, 2), nbox=len(box),
                    pair=_pair_after(bf), bf=bf)))
                continue
        n_ = 0
        if table_run > 0 or unpaired_stay_s > 0:
            # HOW LONG DID THE BALL ACTUALLY STAY BY THE TABLE?
            #
            # A ball that bounces on the table came down towards it and
            # carried on afterwards, so it is near the table for a stretch
            # of frames either side. A tracker flicking between a wall
            # fixture and the table touches it for two or three frames and
            # is gone.
            #
            # Card 19 of 89b35ee0, at the end of game one with nobody
            # playing: the trail is on the wall at (633, 280), jumps 297px
            # onto the table for three frames, and jumps 386px back to
            # (545, 270) -- within two pixels of where it started. That
            # three-frame touch is a clean local image-y maximum, so
            # `bounces` calls it a bounce, and every other gate then passes
            # because nothing else was happening either.
            #
            # Measured in FRAMES near the table rather than in seconds
            # on it, because the ball is above the table for most of the
            # approach and `on_table` is false the whole way down.
            # AND IT HAS TO BE THE SAME BALL THE WHOLE WAY.
            #
            # Being near the table is not enough on its own. Before the far
            # player's serve at 11:11 the real ball sits motionless in his
            # hand at the far end -- which is 0.02 table widths from the
            # drawn table, so it counts as "near" -- while the tracker
            # flicks to a decoy at the NEAR end for two frames, calls that a
            # bounce, and flicks back. The run around that bounce is 35
            # frames long and every one of them is near the table. What it
            # is not is one object: the step into the bounce is 327px in two
            # frames.
            #
            # The limit is the same 16.3 table widths a second the
            # broken-trail test uses -- 25 m/s, a real bound on how fast a
            # ball can be.
            jump = None if table_run_jump_w <= 0 else table_run_jump_w * TW / FPS_

            def _step_ok(u_, v_):
                if jump is None:
                    return True
                d = ((track[v_][0] - track[u_][0]) ** 2
                     + (track[v_][1] - track[u_][1]) ** 2) ** 0.5
                return d / max(v_ - u_, 1) <= jump

            # Measured around the BOUNCE, not around the arrival. They are
            # usually the same stretch, but not when the ball is at rest:
            # before the serve at 11:11 the real ball sits still at the far
            # end for over a second, which now counts as "arrived" and gives
            # a run 35 frames long, while the bounce the arrival qualified
            # on is a two-frame flick to a decoy at the other end. Anchoring
            # on the bounce asks about the thing we are actually judging.
            i = fr.index(bf)
            n_ = 1
            j = i
            while (j + 1 < len(fr) and fr[j + 1] - fr[j] <= table_run_hole
                   and _quad_gap(QUAD, *track[fr[j + 1]]) <= table_run_px
                   and _step_ok(fr[j], fr[j + 1])):
                j += 1; n_ += 1
            j = i
            while (j - 1 >= 0 and fr[j] - fr[j - 1] <= table_run_hole
                   and _quad_gap(QUAD, *track[fr[j - 1]]) <= table_run_px
                   and _step_ok(fr[j - 1], fr[j])):
                j -= 1; n_ += 1
            if table_run > 0 and n_ < table_run:
                if gate_log is not None: gate_log.append((f, 'table-run'))
                continue
        if min_travel > 0:
            # A served ball leaves. Card 49 sat at u=0.43, v=2.49 for over
            # half a second after its "serve" — that is a ball at rest, or
            # the tracker holding a still object, and no serve looks like it.
            fut = [g for g in fr if t < g / FPS <= t + travel_win]
            if len(fut) < 3:
                if gate_log is not None: gate_log.append((f, 'travel'))
                continue
            p0 = project(H, *track[f])
            far_ = max((abs(project(H, *track[g])[1] - p0[1])
                        for g in fut if project(H, *track[g])), default=0.0)
            if far_ < min_travel:
                if gate_log is not None: gate_log.append((f, 'travel'))
                continue
        if quiet_bounces > 0:
            # "Is a rally already running" asked of BOUNCES, not just
            # crossings. The crossing detector goes silent mid-rally, which
            # is what let card 49 through while the point was still alive.
            n_b = sum(1 for g in bset
                      if t - quiet_win <= g / FPS < t - 0.05)
            if n_b >= quiet_bounces:
                continue
        if no_rally and len(cross):
            # A ball that was resting in a hand a moment ago was not mid-
            # rally, whatever the crossing detector made of the toss. From
            # an end-on camera a tossed ball projects far beyond the table
            # and back, and reads as two or three net crossings.
            n = int(((cross >= t - V2.PRIOR_CROSS_WINDOW_S) & (cross < t - 0.05)).sum())
            _excused = held_trumps_rally and _held
            if _excused and held_rally:
                # ...but a held ball that is then bounced on the table and
                # caught again -- the pre-serve habit -- must not open a
                # card. Only a held ball that went INTO PLAY is excused:
                # its bounce pairs across the net, or the ball crosses it.
                _nc, _win = held_rally
                _excused = _pair_after(bf) or int(((cross > t) & (cross <= t + _win)).sum()) >= _nc
            _by_excuse = n > V2.PRIOR_CROSS_MAX and _excused
            if n > V2.PRIOR_CROSS_MAX and not _excused:
                if gate_log is not None: gate_log.append((f, 'rally running'))
                continue
        landed = half.get(bf)          # the qualifying bounce decides the half

        # A SERVE'S BOUNCE COMES IN A PAIR: its partner is on the other half,
        # within PAIR_MAX_S. That is production's own serve motif, and it is
        # NOT required here -- requiring it is exactly what this rule was
        # written to relax, because a server whose body hides their own half
        # never shows both. But it is the right way to break a TIE.
        other = "far" if landed == "near" else "near"
        paired = any(half.get(g) == other
                     for g in bset if bf < g <= bf + int(V2.PAIR_MAX_S * FPS))

        fast = 0.0
        if unpaired_fast_w > 0 or unpaired_fast_pct > 0 or collect is not None:
            # HOW HARD WAS THE BALL TRAVELLING?
            #
            # The lingering test above reads a fast flat serve as a pass: it
            # is unpaired, because its own bounce and the receiver's both
            # land off the drawn table, and it does not linger, because it
            # goes long and out of play. Adil's serve at 19:43 is exactly
            # that, and it is the shape he expects more of -- "people who
            # serve long and fast, serve edge to edge".
            #
            # Speed separates it from a pass cleanly, and physically rather
            # than by luck. Measured over the whole match in table widths a
            # second (one width is 1.525 m, so 1.0 is about 5.5 km/h):
            # good serves run 1.1 to 4.0 with a median of 2.5; the passes
            # Adil named run 0.6 to 2.5. The 19:43 serve is 4.9 -- above
            # every good serve's ninetieth percentile. Nobody lobs a ball
            # across to their opponent that hard.
            g_ = [x for x in fr if t - 0.03 <= x / FPS <= t + 0.35]
            sp = []
            for u_, v_ in zip(g_, g_[1:]):
                dt = (v_ - u_) / FPS
                if dt > 0.12:
                    continue
                sp.append((((track[v_][0] - track[u_][0]) ** 2
                            + (track[v_][1] - track[u_][1]) ** 2) ** 0.5 / TW) / dt)
            fast = float(sorted(sp)[len(sp) // 2]) if sp else 0.0

        cands.append((t, bf, landed, paired, n_ / FPS_, fast, _by_excuse, _held))

    if collect is not None:
        collect.extend(dict(t=round(t, 2), bf=round(bf / FPS, 2), landed=ld,
                            paired=int(pr), stay=round(st, 3), fast=round(fa, 3), excused=int(ex), held=int(hd))
                       for t, bf, ld, pr, st, fa, ex, hd in cands)

    # ------------------------------------------------------------------
    # SECOND PASS. Everything above judges a candidate on its own. The two
    # tests below judge it against the OTHER candidates in this match, so
    # they cannot run until every candidate exists.
    # ------------------------------------------------------------------
    stay_thr, fast_thr = unpaired_stay_s, unpaired_fast_w
    if unpaired_stay_pct > 0 or unpaired_fast_pct > 0:
        # CALIBRATED AGAINST THE SERVES WE ARE ALREADY SURE OF.
        #
        # A serve with BOTH its bounces visible, on opposite halves, is one
        # nobody argues about. So the two questions the unpaired rule asks
        # get their answers from that population instead of from a number
        # carried over from another camera:
        #
        #   "did it linger?"  -> at least as long as the slowest fifth of them
        #   "was it fast?"    -> faster than nine in ten of them
        #
        # On 89b35ee0 the 196 paired candidates put those at 1.27s and 4.08,
        # against the 1.30 and 4.00 that were hand-picked -- so this match
        # does not move, and a match filmed differently gets its own numbers
        # rather than these.
        #
        # calib_min guards the small-sample case: under that many paired
        # candidates a percentile means nothing and the fixed value stands.
        # CALIBRATED ON THE SERVES NOBODY ARGUES ABOUT -- so a candidate that
        # got through only because a held ball excused a running rally is
        # left out. Two such candidates on 89b35ee0 moved the 23rd percentile
        # past a real serve's stay time and cost point 84 its card.
        ps = sorted(c[4] for c in cands if c[3] and not c[6])
        pf = sorted(c[5] for c in cands if c[3] and not c[6])

        # WHAT A MATCH DOES WHEN IT CANNOT CALIBRATE ITSELF.
        #
        # Today it falls back to 1.3 s and 4.0 table widths a second, and both
        # of those are 89b35ee0's numbers. That makes `calib_min` a cliff
        # rather than a guard. Koko 2 has 31 paired candidates against a
        # threshold of 30, and its own 23rd percentile is 0.23 s -- so one
        # paired candidate either way is the difference between 0.23 s and
        # 1.3 s, a factor of five and a half, decided by nothing.
        #
        # Measured by moving calib_min so those matches fall through:
        #     calib_min   fallback (today)        abstain
        #        30       482 ok, 12 INSERT       482 ok, 12 INSERT
        #        40       478 ok, 15 INSERT       482 ok, 12 INSERT
        #        60       476 ok, 15 INSERT       482 ok, 12 INSERT
        #       200       476 ok, 15 INSERT       482 ok, 12 INSERT
        #
        # V3_CALIB_ABSTAIN=1 abstains instead: a match with too few serves of
        # its own to judge by does not run the test at all. Under Adil's
        # ruler that is the right way to fail, because this test only ever
        # DELETES a card and a wrong deletion is the expensive edit. It is a
        # no-op on today's corpus (every match calibrates) and it turns the
        # whole of calib_min from 30 to 200 into one flat plateau.
        _abstain = False

        def _pct(arr, q, fallback):
            if len(arr) < calib_min:
                return 0.0 if _abstain else fallback
            i = (len(arr) - 1) * q / 100.0
            lo = int(i); hi = min(lo + 1, len(arr) - 1)
            return arr[lo] + (arr[hi] - arr[lo]) * (i - lo)

        if unpaired_stay_pct > 0:
            stay_thr = _pct(ps, unpaired_stay_pct, unpaired_stay_s)
        if unpaired_fast_pct > 0:
            fast_thr = _pct(pf, unpaired_fast_pct, unpaired_fast_w)

    out, last, _kept_paired = [], -99.0, False
    if gate_log is not None:
        gate_log.append((-1, 'calib', dict(stay_thr=stay_thr, fast_thr=fast_thr,
                                           n_paired=sum(1 for c in cands if c[3] and not c[6]))))
    for t, bf, landed, paired, stay, fast, _ex, _hd in cands:
        if recent_needs_held > 0 and out and 0 < t - last <= recent_needs_held and not _hd:
            # A RALLY'S HITS ARE NEVER PRECEDED BY A BALL AT REST. A candidate
            # arriving within a few seconds of the last accepted serve is
            # either the next point (after a quick one) or a hit inside the
            # rally that is still running. Only a ball seen resting in a hand
            # -- slow, inside a player's box -- tells the two apart. Without
            # it, refuse. Found on Koko 2 when a second detection pass made
            # the ball visible at the far player's paddle: every such hit
            # after a gap in the track opened a second card on the point.
            if gate_log is not None: gate_log.append((int(round(t * FPS)), 'recent-no-held', dict(since=round(t - last, 2))))
            continue
        if net_margin_m > 0 and (paired or not net_margin_paired_only):
            # A SERVE'S OWN BOUNCE IS NOT ON THE NET. Card 47 of 89b35ee0 is
            # a toss that clipped the net and dropped 10cm past it, then
            # dribbled down the near half. Real serves here land a median
            # 0.91 m from the net and never closer than 0.23 m.
            #
            # Asked only of a PAIRED bounce, because only then do we know
            # whose bounce we are looking at. On an unpaired one the bounce
            # we can see may be the RECEIVER'S -- and a short serve's second
            # bounce lands close to the net by design, so the rule would be
            # deleting exactly the serves it has no business judging.
            p_ = project(H, *track[bf])
            if p_ is not None and abs(p_[1] - V2.NET_V) < net_margin_m:
                _clear = False
                if net_partner_clear_m > 0:
                    # A NET-CLIP DROPS BESIDE THE NET. A first bounce near the
                    # net whose PARTNER lands well past it on the other half
                    # has crossed cleanly: d15aad4d's points 33 and 53 land
                    # 16-18 cm before the net and their partners 72-73 cm
                    # beyond it, 0.3-0.4s later. Asked in table metres of the
                    # partner, which is on the table, so it reads the same
                    # from any camera.
                    _side = p_[1] - V2.NET_V
                    for g in _bs:
                        if not (bf < g <= bf + int(V2.PAIR_MAX_S * FPS)): continue
                        q_ = project(H, *track[g])
                        if q_ and (q_[1] - V2.NET_V) * _side < 0 and abs(q_[1] - V2.NET_V) >= net_partner_clear_m:
                            _clear = True; break
                if not _clear:
                    if gate_log is not None: gate_log.append((int(round(t * FPS)), 'net', dict(v=round(float(p_[1]), 2))))
                    continue

        # A RALLY IS THE OTHER ESCAPE. The linger test exists to tell a
        # pass from a serve whose first bounce we never saw; a pass starts
        # no rally. Lester's near-end serves at 10:11, 13:07, 15:15 and
        # 17:51 linger 0.2-0.8s against a threshold of 1.37s calibrated on
        # this wide camera, and every one is followed by net crossings.
        _rallied = bool(unpaired_rally) and int(
            ((cross > t) & (cross <= t + unpaired_rally[1])).sum()) >= unpaired_rally[0]
        if unpaired_occl_frac > 0 and not paired and not _rallied and player_at is not None:
            # THE HIDDEN HALF. When the player at the OTHER end covers that
            # half of the table in the picture, the partner bounce could not
            # have been seen, and one visible bounce is what a serve looks
            # like from this camera. Read per candidate from the box and the
            # table's outline: a true end-on camera exempts nearly every
            # serve, a side-on one (all three lab matches) exempts almost none.
            _other = 'far' if landed == 'near' else 'near'
            _pl = player_at(t)
            if _pl and _pl.get(_other) and _half_cover(_pl[_other], _other) >= unpaired_occl_frac:
                _rallied = True
        if unpaired_next_gap > 0 and not paired and not _rallied:
            # A PASS IS FOLLOWED BY A SERVE. The ball is thrown across so the
            # other player can serve, and they do so within a few seconds.
            # After a real point there is a walk back and a score call before
            # the next serve. So an unpaired bounce that no later candidate
            # follows for unpaired_next_gap seconds was not a pass to anyone.
            _nxt = next((c2[0] for c2 in cands if c2[0] > t + 0.05), None)
            if _nxt is None or _nxt - t > unpaired_next_gap:
                _rallied = True
        if (stay_thr > 0 and not paired and stay < stay_thr
                and not (fast_thr > 0 and fast >= fast_thr) and not _rallied):
            # AN UNPAIRED BOUNCE THAT DOES NOT LINGER IS A PASS.
            #
            # Dropping the pair requirement is what lets this rule see a
            # serve whose own first bounce is hidden behind the server, and
            # that is worth seven points on 89b35ee0 their only card. But it
            # also lets in the ball thrown back between points, which lands
            # once and is caught.
            #
            # A served ball is in play: it is returned, it bounces again, it
            # stays in the picture. A pass lands once and stops. Cards on
            # points Adil kept linger 2.17s at the median; cards on stretches
            # he deleted, 0.50s. The escape is speed -- a flat serve that
            # goes long neither pairs nor lingers, but nobody lobs a ball to
            # their opponent at 27 km/h.
            if gate_log is not None: gate_log.append((int(round(t * FPS)), 'unpaired-stay', dict(stay=round(stay, 2), fast=round(fast, 2), stay_thr=round(stay_thr, 2), fast_thr=round(fast_thr, 2))))
            continue

        if t - last <= V2.CLUSTER_S:
            # Two candidates this close are one serve seen twice, and the
            # rule keeps whichever came first -- unless the later one shows
            # BOTH bounces and the kept one does not (cluster_prefer_paired).
            # Adil's rule again: a serve with both bounces outranks. Once
            # the unpaired escapes are on, a candidate 1.7s before Lester's
            # real serve at 3:19.8 -- a single bounce -- was kept in its
            # place and the assembler threw its card away.
            if cluster_prefer_paired and paired and out and not _kept_paired:
                out.pop(); last = t; _kept_paired = True
                out.append((round(t - V2.CONTACT_LOOKBACK_S, 2), round(t, 2), landed))
                continue
            if gate_log is not None: gate_log.append((int(round(t * FPS)), 'cluster', dict(first=round(last, 2))))
            continue
        last = t; _kept_paired = bool(paired)
        out.append((round(t - V2.CONTACT_LOOKBACK_S, 2), round(t, 2), landed))
    return out
