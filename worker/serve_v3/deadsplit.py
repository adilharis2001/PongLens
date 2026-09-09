"""The ball going dead ends the rally.

A rally bounce rises ~290px between bounces. A ball dribbling back to a
player rises ~17px and never leaves the table. Production already knows
this shape — APEX_MIN_PX exists to REJECT it when pairing a serve's two
bounces. Read the other way round, a run of consecutive low-apex bounces
is the point ending.

That matters because `serve_points` skips any serve landing inside the
previous rally, and `rally_end_ev` walks the crossing chain straight
through a pass-back into the next point. So two points become one card and
the second serve is thrown away even though the serve rule found it.
"""
import json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))          # the worker directory
import points_v2 as V2
from points_v2 import bounces, project

_ORIG = V2.rally_end_ev
DEAD = []          # [(dead_start_s, dead_end_s)] for the match under test


def dead_runs(H, track, max_rise_w, run_len, tw, fps=None):
    if fps is None:
        raise ValueError("dead_runs needs the match's own frame rate")
    """Runs of consecutive table bounces the ball never rises between.

    max_rise_w is in TABLE WIDTHS, not pixels. It used to be 25px, which is
    a statement about how big the table looked on one camera: film the same
    match from twice the distance and it means something else. On this match
    the table is 220.8px wide, so 25px is 0.113 widths -- about 17cm of rise.

    run_len is a count of BOUNCES, so it needs no conversion. fps does,
    because the bounce times come back in seconds.
    """
    max_rise = max_rise_w * tw
    bset = sorted(f for f, x, y in bounces(track, 1.0))
    tb = []
    for f in bset:
        p = project(H, *track[f])
        if p and -0.15 <= p[0] <= V2.W_M + 0.15 and -0.15 <= p[1] <= V2.L_M + 0.15:
            tb.append(f)
    rise = {}
    for a, b in zip(tb, tb[1:]):
        span = [g for g in track if a < g < b]
        rise[b] = (min(track[a][1], track[b][1]) - min(track[g][1] for g in span)
                   ) if span else 999.0
    runs, cur = [], []
    for f in tb:
        if rise.get(f, 999.0) < max_rise:
            cur.append(f)
        else:
            if len(cur) >= run_len:
                runs.append((cur[0] / fps, cur[-1] / fps))
            cur = []
    if len(cur) >= run_len:
        runs.append((cur[0] / fps, cur[-1] / fps))
    return runs


BT = np.zeros(0)   # this match's table bounces; see the crossing-age test below
BLIND = {}         # contact_s -> (crossings accepted, bounces seen, tail used)
# V3_BOUNCE_CHAIN_ALWAYS=1: after the crossing chain stops, keep following
# table bounces (gaps up to bounce_chain_s) before adding the tail. On an
# end-on camera the crossing detector goes quiet for 3+ s inside a live
# rally while the bounces keep coming; the card ended there and the next
# hit opened a second card on the same point.
BOUNCE_CHAIN_ALWAYS = os.environ.get("V3_BOUNCE_CHAIN_ALWAYS", "0") == "1"


# ---------------------------------------------------------------------------
# THE BODIES, AS EVIDENCE THAT THE POINT IS STILL ON.
#
# poseplay/poseplay_<m>.npz holds a play probability per 10 fps pose frame,
# from a logistic model trained on the OTHER six matches (pose_play.py). It
# is NOT calibrated the same way on every camera -- the median reading over
# a whole match runs from 0.33 on Terry 2 to 0.57 on Anton -- so nothing
# here compares it against an absolute number. The question asked is always
# "are these two busier than this match's own typical moment", which is the
# same question on every camera.
POSE = None            # (T, p, thr)


def load_pose(path, q=50.0, tail_q=None):
    global POSE
    if not path or not os.path.exists(path):
        POSE = None; return None
    d = np.load(path)
    T, p = d["T"], d["p"]
    POSE = (T, p, float(np.percentile(p, q)),
            float(np.percentile(p, q if tail_q is None else tail_q)))
    return POSE[2]


def _p_at(t):
    T, p = POSE[0], POSE[1]
    i = int(np.searchsorted(T, t))
    return float(p[min(i, len(p) - 1)])


def _p_mean(a, b):
    T, p = POSE[0], POSE[1]
    i0, i1 = int(np.searchsorted(T, a)), int(np.searchsorted(T, b))
    if i1 <= i0:
        return _p_at(a)
    return float(p[i0:i1].mean())


