"""Let the bounce finder tolerate a slightly bigger hole in the track.

`points_v2.bounces` looks at five consecutive detections and refuses the
window if any step spans more than three frames. The serve on Adil's card
21 has a textbook bounce -- image y 487, 546, **566**, 547, 541, a clean
local maximum -- and it is thrown away because the step INTO it spans four
frames. The ball is descending fast there and the detector dropped a frame.

This makes the tolerance a parameter so the cost of four can be measured
end to end rather than argued about. Everything reads `bounces` by name at
call time except the two modules that did `from points_v2 import bounces`,
so those are rebound too.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import math
import points_v2 as V2

_ORIG = V2.bounces
_CUR = [V2.bounces]      # whatever is installed right now


PROD_HOLE_S = 3 / 30.0     # production's own tolerance, as a duration
WINDOW_S = 4 / 30.0        # production's window: 2 samples either side at 30fps


def make(hole, half, pxscale):
    """Production's bounce finder with its three camera assumptions exposed.

    All three were measured, not guessed at (see scale_test.py):

      hole     the biggest step allowed inside the window. Production says
               3 FRAMES, which is 0.10s at 30fps and 0.05s at 60.
      half     how many samples either side of the candidate. Production
               says 2, so at 60fps the window covers half the time and asks
               a different question about the same trajectory.
      pxscale  production ALREADY has this -- `bounces(track, scale)` scales
               BOUNCE_REVERSAL_PX and BOUNCE_MOTION_PX -- and every caller
               in this repo passes 1.0. Film the same match twice as close
               and the finder reports 2,240 bounces where it reported 1,874;
               pass the zoom as `scale` and it reports 1,874 again, exactly.
               So the parameter works and is simply never used.
    """
    def bounces(track, scale=1.0):
        out = []
        fr = sorted(track)
        idx = {f: i for i, f in enumerate(fr)}
        for f in fr:
            i = idx[f]
            if i < half or i > len(fr) - half - 1:
                continue
            w = [track[fr[j]] for j in range(i - half, i + half + 1)]
            if any(fr[j + 1] - fr[j] > hole
                   for j in range(i - half, i + half)):
                continue
            ys = [p[1] for p in w]
            sc = scale * (pxscale(w[half][1]) if callable(pxscale) else pxscale)
            if not (ys[half] >= ys[half - 1] and ys[half] >= ys[half + 1]
                    and ys[half] - ys[0] >= V2.BOUNCE_REVERSAL_PX * sc
                    and ys[half] - ys[-1] >= V2.BOUNCE_REVERSAL_PX * sc):
                continue
            if math.hypot(w[half][0] - w[half - 1][0],
                          w[half][1] - w[half - 1][1]) < V2.BOUNCE_MOTION_PX * sc:
                continue
            out.append((f, track[f][0], track[f][1]))
        return out
    return bounces


def install(hole_s, fps=30.0, pxscale=1.0):
    """Patch points_v2.bounces, and every module that copied the name.

    The tolerance is given as a DURATION and converted here. Production
    writes it as "3 frames", which is a tenth of a second at 30fps and a
    twentieth at 60 -- so the same constant is twice as strict on a 60fps
    upload, and PongLens already takes those. Passing seconds means the
    rule says the same thing whatever the camera recorded at.

    Four modules here do `from points_v2 import bounces`, which takes a
    reference rather than a lookup, so patching the module alone reaches
    none of them. They are rebound by walking sys.modules instead of by a
    fixed list, because export_overlay binds the name BEFORE it imports
    sweep_dead (where this is installed) and would otherwise keep the
    original while everything else used the patch -- the overlay would then
    draw a different set of bounces from the one the cards were built on.
    """
    hole = max(1, int(round(hole_s * fps)))
    half = max(1, int(round(WINDOW_S * fps / 2)))
    fn = (_ORIG if (hole == 3 and half == 2 and not callable(pxscale) and pxscale == 1.0)
          else make(hole, half, pxscale))
    old = _CUR[0]
    V2.bounces = fn
    for mod in list(sys.modules.values()):
        if mod is None or mod is V2:
            continue
        # Match against the function that is installed NOW, not against the
        # original. Comparing to _ORIG silently did nothing when reverting
        # 5 -> 3, because every module was holding the hole-5 function by
        # then, and an ablation that changes nothing reads as a rule that
        # is worth nothing.
        if getattr(mod, "bounces", None) in (old, _ORIG, fn):
            mod.bounces = fn
    _CUR[0] = fn
    return fn


def restore():
    """Put production's own bounce finder back everywhere install() reached.

    The lab never needed this: one process, one experiment. The worker does,
    because the ball pipeline runs in the same process and its reading of a
    bounce must not change because the serve rule borrowed the function.
    """
    old = _CUR[0]
    V2.bounces = _ORIG
    for mod in list(sys.modules.values()):
        if mod is None or mod is V2:
            continue
        if getattr(mod, "bounces", None) in (old, _ORIG):
            mod.bounces = _ORIG
    _CUR[0] = _ORIG
    return _ORIG