def install(serves_t, min_rally=1.5, serve_follow=None,
            blind_tail=None, blind_max_bounces=3, bounce_chain_s=0.0,
            dense_gap_s=0.0, dense_max_s=12.0,
            tail_from_ev=False, pose_bridge_s=0.0, pose_tail_s=0.0,
            pose_tail_gap_s=0.6, bridge_soft=False,
            dead_needs_quiet=False, dead_not_crossing=False,
            cross_age_s=0.0, cross_age_min=3,
            bounce_win_s=2.0, end_paired=0.0):
    """Patch rally_end_ev to stop the chain at the first dead run.

    serve_follow: if set, only honour a dead run when a detected serve
    follows within that many seconds — so the rally is only ever cut short
    where there is a real next point to open. Without it the cut can only
    truncate a rally that was still alive.

    blind_tail: the tail to use on a card that never saw the ball cross the
    net AND saw at most blind_max_bounces bounces. See the note on BLIND
    below for why those cards need a different number.

    NOTE ON STRUCTURE. This used to hand back to _ORIG whenever it found no
    dead run to cut at, and that read like the common case. It is not: the
    cut is the first dead ball ANYWHERE later in the match, so with
    serve_follow off there is essentially always one, and _ORIG was called
    almost never. Every card's end came from here. The two branches are now
    one, with an absent cut treated as a cut at infinity, which is exactly
    what _ORIG computes.
    """
    sv = np.asarray(sorted(serves_t), float)

    def patched(E, contact_s):
        # THE FREE CHAIN: how far the net crossings reach if no dead ball is
        # allowed to stop them. Used only to ask whether a dead run has the
        # rally still going on across it.
        free = contact_s
        for t in E.cross:
            t = float(t)
            if t < contact_s:
                continue
            if t - free > V2.CROSS_GAP_S:
                break
            free = t
        cut = None
        for a, _b in DEAD:
            if a <= contact_s + min_rally:
                continue
            if serve_follow is not None:
                if not len(sv) or not ((sv > a) & (sv <= a + serve_follow)).any():
                    continue
            if dead_needs_quiet and POSE is not None \
                    and _p_mean(a, max(float(_b), a + 0.3)) >= POSE[2]:
                # A ROLLING BALL IS THE END OF THE POINT, AND SO IS A BALL
                # DRIBBLING BACK TO A PLAYER -- but only if the players stop
                # too. Filmed from behind a player the bounce apexes flatten
                # out and the dead-ball reading fires in the middle of a live
                # rally: Yu Yu Lin's point 85 reads dead at 16:07.3 while the
                # ball goes on crossing the net until 16:11.1 and he presses
                # the winner at 16:12.2. The two bodies are busier than this
                # match's typical moment right through it. When they say the
                # point is on, the dead reading is a misread of the picture.
                continue
            if dead_not_crossing and a < free:
                # THE BALL CANNOT BE DEAD AND STILL CROSSING THE NET.
                continue
            cut = a
            break
        if cut is None:
            cut = float("inf")
        last, n = contact_s, 0
        last_hard, hard_open = contact_s, True
        for t in E.cross:
            t = float(t)
            if t < contact_s or t > cut:
                continue
            if hard_open and t - last_hard <= V2.CROSS_GAP_S:
                last_hard = t
            else:
                hard_open = False
            if cross_age_s > 0 and n >= cross_age_min:
                # A CROSSING IN A RALLY HAS JUST COME OFF THE TABLE.
                #
                # Between two crossings of a live rally the ball bounces on
                # somebody's half: that is what a rally is. Measured over the
                # nine matches against the owner's own winner presses, a
                # crossing between a serve and the press follows a table bounce
                # by 0.20-0.93s at the median, and one between the press and
                # the next serve -- the ball being picked up, thrown back,
                # knocked about in the pause -- by 1.16-7.81s.
                #
                # Rowel's point 6 is the case this exists for. His press is at
                # 0:59.1 and the rally's last crossing is at 0:58.9; the
                # crossing detector then fires nine more times between 1:01.0
                # and 1:05.2 with no table bounce anywhere between 0:57.6 and
                # 1:06.1. Every one of those gaps is under CROSS_GAP_S, so the
                # chain walks the retrieval and the whole start of the next
                # point, ends the card 7.3s past the press, and -- because
                # `serve_points` refuses a serve that lands inside the open
                # card's evidence -- costs point 7 its own card as well.
                #
                # The separation holds on every camera in the corpus; its SIZE
                # does not, which is why the threshold is a knob rather than a
                # constant. On the two end-on cameras the bounce finder loses
                # about half of the rally's own bounces, so a stale crossing is
                # ordinary there: 22-41% of Terry 2's and Koko 2's in-rally
                # crossings have no bounce inside 1.5s against 3-12% on the
                # side-on ones. cross_age_min is what keeps those matches out
                # of it -- the rule may only speak once the chain has already
                # watched the ball cross the net three times, by which point a
                # card that never sees bounces has been left alone.
                _j = int(np.searchsorted(BT, t))
                if (t - float(BT[_j - 1]) if _j else float("inf")) > cross_age_s:
                    break
            if t - last > V2.CROSS_GAP_S:
                # A PAUSE IN THE CROSSINGS IS NOT ALWAYS THE END OF THE
                # RALLY. From behind a player the ball crosses the net
                # almost along the camera's own axis, and the crossing
                # detector goes quiet for three or four seconds in the
                # middle of a live point. The bodies do not go quiet: they
                # are still moving like players in a rally. So bridge the
                # gap where the two of them say the point is still on, and
                # never across a serve -- a rally never has two serves in
                # it, so a detected serve inside the gap means the pause
                # WAS the end of the point.
                if not (pose_bridge_s > 0 and POSE is not None
                        and t - last <= pose_bridge_s
                        and _p_mean(last, t) >= POSE[2]
                        and not (len(sv) and ((sv > last) & (sv < t)).any())):
                    break
            last = t
            n += 1
        if bounce_chain_s > 0 and (n == 0 or BOUNCE_CHAIN_ALWAYS):
            # NO CROSSINGS: FOLLOW THE BOUNCES INSTEAD.
            #
            # `last` stays at the contact when the chain never starts, so
            # the bounce window below is only two seconds long -- a card
            # with no crossings never sees past the first two seconds of
            # its own point.
            #
            # Card 69 of 89b35ee0 is exactly that. Its first crossing is
            # 5.7s after the serve, outside CROSS_GAP_S, so the chain is
            # empty; it counts three bounces up to 16:50.2, adds the blind
            # tail and stops at 16:54.9. The ball goes on bouncing on the
            # table at 16:53.4, 16:53.9, 16:54.6 and 16:55.1, and crosses
            # the net at 16:53.9. Adil pressed the winner at 16:57.0.
            #
            # A crossing is the better evidence and is used whenever there
            # is one. This is what to do when there is none.
            for t in E.bt_table:
                t = float(t)
                if t < contact_s or t > cut:
                    continue
                if t - last > bounce_chain_s:
                    break
                last = t
        if dense_gap_s > 0:
            # THE BALL IS STILL MOVING: THE RALLY HAS NOT ENDED. On a camera
            # that sees the net badly, crossings go unseen for three seconds
            # in the middle of a live rally and the chain above breaks. Terry
            # 2's point 41: my card ended at 8:56.7, the ball crossed the net
            # nine more times before his press at 9:03.3. Follow the ball's
            # own motion (production's ball_dense ticks) forward from the
            # last event, bridging gaps up to dense_gap_s, never past a dead
            # run and never more than dense_max_s beyond the chain.
            k = int(last / V2.TICK); n_ = len(E.ball_dense)
            gap_ticks = int(round(dense_gap_s / V2.TICK)); limit = min(cut, last + dense_max_s)
            j = k; ext = last; quiet = 0
            while j + 1 < n_ and (j + 1) * V2.TICK <= limit:
                j += 1
                if E.ball_dense[j]:
                    ext = j * V2.TICK; quiet = 0
                else:
                    quiet += 1
                    if quiet > gap_ticks:
                        break
            last = max(last, ext)
        # HOW LONG AFTER ITS LAST CROSSING THE RALLY MAY STILL LAND.
        #
        # A ball that crosses the net is already on its way down.
        # Measured over the nine matches against the owner's own card
        # windows, a mid-rally crossing is answered by a table bounce a
        # median 0.14-0.51s later, and inside 1.2s on 82-99% of them.
        # Two seconds is four to eight times that delay -- long enough
        # to reach the NEXT point's serve.
        #
        # Terry 2's point 12: the rally's last crossing is at 197.99,
        # the next bounce this window finds is at 199.43 -- the serve of
        # point 13 -- and the 2.6s tail on top of it ends the card at
        # 202.03, over the whole of point 13, which then gets no card.
        b = E.between(E.bt_table, contact_s, min(last + bounce_win_s, cut))

        # A CARD THAT NEVER SAW THE BALL CROSS THE NET does not know when
        # the point ended; it only knows when it stopped seeing it. The 2.6s
        # tail was measured on cards that WERE watched, where the last bounce
        # really is the end of the rally, and on a blind card it is being
        # asked to do a different job.
        #
        # Both halves of the trigger matter. Blind on its own is 15 cards on
        # this match and most are fine — they see a dozen bounces and end
        # within a second of the winner press. It is blind AND almost no
        # bounces that goes wrong: short by 1.8s on one bounce, 6.2s on two,
        # 3.7s on three, against 0.2–0.9s for the ones that saw 13 to 17.
        blind = n == 0 and len(b) <= blind_max_bounces
        tail = blind_tail if (blind and blind_tail) else V2.TAIL_AFTER_BOUNCE
        BLIND[round(float(contact_s), 2)] = (n, len(b), tail)

        if bridge_soft:
            # A BRIDGED CROSSING IS WEAKER EVIDENCE THAN A CHAIN THAT NEVER
            # BROKE. It is good enough to say "keep showing the clip", and
            # not good enough to refuse the next serve: the evidence end is
            # what `serve_points` tests a later serve against, so a bridge
            # that moves it turns one long rally into a point with no card
            # at all. Keep the evidence on the unbroken chain and let only
            # the picture run on.
            bh = E.between(E.bt_table, contact_s, min(last_hard + bounce_win_s, cut))
            ev_hard = max(float(bh[-1]), last_hard) if len(bh) else last_hard
        if len(b):
            ev = max(float(b[-1]), last)
            if end_paired > 0:
                # A RALLY IS A CHAIN; RETRIEVAL IS A SINGLE EVENT ALONE.
                #
                # The exchanges of a point leave a bounce or a crossing
                # every few tenths of a second -- the median gap between
                # one ball event and the next inside a rally is 0.24s
                # over the nine matches, and 95% are under 1.03s. What
                # follows a point does not look like that: the ball hits
                # the floor once and comes back up, or is tossed back
                # over the net, seconds after everything else. The card's
                # evidence end could land on one of those and drag the
                # whole tail out behind it.
                #
                # So the last event has to have a partner within
                # end_paired seconds before it, or it was not part of the
                # rally. Walk back until one does. Only ever applied
                # where two events remain, so a card with a single bounce
                # keeps exactly what it had.
                evs = sorted(set(
                    [float(x) for x in E.between(E.bt_table, contact_s, ev)]
                    + [float(x) for x in E.between(E.cross, contact_s, ev)]))
                while len(evs) >= 2 and evs[-1] - evs[-2] > end_paired:
                    evs.pop()
                if len(evs) >= 2:
                    ev = min(ev, max(evs[-1], contact_s))
            # A CLIP MUST NOT STOP WHILE THE BALL IS STILL CROSSING THE NET.
            # The padded end is measured from the last table BOUNCE, and on
            # a long rally the last bounce we saw can be seconds behind the
            # last crossing we saw -- the ball goes on being seen over the
            # net after the bounce finder has lost it. The card then closes
            # before its own evidence end, and clamp_evidence quietly drags
            # the evidence back to meet it. Measure the tail from whichever
            # of the two the rally was last seen at.
            base = ev if tail_from_ev else float(b[-1])
            end = min(base + tail, last + V2.TAIL_AFTER_CROSS + V2.TAIL_MAX_S)
        else:
            ev, end = last, last + V2.TAIL_AFTER_CROSS
        if bridge_soft:
            ev = min(ev, ev_hard)
        if pose_tail_s > 0 and POSE is not None and _p_at(end) >= POSE[3]:
            # THE POINT IS NOT OVER WHILE THE PLAYERS ARE STILL PLAYING IT.
            # Where the ball evidence has simply run out -- no more bounces,
            # no more crossings -- the two bodies still say whether the
            # rally is alive. Hold the card open while they do, and close it
            # the moment they settle. It stops at something real every time:
            # the bodies going quiet, a dead ball, the next serve, or the
            # cap.
            T, p, thr = POSE[0], POSE[1], POSE[3]
            stop = min(cut, end + pose_tail_s)
            if len(sv):
                nxt = sv[sv > end]
                if len(nxt):
                    stop = min(stop, float(nxt[0]))
            i = int(np.searchsorted(T, end)); ext = end; quiet = 0.0
            while i < len(T) and T[i] <= stop:
                if p[i] >= thr:
                    ext = float(T[i]); quiet = 0.0
                else:
                    quiet += float(T[i] - T[i - 1]) if i else 0.1
                    if quiet > pose_tail_gap_s:
                        break
                i += 1
            end = max(end, ext)
        return end, ev

    V2.rally_end_ev = patched


def uninstall():
    V2.rally_end_ev = _ORIG
