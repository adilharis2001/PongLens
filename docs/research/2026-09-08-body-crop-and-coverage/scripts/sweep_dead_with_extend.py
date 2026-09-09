import json, os, sys
import numpy as np
from collections import defaultdict
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
import points_v2 as V2

# THE BOUNCE FINDER'S HOLE TOLERANCE, raised from production's 3 to 5.
#
# `points_v2.bounces` looks at five consecutive detections and throws the
# window away if any step spans more than a tenth of a second. Card 21 has
# a textbook far-half serve bounce -- image y 487, 546, 566, 547, 541, a
# clean local maximum -- discarded because the step INTO it spans four
# frames -- 0.133s. The ball is descending fast there and the detector
# dropped one. Written as a duration, not a frame count, because
# production's "3 frames" means half as long on a 60fps upload.
#
# Installed HERE, above the imports below, because `deadsplit`,
# `serve_v2rule` and `tossfilter` all do `from points_v2 import bounces`
# and would otherwise capture the original.
#
# NOTE: this is the only change in the lab that touches production's own
# code rather than our serve rule, and `bounces` is read by placement and
# by rally ends as well as by us. Measured here it is worth +4 points
# (82 -> 86 of 93) and costs one card its tail. It has NOT been promoted.
import holepatch
import labmatch as _LM0
FPS = _LM0.FPS             # the match's own frame rate; see labmatch
BOUNCE_HOLE_S = 0.167    # 5 frames at 30fps, against production's 3 (0.100s)
holepatch.install(BOUNCE_HOLE_S, FPS)

import deadsplit
import blindblock
from serve_v2rule import load, serves, _table_w, TABLE_W_REF
from points_v2 import project

import labmatch
M = labmatch.FULL              # set V3_MATCH to point the lab elsewhere
DET = labmatch.DET
# The person gate's second way in, for the serve nobody can see. A near-end
# server stands between the camera and their own half, so the ball is behind
# them for the whole serve and its first sighting IS the bounce -- there is
# no "before" to look back at. See serve_v2rule.serves for the reasoning and
# for why the loose version of it costs two points their card.
import servedwell                                              # noqa: E402
# bounce_within: how long after the ball arrives on the table its qualifying
# bounce may be. The arrival is not itself the bounce -- the ball is still in
# flight when it first projects inside the table -- so some window is needed,
# and 0.15s was the first one that worked.
#
# It is too tight for a serve whose OWN first bounce is never detected. Card
# 13 of 89b35ee0: the far player holds the ball 132.80-133.77, tosses it
# (the projection blows up, which is what a ball above the table plane
# does), strikes it, and the ball is first back on the table at 134.97. Its
# own bounce is never found -- `bounces` needs five consecutive frames with
# no hole over three, and the track has a six-frame hole through the contact
# -- so the first bounce there is is the RECEIVER's, 0.33s later at 135.30.
#
# 0.34-0.36 is a plateau, measured over the whole match: one point that had
# no card at all now has one, one that was swallowed by its neighbour now
# has its own, and two more cards start within Adil's own 2s. The cost is
# one 11.7s point splitting into two cards and one server flipping wrong.
# 0.37 buys one more point and costs two servers, so the middle of the
# plateau is the safe place to stand.
# EVERY LENGTH BELOW IS IN TABLE WIDTHS AND EVERY DURATION IN SECONDS.
# `serves` converts once, against the match's own quad and frame rate. The
# thresholds were chosen on 89b35ee0, where the table is 221px across at
# 30fps, and the raw numbers they came from are noted beside each one so a
# later reading of this file can be checked against the measurements.
GATES = dict(need_bounce=True, need_arrival=True, no_rally=True,
             need_person=True, person_pad=0.60, min_travel=0.30,
             person_bounce_fallback=True,
             person_jump_w=16.3,      # 25 m/s; was 120 px/frame
             person_frac=0.5,
             # ...counted only over the frames that could BE the ball.
             # Reading one frame let a stray outvote thirteen good ones;
             # requiring half let a tracker parked on the wall television
             # outvote them the other way, and refused the plain serve at
             # 16:53.4 because seven of its ten run-up frames were on that
             # TV, 1.6 table widths from the table. A ball about to be
             # served is near the table; a television is not.
             person_near_w=0.6,
             person_hole_s=0.10,      # was 3 frames
             # HOW MUCH of the run-up was at a player, not one frame of it.
             # Reading a single frame lets one stray detection outvote the
             # rest: Adil's serve at 22:14 has 14 frames leading in, 13 of
             # them with the ball inside the far player's box through the
             # toss, and the 14th -- the only one the old rule read -- is a
             # stray at the far left of the frame. Half is the best of the
             # thresholds measured; asking for more rejects real serves
             # (0.7 loses two points their card, 0.9 loses eight).
             player_at=servedwell.People().at,
             fallback_near_only=True, fallback_pair_win=0.6,
             # And it must STAY within half a table width of the table for
             # at least an eighth of a second either side of the bounce. A
             # ball that bounces came down towards the table and carried on
             # afterwards; a tracker flicking between a wall fixture and the
             # table touches it for two or three frames and is gone. See
             # serve_v2rule for card 19, the end of game one, where nobody
             # was playing at all.
             #
             # 0.13s is the gap in the data rather than a tuned number: at
             # 30fps the detections this removes last 1 and 3 frames (0.03
             # and 0.10s) and the shortest run any real serve has is 5
             # (0.17s).
             table_run_s=0.13,        # 4 frames at 30fps
             table_run_w=0.55,        # ~121px here; was 120
             table_run_hole_s=0.10,   # 3 frames at 30fps
             # ...and it has to be ONE BALL the whole way, not merely
             # something near the table each frame. Before the far player's
             # serve at 11:11 the real ball rests motionless in his hand at
             # the far end -- 0.02 widths from the table, so "near" -- while
             # the tracker flicks 327px to a decoy at the NEAR end for two
             # frames, calls that a bounce, and flicks back. Same limit as
             # the broken-trail test: 16.3 widths a second, 25 m/s.
             table_run_jump_w=16.3,
             # A SERVE'S OWN BOUNCE IS NOT ON THE NET. Card 47 is a toss
             # that clipped the net and dropped 10cm past it, then dribbled
             # down the near half. Real serves here land a median 0.91 m
             # from the net and never closer than 0.23 m, so 0.18 sits
             # between the two populations with room either side; 0.16 and
             # 0.20 measure identically.
             net_margin_m=0.18,
             # A SINGLE BOUNCE HAS TO EARN ITS CARD.
             #
             # A real serve makes two bounces on opposite halves. We do not
             # require both, because the server's own body hides their own
             # half often enough that requiring it costs seven of the 86
             # points on this match their only card. The price is that a
             # ball PASSED across between points also lands once, and looks
             # identical.
             #
             # What tells them apart is what happens next. A served ball is
             # in play -- it is returned, it bounces again, it stays in the
             # picture. A passed ball lands once and is caught. Measured
             # over the whole match, cards on points Adil kept keep the ball
             # by the table for 2.17s at the median; cards on stretches he
             # deleted, 0.50s.
             #
             # So a bounce WITH a partner is taken exactly as before -- 79
             # of the 86 good cards never meet this test at all -- and a
             # bounce without one must keep the ball near the table for
             # 1.3s. It removes 9 of the 11 cards sitting on stretches Adil
             # deleted and fixes two splits, and costs two points whose
             # cards were already stopping before his winner press, one of
             # them by 4.6s (which was the worst tail on the whole match).
             # Both thresholds below are read off THIS match's own serves
             # rather than carried in from another camera. The reference is
             # the paired candidates -- serves with both bounces visible on
             # opposite halves, which nobody argues about. On 89b35ee0 the
             # 23rd and 89th percentiles of those 203 come out at exactly
             # 1.30s and 4.00, the two numbers that were hand-picked, so
             # this match does not move and another match gets its own.
             # `calib_min` holds the fixed fallbacks when there are too few
             # paired serves for a percentile to mean anything.
             unpaired_stay_pct=23, unpaired_fast_pct=89, calib_min=30,
             unpaired_stay_s=1.3,          # the fallbacks
             # WHERE THE TABLE ENDS, ASKED IN THE PICTURE AS WELL AS IN
             # METRES. The metre test's 10cm pad is worth 14px at the near
             # end line and 7px at the far one, and where the camera sits
             # nearly level with the far end the projection flattens so far
             # that a bounce 4.9px outside the drawn quad reads as a quarter
             # of a metre past the end line. Adil's long flat serve at 19:43
             # is thrown out twice over by that.
             #
             # Three restrictions keep it honest, and each was measured:
             #   * the two tests are OR'd, never swapped. Replacing the
             #     metre test costs three points their card, because it is
             #     the more generous of the two at the near end.
             #   * only at the table's ENDS. Of the 71 bounces this admits,
             #     45 sit just past an end line between the sidelines (long
             #     serves) and 26 just outside a sideline (balls off the
             #     table sideways). Admitting the second group brings back
             #     the wall-television card.
             #   * "the ball has arrived" uses the wide reading; "a rally
             #     was already running" keeps the strict one. Using the wide
             #     set for both deletes three real serves, because every
             #     frame newly called on-table can veto one.
             bounce_pad_w=0.03, bounce_pad_ends_only=True,
             # AND A FAST BALL ESCAPES THE PASS RULE. The 19:43 serve is
             # unpaired (both its bounces land off the drawn table) and does
             # not linger (it goes long and out), so the pass rule refuses
             # it. It travels 4.9 table widths a second -- 27 km/h -- above
             # every good serve's 90th percentile on this match, where the
             # passes run 0.6 to 2.5. Nobody lobs a ball to their opponent
             # that hard.
             unpaired_fast_w=4.0,
             # Asked only of a PAIRED bounce, because only then do we know
             # whose bounce it is. On an unpaired one the bounce we can see
             # may be the RECEIVER'S, and a short serve's second bounce lands
             # near the net by design.
             net_margin_paired_only=True,
             # ---- 2026-09-06, measured on 89b35ee0 + 77fc4dee + d15aad4d ----
             # Lester 46 -> 98 of 105 with Yu Yu Lin held at 93/93 and no
             # junk there. Each of these was measured alone and together;
             # the record is docs/research and the v3 memory notes.
             hands_box_per_frame=True,     # boxes read at each run-up frame's own moment
             hands_drop_still_s=0.1,       # a "ball" that does not move is a parked decoy
             hands_parked_px=8.0,          # ...and so is a twitch beside it
             hands_empty_abstain=True,     # no frame could be the ball: abstain...
             hands_abstain_rally=(1, 3.0), # ...if at least one net crossing follows
             bounce_within=0.6,            # a long serve whose own bounce is unseen: 0.4-0.57s to the far bounce
             unpaired_rally=(2, 3.0),      # an unpaired bounce that starts a rally is not a pass
             cluster_prefer_paired=True,   # within one serve seen twice, both bounces outranks first
             # ---- 2026-09-06 evening, Adil's edit-cost ruler (inserts hard, deletes
             # easy) over the same three matches, on whole-player boxes with the
             # player-away veto off. See the v3-edit-cost-round memory note.
             net_partner_clear_m=0.4,      # a near-net first bounce is a serve if its partner lands 40cm+ past the net; plateau 0.2-0.6
             # ---- 2026-09-06 night, the seven-match corpus (YYL, Lester, Louis,
             # Anton, Rob, Koko 2, Terry 2). THE HELD BALL. ITTF 2.6.1: a serve
             # starts with the ball resting on the open palm, then thrown up.
             # From a camera behind a player the toss projects far beyond the
             # table and back through the flat homography, and reads as two or
             # three net crossings, so the serve was refused as "a rally is
             # already running" -- 10 of the 24 end-on misses. A ball that was
             # SLOW INSIDE A PLAYER'S BOX (under 2 table widths a second, for
             # at least 0.1s) in the run-up was in a hand, and a hand-held
             # ball was not mid-rally. It only excuses the running-rally test
             # when the ball then went into play (a partner bounce across the
             # net, or a crossing within 2.5s), so the pre-serve bounce-and-
             # catch habit does not open a card. And the stay/fast calibration
             # ignores excused candidates (two of them moved the 23rd
             # percentile past a real serve on 89b35ee0). Measured over the
             # corpus: inserts 36 -> 25, correct 464 -> 472, cards ending
             # before the press 55 -> 44, server 369 -> 379, for +3 doubled
             # and +4 junk; YYL and Lester unchanged. See run_corpus.py and the
             # v3-corpus-round memory note for the dead ends.
             held_slow_w=2.0, held_min_s=0.1, held_trumps_rally=True, held_rally=(1, 2.5))
# V3_NET_OFF=1: THE NET-MARGIN GATE AND ITS ESCAPE, BOTH OFF.
#
# `net_margin_m` (0.18) refuses a candidate whose qualifying bounce lands
# within 18cm of the net; `net_partner_clear_m` (0.40) puts it back when the
# partner bounce lands 40cm past the net on the other half. Measured over the
# seven-match corpus:
#
#     gate on,  escape on   (today)   482 ok, 12 INSERT, 9 SPLIT, 23 doubled, 99 junk, 35 short
#     gate off, escape off            482 ok, 12 INSERT, 9 SPLIT, 23 doubled, 99 junk, 35 short   (identical, every cell, every match)
#     gate on,  escape off            482 ok, 13 INSERT, 9 SPLIT, 22 doubled, 97 junk, 34 short
#
# The gate refuses five candidates across all seven matches and the escape
# restores every one of them. So the pair costs nothing and buys nothing, and
# the only thing it can still do is be tuned on noise by a later session --
# the escape reads as load-bearing (turning it off alone costs a point its
# card) only because the gate it excuses is there.
if os.environ.get("V3_NET_OFF") == "1":
    GATES["net_margin_m"] = 0.0
    GATES["net_partner_clear_m"] = 0.0
# EXPERIMENTS: V3_GATES is a JSON object merged over GATES; empty by default.
GATES.update(json.loads(os.environ.get("V3_GATES", "{}")))
MERGE = dict(gap_max=1.0, dens_min=2.0, maxlen=22.0)
# V3_MERGE_SKIP_PAIRED=1: never merge away a card whose serve showed BOTH bounces.
MERGE_SKIP_PAIRED = os.environ.get("V3_MERGE_SKIP_PAIRED", "1") == "1"   # default on since 2026-09-06 evening
PAIRED_T = set()
# V3_STRONG_CUT=1: a serve with STRONG evidence -- the ball seen resting in a
# hand before it, or both bounces on opposite halves -- ENDS the card that is
# still open, instead of being skipped as a hit inside its rally. A rally
# never has the ball held; a held ball means the previous point is over,
# whatever the crossing chain thinks. Found on Koko 2 when a second detection
# pass made the far half visible: tails ran through the pick-up and the next
# serve was swallowed on six points.
STRONG_CUT = os.environ.get("V3_STRONG_CUT", "0")        # "1": held or paired; "held": held only. Paired
                                                          # over-fires: two bounces on opposite halves is a
                                                          # rally exchange too (doubled +51 on the corpus).
A = load(M, DET)
calib, b, EB, H, track, people = A
# V3_CROSS_VMAX (m/s): drop a net crossing whose projected ball speed is
# beyond anything a real ball does. A tossed ball a metre above the table
# projects hundreds of metres a second through the flat homography. 0 = off.
# V3_CROSS_OURS=1: recompute the net crossings from OUR ball track on every match,
# not only where an alternative detection file is in use. The three oldest matches
# carry a bundle built from production's own track, so today the crossing signal
# has two different origins inside one corpus -- and every rally test reads it.
if os.environ.get("V3_CROSS_OURS") == "1" or os.environ.get("V3_DET") or labmatch.DET_SUFFIX:
    # An alternative detection file changes the track, so the crossings the
    # bundle carries (computed from the original track) must be recomputed
    # from THIS track, or the rally tests judge one ball by another's path.
    EB.cross = np.asarray([float(t) for t in V2.crossings(track, H, FPS)], float)
_VMAX = float(os.environ.get("V3_CROSS_VMAX", "0"))
if _VMAX > 0:
    import crossfilter
    EB.cross = crossfilter.grounded(track, H, FPS, _VMAX)
# V3_FALLBACK=1: production's own fallback cards for stretches of dense ball
# motion no serve card claimed. A point whose serve was never seen still gets
# a card -- Adil's ruler: a card he has to delete is cheap, a point he has to
# insert is not.
FALLBACK = os.environ.get("V3_FALLBACK", "0") == "1"
# V3_FALLBACK_GAP (s): a fallback run this close to a serve card is that
# card's own tail or its pre-serve knocking, not a lost point. V3_FALLBACK_VETO=1
# applies production's veto (a crossing, or a bouncing moving ball) to them.
FALLBACK_GAP = float(os.environ.get("V3_FALLBACK_GAP", "0"))
FALLBACK_VETO = os.environ.get("V3_FALLBACK_VETO", "0") == "1"
# V3_FALLBACK_RATE (serve cards per minute): production's router, made local.
# A fallback card is kept only where the serve detector is plainly not
# anchoring -- fewer than this many serve cards a minute in the two minutes
# around it. Where serves are being seen, an unclaimed stretch is knocking.
FALLBACK_RATE = float(os.environ.get("V3_FALLBACK_RATE", "0"))
# V3_POSE_FALLBACK=1: fallback cards from the two BODIES alone (pose_play.py
# --dump writes /tmp/v3exp/poseplay_<m>.npz: play probability per pose frame,
# from a model trained on the OTHER matches). A stretch the bodies call play
# for 1.5 s+, that no serve card claims, becomes a card. Adil's idea: the
# players' stance and motion say whether a point is on, ball or no ball.
# DEFAULT ON since 2026-09-07 wherever the match has a play signal
# (poseplay/<m>.npz, written by pose_play.py --dump from a model trained on the
# OTHER matches). Measured over the seven: inserts 25 -> 16, correct 472 -> 474,
# doubled +6, junk +13, short 44 -> 38. V3_POSE_FALLBACK=0 switches it off.
POSE_PLAY_FILE = f"{HERE}/poseplay/poseplay_{labmatch.SHORT}.npz"
# THE FALLBACK MUST NOT BE READING A MODEL THAT SAW THIS MATCH'S OWN ANSWERS.
# pose_play.py --dump now stamps its training list into the file; a file made
# before that carries no stamp and is taken on trust with a warning, because
# the ones in the tree came from the all-seven run (/tmp/v3exp/pose_play_all.log,
# every line "trained on the others").
if os.path.exists(POSE_PLAY_FILE):
    try:
        _tr = np.load(POSE_PLAY_FILE).get("train")
    except Exception:
        _tr = None
    if _tr is None:
        print(f"pose fallback: {os.path.basename(POSE_PLAY_FILE)} carries no training list; "
              f"re-run pose_play.py over the whole corpus to stamp it", flush=True)
    elif labmatch.SHORT in {str(x) for x in _tr}:
        raise SystemExit(f"pose fallback refused: {POSE_PLAY_FILE} was trained on "
                         f"{labmatch.SHORT} itself, so its play probability is not held out")
POSE_FALLBACK = os.environ.get("V3_POSE_FALLBACK", "1" if os.path.exists(POSE_PLAY_FILE) else "0") == "1"
POSE_FB_MIN_S = float(os.environ.get("V3_POSE_FB_MIN_S", "3.0"))    # a body segment shorter than this is not a point
# V3_POSE_FB_MINP: HOW SURE THE BODIES HAVE TO BE, averaged over the whole
# segment rather than sampled at a single instant. The segment is cut where
# the probability crosses a half, so a stretch that hovers just above a half
# for six seconds -- two players standing about between points, one of them
# bending to pick the ball up -- is admitted on the same terms as a rally the
# model is sure about. 0 keeps today's behaviour.
POSE_FB_MINP = float(os.environ.get("V3_POSE_FB_MINP", "0"))
POSE_FB_GAP_S = float(os.environ.get("V3_POSE_FB_GAP_S", "2.0"))    # ...and it keeps this clear of any serve card
# V3_FB_ABSORB_S (seconds): A BODY-PLAY STRETCH BESIDE ONE SERVE CARD IS
# THAT CARD'S OWN POINT.
#
# The bodies do not start at the serve and stop at the last stroke. The
# players are already moving in the ready stance before the ball is thrown
# up, and afterwards they follow through, walk in for the ball and reset --
# so a "bodies say play" stretch that has a single serve card beside it is
# the head or the tail of that serve's point. A rally has exactly one serve
# in it, and this stretch has none of its own.
#
# It ABSORBS rather than deletes: the serve card is stretched over the body
# stretch, so nothing the bodies were doing falls outside a card. Deleting
# would risk the one failure that costs the owner real work, a point with no
# card at all -- and measured, deleting instead (POSE_FB_GAP_S 4.0) adds
# three of those where absorbing removes two.
#
# TWO serve cards near the stretch is a different picture: the bodies then
# really do span two points, and gluing those together would swallow one.
# So the rule fires only where exactly one card is in reach.
FB_ABSORB_S = float(os.environ.get("V3_FB_ABSORB_S", "4.0"))   # default on 2026-09-07

# V3_RESCUE_S (seconds): A SECOND LOOK WHERE NOTHING WAS FOUND AT ALL.
#
# Between two points there is a pause: the ball is picked up, somebody walks
# back, the score is called. A point takes a serve, a rally and a winner --
# and it leaves a card. So a stretch of the match that no card covers, and
# that is longer than a pause, is either an interruption or a point we
# failed to see; and on this corpus most of them are the second.
#
# Anton is where it shows: six of its seven missing points sit in an
# uncarded gap between two ordinary cards -- 3.9, 3.9, 7.2, 8.6, 11.0 and
# 13.8 seconds long -- and in every one of them the serve rule DID find a
# candidate and refused it, either as a pass that did not linger or as a
# ball that came from nobody's hands.
#
# The rule this expresses is not "lower the threshold". It is that the
# evidence a gate needs depends on what else is competing for the moment.
# In the middle of a rally a doubtful bounce must be refused, because
# accepting it splits a point in two. In a stretch where nothing at all was
# found, the same doubtful bounce is the best evidence there is, and
# refusing it costs the owner the expensive edit -- a point with no card.
#
# So: the refused detections are kept aside, and one is admitted only where
# it sits alone in a gap at least V3_RESCUE_S long, clear of the cards
# either side by V3_RESCUE_CLEAR. It is then an ordinary card and every
# rule below still judges it -- the rolling rule, the pass rule, the
# on-own-table rule, the wedge rule and the knock-up rule all run after.
#
# It cannot delete a card and it cannot swallow a point: it only ever adds
# a card where there was none.
RESCUE_S = float(os.environ.get("V3_RESCUE_S", "7.0"))   # default on 2026-09-07: the second look
# ...and it must sit this far from the card either side, so it cannot land
# on the tail of the point before it or the head of the one after. TWO
# SECONDS, IN SECONDS: asked instead as a fraction of the gap (the middle
# 43%, which is the same thing at a seven-second gap) it costs two points
# their card, because a long break then demands a proportionally huge
# clearance. A point's tail is a fixed length; a pause is not.
RESCUE_CLEAR = float(os.environ.get("V3_RESCUE_CLEAR", "2.0"))
# The head of the video is not a gap between two points -- it is before the
# match, where the knock-up lives. V3_RESCUE_HEAD=1 lets the rescue reach it
# anyway (the knock-up rule still removes what it should).
RESCUE_HEAD = os.environ.get("V3_RESCUE_HEAD", "1") == "1"
SV_RESCUE = []      # (contact_s, bounce_s, side) refused upstream; filled by the page
# V3_RESCUE_CROSS "<n>:<seconds>": AND THE BALL HAS TO CROSS THE NET.
# A point is played over the net. A ball knocked about between points, or a
# tracker touching the table while the players stand around, does not cross
# it. Asked of the rescue card only -- the ordinary cards have earned their
# place by other means.
# Three seconds is the window the two other "is this really in play"
# tests in this file already use (unpaired_rally, hands_abstain_rally): a
# rally shows itself inside three seconds or it was not one. Measured at 2
# and 4 as well -- both cost a point or two.
_RC = os.environ.get("V3_RESCUE_CROSS", "1:3.0")
RESCUE_CROSS_N, RESCUE_CROSS_WIN = int(_RC.split(":")[0]), float(_RC.split(":")[1])

# V3_WARMUP=1: THE KNOCK-UP BEFORE THE MATCH. Both players warm each other up
# before the first point; nobody is scoring, so a single exchange runs a dozen
# or twenty shots and nothing makes them stop. Once the match starts, every
# point is a serve, a short rally and a pause. `warmup.knockup_end` finds the
# opening chain of long exchanges and returns where it stopped, or None when
# the match had no knock-up on the tape. Cards that END before that are
# knocking, and go. It refuses to answer unless the chain is dense from t=0,
# because a match that starts at once must not lose its first points -- an
# insert is the expensive edit. V3_WARMUP_KW is a JSON object of overrides
# for the knock-up test (min_cross, chain_gap_s, min_n, min_rate, max_end_s).
# V3_WARMUP_GRACE (s): a card is knocking if it has FINISHED by the time the
# match starts. The last knock of a knock-up usually ends a second or two
# after the last long exchange in it -- the players hit two or three more
# balls -- so a card is also knocking if it ends within this grace of the
# boundary. 0 is the strict reading; the corpus measures the same for 1.5 to
# 6 s and the first point's own card is never within 13 s of the boundary on
# any of the four matches that have a knock-up. Default 4 s here: the measured
# plateau is 3 to 10 s (45 knocking cards, no point touched) and the cliff is
# at 14 s, where Louis's own first point comes within a second of being eaten.
WARMUP = os.environ.get("V3_WARMUP", "1") == "1"               # default on 2026-09-07
WARMUP_GRACE = float(os.environ.get("V3_WARMUP_GRACE", "4.0"))
WARMUP_KW = json.loads(os.environ.get("V3_WARMUP_KW", "{}"))
WARMUP_END = None
# V3_WARMUP_STARTED=1: YOU CANNOT SERVE THE FIRST POINT OF A MATCH WHILE THE
# KNOCK-UP IS STILL GOING.
#
# The boundary test above asks where a card ENDS. A card that OPENED in the
# middle of the knocking therefore survives it whenever the assembler's tail
# padding carries it past the boundary, which is exactly what happens to the
# last knock of a long exchange: Rob's card at 2:32.7 begins 11.5 s before the
# knock-up's last long exchange finishes and lives only because it runs 1.1 s
# past the grace, and Koko 2's at 1:56.4 begins 7.7 s before its own boundary.
# Neither can be the first point of the match -- the players were still
# knocking up when it started. Where a card began is a fact about the card;
# where it stops is a fact about the padding.
#
# Free on this corpus: two junk cards go and every other column is identical,
# because a card that starts before the boundary and is a real point cannot
# exist unless the boundary itself overran, and the boundary refuses to answer
# at all unless the knock-up is plain.
WARMUP_STARTED = os.environ.get("V3_WARMUP_STARTED", "1") == "1"   # default on 2026-09-07

# Now the match's own camera is known, tell the bounce finder how big this
# table is against the one the constants were measured on. On 89b35ee0 the
# ratio is exactly 1, so nothing here moves; on a match filmed twice as
# close it stops the finder reporting 20% more bounces than it should.
TABLE_W = _table_w([tuple(calib["corners"][k]) for k in
                    ("A_near_1", "B_near_2", "C_far_2", "D_far_1")])
if os.environ.get("V3_BOUNCE_LOCAL", "0") == "1":
    # THE TABLE IS NOT ONE SIZE IN THE PICTURE. From behind a player the far
    # end line is a third of the near one, so a bounce there moves a third
    # of the pixels, and one scale for the whole table -- the mean of the
    # two ends -- asks the far half for reversals it cannot show. Scale by
    # the table's own width at the ball's image height instead.
    _q = {k: calib["corners"][k] for k in ("A_near_1", "B_near_2", "C_far_2", "D_far_1")}
    _wn = ((_q["B_near_2"][0] - _q["A_near_1"][0]) ** 2 + (_q["B_near_2"][1] - _q["A_near_1"][1]) ** 2) ** 0.5
    _wf = ((_q["C_far_2"][0] - _q["D_far_1"][0]) ** 2 + (_q["C_far_2"][1] - _q["D_far_1"][1]) ** 2) ** 0.5
    _yn = (_q["A_near_1"][1] + _q["B_near_2"][1]) / 2; _yf = (_q["C_far_2"][1] + _q["D_far_1"][1]) / 2
    def _local_scale(y):
        if abs(_yn - _yf) < 1e-6: return TABLE_W / TABLE_W_REF
        a = min(1.0, max(0.0, (y - _yf) / (_yn - _yf)))      # 0 at the far end, 1 at the near
        return (_wf + a * (_wn - _wf)) / TABLE_W_REF
    holepatch.install(BOUNCE_HOLE_S, FPS, pxscale=_local_scale)
else:
    holepatch.install(BOUNCE_HOLE_S, FPS, pxscale=TABLE_W / TABLE_W_REF)
SV = serves(*A, **GATES)
if MERGE_SKIP_PAIRED:
    _coll = []
    serves(*A, **GATES, collect=_coll)
    PAIRED_T = {c["t"] for c in _coll if c["paired"]}
    if STRONG_CUT == "1":
        blindblock.STRONG_T = {round(c["t"] - V2.CONTACT_LOOKBACK_S, 2) for c in _coll if c["paired"] or c.get("held")}
    elif STRONG_CUT == "held":
        blindblock.STRONG_T = {round(c["t"] - V2.CONTACT_LOOKBACK_S, 2) for c in _coll if c.get("held")}
# Production's own per-card record, joined to the 89b35ee0-era scored list.
# A match seeded from its crossings bundle has no such record (points=None),
# and real_scored.json is that first match's anyway, so this is empty for any
# other match rather than a crash at import.
pts = calib.get("points") or {}
SCORED = {r["idx"]: pts[str(r["idx"])] for r in json.load(open(f"{HERE}/real_scored.json"))
          if pts.get(str(r["idx"]))}


class Ev: pass


def make_e():
    """The lab's stand-in for points_v2.Evidence.

    It had drifted from the real one in two ways that matter, and both were
    found by trying to run production's own assembly chain against it:

      bt         production fills this with BOUNCES in the corridor. This
                 filled it with every ball POSITION in the corridor, which
                 is roughly ten times as many, and `veto` counts it.
      ball_dense production marks half-second bins holding at least
                 MIN_FAST frames of BALL_FAST_PX motion, plus a window
                 either side of each crossing. This marked +/-0.2s around
                 EVERY ball position, so a tracker sitting on a wall
                 television read as a live rally. `fallback_points` walks
                 exactly this array, and on the loose version it invented
                 26 cards over stretches Adil never carded.

    Both now match production. `motifs` and `ingate` stay stubbed: nothing
    in the chain below reads them on a calibrated match.
    """
    e = Ev()
    e.duration = float(b["duration"]); e.fps = FPS
    e.n = int(e.duration / V2.TICK) + 1
    e.shape = b.get("camera"); e.calibrated = True; e.geometric = True
    e.track = track; e.cross = EB.cross
    e.between = lambda a, x, y: a[(a >= x) & (a <= y)] if len(a) else a
    # THE SAME on-table question the serve rule asks, asked the same way.
    #
    # `on_own_table` throws away any card with no bounce on our own table
    # inside it, and it reads THIS array. The long serve at 19:43 builds a
    # card covering Adil's winner press and is then discarded here, because
    # every bounce in it is "off the table" by the metre test -- including
    # the one 4.9px outside the drawn quad. Two tests disagreeing about what
    # the table is, in two files, is how a rule gets fixed in one place and
    # stays broken.
    padpx = None
    if GATES.get("bounce_pad_w") is not None:
        from serve_v2rule import _quad_gap, _table_w
        quad = [tuple(calib["corners"][k]) for k in
                ("A_near_1", "B_near_2", "C_far_2", "D_far_1")]
        padpx = GATES["bounce_pad_w"] * _table_w(quad)
    bt, btt, wide = [], [], []
    for f, x, y in V2.bounces(track, 1.0):
        p = project(H, x, y)
        if not p or not V2.in_corridor(*p):
            continue
        t = f / FPS
        bt.append(t)
        if -0.15 <= p[0] <= V2.W_M + 0.15 and -0.15 <= p[1] <= V2.L_M + 0.15:
            btt.append(t)
        elif padpx is not None and (-0.10 <= p[0] <= V2.W_M + 0.10) \
                and _quad_gap(quad, x, y) <= padpx:
            wide.append(t)
    # TWO ARRAYS, BECAUSE TWO DIFFERENT QUESTIONS READ THEM.
    #
    # `on_own_table` asks "did the ball ever touch OUR table inside this
    # card" -- a membership question, and the wider reading is the right one
    # there: the long serve at 19:43 builds a card over Adil's winner press
    # and is thrown away because its only bounce sits 4.9px outside the
    # drawn quad.
    #
    # `rally_end_ev` asks "when did the rally stop", and it takes the LAST
    # bounce it can see. Feeding it the wider set pushes card ends later,
    # and a card that runs long swallows the point after it -- measured,
    # three points lose their card that way. So the end keeps the strict
    # reading and only the membership test is widened.
    e.bt = np.asarray(bt, float); e.bt_table = np.asarray(btt, float)
    e.bt_table_wide = np.asarray(sorted(btt + wide), float)
    e.serves = sorted({c for c, _b, _s in SV})
    e.server_by_contact = {round(c, 2): s for c, _b, s in SV}
    e.motifs = []
    frames = sorted(track)
    nbin = int(e.duration / V2.BIN_S) + 1
    fastbin = np.zeros(nbin)
    # BALL_FAST_PX IS 8 PIXELS and the gap tolerance is 3 FRAMES, both read on
    # a 221px table at 30fps. `ball_dense` is what `split_long` cuts a long
    # card on, and what the tail extension and the fallback cards walk. On Koko
    # 2's 378px table 8px is 0.021 table widths against 0.036 here, so the same
    # ball reads "fast" on one camera and still on another. Scaling both is a
    # no-op on the corpus -- `split_long` fires once across the seven -- and it
    # stops the mask meaning something different on the next camera.
    _pw = os.environ.get("V3_DENSE_W") == "1" or os.environ.get("V3_PORTABLE", "1") == "1"
    _fast_px = V2.BALL_FAST_PX * (TABLE_W / TABLE_W_REF if _pw else 1.0)
    _fast_gap = max(1, int(round(0.10 * FPS))) if _pw else 3
    for f0, f1 in zip(frames, frames[1:]):
        if f1 - f0 > _fast_gap:
            continue
        (xa, ya), (xb, yb) = track[f0], track[f1]
        if abs(xb - xa) + abs(yb - ya) >= _fast_px:
            k = int((f1 / FPS) / V2.BIN_S)
            if k < nbin:
                fastbin[k] += 1
    dense = np.zeros(e.n, bool)
    for k in np.nonzero(fastbin >= V2.MIN_FAST)[0]:
        V2._mark(dense, k * V2.BIN_S, (k + 1) * V2.BIN_S)
    for t in e.cross:
        V2._mark(dense, t - 0.2, t + 0.2)
    e.ball_dense = dense; e.ingate = np.zeros(e.n, bool)
    return e


VETO_DEAD = []          # dead-ball runs that forbid a merge


ROLL_RATE = 2.0     # rolling bounces a second: above this, nobody is playing


ROLL_MAX_NONROLLING = None   # V3_ROLL_NONROLL: only veto a card with at most this many NON-rolling bounces
PASS_HEIGHT = 0.30   # table widths over the net's base; 0 disables
PASS_CROSS = 1       # ...and only when the card produced at most this many crossings
# V3_PASS_FAST: a pair travelling at least this many table widths a second is
# not a pass, however high it read over the net. The fast escape the unpaired
# rule already uses, at the same 4.0 (22 km/h): nobody lobs a ball back that
# hard. d15aad4d's point 40 covers 201 cm in 0.30s (4.4 TW/s) and was dropped
# here as a pass. 0 disables.
PASS_FAST_W = float(os.environ.get("V3_PASS_FAST", "0"))
# V3_PASS_ANCHOR=1: measure the pass on the SERVE'S OWN bounce pair, not on the
# earliest bounce in the window. On d15aad4d's point 40 the window opens on the
# server bouncing the ball at the end line (v=0.04) 0.6s before the serve, so
# the pair read 0.9s long, 1.8 TW/s and 0.66 TW high, and a 4.4 TW/s serve
# was dropped as a pass.
PASS_ANCHOR = os.environ.get("V3_PASS_ANCHOR", "1") == "1"   # default on since 2026-09-06 evening


def _pixel_bounces():
    """Every on-table bounce with its PIXEL position, cached.

    `e.bt_table` carries only the times. Height has to be read in the image,
    so the pixel position of each bounce is needed too.
    """
    global _PXB
    try:
        return _PXB
    except NameError:
        pass
    import serve_v2rule as _R
    from serve_v2rule import PAD as _PAD
    quad = [tuple(A[0]["corners"][k]) for k in ("A_near_1", "B_near_2", "C_far_2", "D_far_1")]
    tw = _R._table_w(quad)
    out = []
    for f, x, y in V2.bounces(track, 1.0):
        p = project(H, x, y)
        # 0.03 IS `bounce_pad_w`, WRITTEN OUT AGAIN. The serve rule asks this
        # same question through GATES["bounce_pad_w"], and so does the compare
        # page's own bounce set; serveorigin.table_bounces writes the literal
        # a third time. Sweep the gate and two of the three do not move. It
        # costs nothing today (measured: bounce_pad_w 0.03 -> 0.06 gives the
        # same table shared or not) -- it is a trap for the next sweep.
        _bp = (GATES.get("bounce_pad_w") or 0.0) if (
            os.environ.get("V3_BPAD_SHARED") == "1"
            or os.environ.get("V3_PORTABLE", "1") == "1") else 0.03
        if p is None or not (-_PAD <= p[0] <= V2.W_M + _PAD):
            continue
        if -_PAD <= p[1] <= V2.L_M + _PAD or _R._quad_gap(quad, x, y) <= _bp * tw:
            out.append((f / FPS, x, y, p[1]))
    _PXB = (out, tw)
    return _PXB


def _not_passed(e, cards):
    """Drop a card opened by a ball PASSED back to the server.

    Adil's idea, 2026-09-05. When a player retrieves the ball and returns it
    -- thrown, or hit with a service motion -- it sails far higher over the
    net than a serve does, and no rally follows.

    Neither half of that works alone, and both were measured:

      * height by itself does not separate. The serve crossings on this match
        run 0.14 to 0.66 table widths over the surface and the three HIGHEST
        are ordinary points with a loop in them, while a hand-judged false
        card sits at 0.14 alongside the genuine ones;
      * a low crossing count by itself does not separate either. Twenty-seven
        cards here produce one crossing or none, and most are real points
        whose ball track simply fragmented.

    Together they do. Among cards with at most one crossing the pass sits at
    0.36 and the next card at 0.23, so 0.30 falls in the middle -- about a
    foot of daylight over the tape, on a ball that started nothing.

    Side-on only. End-on, the ball crosses the net moving away from the
    camera and height cannot be told from distance, so this must not be
    reached from the end-on assembler.
    """
    if PASS_HEIGHT <= 0:
        return cards
    import netheight as _N
    bt, tw = _pixel_bounces()
    xs = [float(t) for t in V2.crossings(track, H, FPS)]
    out = []
    for c in cards:
        if c.get("serve_s") is None or sum(1 for t in xs if c["t0"] <= t <= c["t1"]) > PASS_CROSS:
            out.append(c); continue
        s = c["serve_s"]
        nb = [b for b in bt if s - 0.1 <= b[0] <= s + 2.2]
        pair = None
        if PASS_ANCHOR:
            _anchor = s + V2.CONTACT_LOOKBACK_S
            _first = min(nb, key=lambda b_: abs(b_[0] - _anchor), default=None)
            if _first is not None and abs(_first[0] - _anchor) <= 0.2:
                _nxt = [b_ for b_ in nb if b_[0] > _first[0] and b_[0] - _first[0] <= 1.6
                        and (b_[3] - V2.NET_V) * (_first[3] - V2.NET_V) < 0]
                if _nxt:
                    pair = (_first, _nxt[0])
        else:
            for i in range(len(nb)):
                for j in range(i + 1, len(nb)):
                    if (nb[i][3] - V2.NET_V) * (nb[j][3] - V2.NET_V) < 0 and nb[j][0] - nb[i][0] <= 1.6:
                        pair = (nb[i], nb[j]); break
                if pair:
                    break
        if PASS_FAST_W > 0 and pair and abs(pair[1][3] - pair[0][3]) / max(pair[1][0] - pair[0][0], 1e-3) / 1.525 >= PASS_FAST_W:
            out.append(c); continue
        h = _N.crossing_height(H, track, pair[0], pair[1], tw) if pair else None
        if h is None or h < PASS_HEIGHT:      # unmeasurable: leave the card alone
            out.append(c)
    return out


def _not_rolling(e, cards):
    """Drop a card that is mostly the ball ROLLING on the table.

    Adil on card 64 of 89b35ee0: "most of the card is just the ball rolling
    on it." That card is the ball being retrieved after a point ended on the
    net cord -- twelve rolling bounces in 4.3 seconds.

    `dead_runs` already finds a rolling ball: consecutive table bounces the
    ball never rises between. It has only ever been used to CUT a card at
    the moment the rally died. Counting how DENSE those bounces are inside a
    card says something different -- that the card was never a rally at all.

    The separation is wide, not tuned: card 64 runs at 2.82 rolling bounces
    a second and the next card on the whole match at 1.41. Anything from 1.5
    to 2.8 gives the same answer, so 2.0 sits in the middle of a plateau.
    """
    if ROLL_RATE <= 0 or not VETO_DEAD:
        return cards
    out = []
    for c in cards:
        bn = e.bt_table[(e.bt_table >= c["t0"]) & (e.bt_table <= c["t1"])]
        rolling = sum(1 for t in bn
                      if any(a - 0.1 <= float(t) <= b_ + 0.1 for a, b_ in VETO_DEAD))
        # A card that RALLIED before the ball rolled was a point. Lester's
        # card 87 has four real bounces and then fourteen rolling ones in
        # 6.8s -- 2.05/s, over the line by a whisker -- while the card this
        # rule was written for (89b35ee0 at 16:09) has ONE bounce that is
        # not rolling. Density alone cannot tell a short point with a long
        # dribble from a ball that was never in play.
        if (ROLL_MAX_NONROLLING is not None
                and len(bn) - rolling > ROLL_MAX_NONROLLING):
            out.append(c); continue
        if rolling / max(c["t1"] - c["t0"], 1e-6) < ROLL_RATE:
            out.append(c)
    return out


# BETWEEN ONE RALLY AND THE NEXT THERE IS ONE SERVE, NOT TWO (V3_WEDGE).
#
# Adil deletes a card that is really the ball being knocked back to the
# server, or a serve that was faulted and taken again. On the picture that
# event is a SINGLE TRIP: the ball goes across once and comes to rest. A
# rally is trips there and back.
#
# So count the trips a card shows -- net crossings, and changes of half
# between its on-table bounces, whichever saw more -- and read the card in
# its place in the match. A one-trip card pressed hard up against a card
# either side of it that plainly rallied is the dead time between two
# points, not a point: the players had no pause in which to play it.
#
# Two guards, and both are about not reading an absence as a denial:
#
#   * only a card the SERVE detector opened. A body-only fallback card
#     exists because the ball could not be seen at all, so "the ball made
#     one trip" says nothing about it.
#   * only a card whose ball touched our own table at least once. Same
#     reason: with no bounce inside it there is no trip to count.
#
# 1.0 to 1.8 seconds all measure the same on the corpus (8-9 junk cards and
# 4 doubled points, no point losing its only card), so 1.5 is the middle of
# a plateau rather than an edge. At 2.0 the first real point goes.
WEDGE_GAP = float(os.environ.get("V3_WEDGE", "1.5"))      # seconds; 0 = off. default on 2026-09-07
# The two gaps are not the same event and need not be the same length. The
# ball is knocked back the moment the point ends, so the card in front of it
# is BUTTED onto the one before -- 0.95s and 1.2s are the assembler's own
# floors, and anything up to about 1.7 means the same thing, "touching".
# What follows is the players resetting and the next server getting ready,
# which takes as long as it takes. V3_WEDGE_NEXT sets the second gap; unset,
# it follows the first.
WEDGE_WEAK = int(os.environ.get("V3_WEDGE_WEAK", "1"))    # trips a knock-back may show
WEDGE_STRONG = int(os.environ.get("V3_WEDGE_STRONG", "2"))  # trips a neighbour must show
WEDGE_MIN_BOUNCES = int(os.environ.get("V3_WEDGE_MIN_B", "1"))
WEDGE_GAP_NEXT = float(os.environ.get("V3_WEDGE_NEXT", "8.0"))   # 2.0 -> 8.0 on 2026-09-07
WEDGE_PASSES = int(os.environ.get("V3_WEDGE_PASSES", "1"))  # how many times to sweep
# V3_WEDGE_SIDEON=1: only where the camera is square-on. From behind a player
# the two halves lie one behind the other, so "the ball changed half" is a
# depth reading and the trip count is softer than it is side-on.
WEDGE_SIDEON = os.environ.get("V3_WEDGE_SIDEON", "1") == "1"   # default on 2026-09-07


def _trips(e, c):
    """How many times the ball went across inside this card.

    Two independent readings of the same thing, and the larger wins: net
    crossings seen by the tracker, and changes of half between consecutive
    on-table bounces. A ball knocked back bounces once on each half -- one
    change -- and crosses once. A rally does both again and again.
    """
    bt, _tw = _pixel_bounces()
    hs = ["near" if b[3] < V2.L_M / 2 else "far" for b in bt if c["t0"] <= b[0] <= c["t1"]]
    alt = sum(1 for i in range(len(hs) - 1) if hs[i] != hs[i + 1])
    nc = int(((e.cross >= c["t0"]) & (e.cross <= c["t1"])).sum())
    return max(nc, alt), len(hs)


def _regrow(e, cards):
    """Give a card back the ending that was only ever trimmed for a neighbour.

    THE RULE, AS A PLAYER WOULD SAY IT: a clip is cut short to make room for
    the next point. If the next point turns out not to be a point at all, the
    room is not needed and the clip should end where the rally ended.

    `resolve` trims the earlier of two colliding serve cards so the later one
    keeps a head before its own contact. Every filter that DELETES a card
    runs after that -- the wedge rule, the pass rule, the rolling rule, the
    own-table test, the knock-up -- and none of them puts the trim back. Yu
    Yu Lin's point 27 is the clean example: the rally ends at 4:57.3, the
    card is padded to 4:59.9, a knock-back at 4:59.5 opens a card of its own
    and squeezes the point back to 4:58.2, and then the wedge rule throws
    that knock-back away. Nothing occupies 4:58.2 to 5:04.4 any more, and
    Adil pressed the winner at 5:00.1 -- inside the ending the card had
    before the squeeze.

    Nothing is invented here. The card can only grow back to the end its own
    rally evidence gave it, and never within MIN_DEAD_S of the card that
    really does follow it. A card produced by splitting a long one is left
    alone: its ending is the split, not a rally end, and regrowing it would
    simply undo the split.
    """
    for i, c in enumerate(cards):
        if c.get("serve_s") is None or c.get("no_regrow"):
            continue
        end, ev = V2.rally_end_ev(e, c["serve_s"])
        end = min(end, c["serve_s"] + V2.MAX_RALLY_S, e.duration)
        room = (cards[i + 1]["t0"] - V2.MIN_DEAD_S) if i + 1 < len(cards) else e.duration
        t1 = min(end, room)
        if t1 > c["t1"] + 1e-6:
            c["t1"] = t1
            if c.get("end_evidence_s") is None or ev > c["end_evidence_s"]:
                c["end_evidence_s"] = ev
            V2.clamp_evidence(c)
    return cards


def _not_wedged(e, cards):
    """Drop a one-trip card wedged between two rallies with no pause."""
    if WEDGE_GAP <= 0 or len(cards) < 3:
        return cards
    if WEDGE_SIDEON and (e.shape or 0) < V2.MIN_FORESHORTEN:
        return cards
    for _ in range(max(1, WEDGE_PASSES)):
        tr = [_trips(e, c) for c in cards]
        drop = set()
        for i in range(1, len(cards) - 1):
            c = cards[i]
            if c.get("why") == "bodies say play" or c.get("serve_s") is None:
                continue
            trips, nb = tr[i]
            if trips > WEDGE_WEAK or nb < WEDGE_MIN_BOUNCES:
                continue
            if (c["t0"] - cards[i - 1]["t1"] > WEDGE_GAP
                    or cards[i + 1]["t0"] - c["t1"] > WEDGE_GAP_NEXT):
                continue
            if tr[i - 1][0] >= WEDGE_STRONG and tr[i + 1][0] >= WEDGE_STRONG:
                drop.add(i)
        if not drop:
            break
        cards = [c for i, c in enumerate(cards) if i not in drop]
    return cards


def _on_own_table(e, cards):
    """production's on_own_table, asked of the WIDE bounce set."""
    a = getattr(e, "bt_table_wide", e.bt_table)
    return [c for c in cards
            if int(((a >= c["t0"]) & (a <= c["t1"])).sum()) >= V2.MIN_TABLE_BOUNCES]


BLIND_BLOCK = True      # a card that never saw a rally does not block a serve

# A CARD IS ONLY EVER TRIMMED TO MAKE ROOM FOR ITS NEIGHBOUR (2026-09-07).
# When the neighbour is then deleted, nothing is asking for the room. See
# _regrow.
REGROW = os.environ.get("V3_REGROW", "1") == "1"   # default on 2026-09-07


# ---- V3_BODYFIRST: the point is found by watching the two players ---------
#
# Everything above finds a point by finding its SERVE, so a point whose serve
# the ball detector never saw has no card at all. `bodyfirst.py` segments the
# match from the two bodies alone -- they are at their ends, they are busy,
# and they are busy in turn -- and writes the stretches to
# bodyfirst/bf_<match>.npz. This reads those stretches back and makes them the
# cards.
#
#   V3_BODYFIRST=1        the body stretches ARE the cards. No ball at all.
#   V3_BODYFIRST=confirm  the body stretches are the cards, and the ball is
#                         allowed to refine them (below, one flag each).
#   V3_BODYFIRST=union    today's ball cards, unchanged, plus a body stretch
#                         wherever no ball card reaches.
#
# Unset, nothing here runs and the assembler behaves exactly as it did.
BODYFIRST = os.environ.get("V3_BODYFIRST", "")
BF_FILE = f"{HERE}/bodyfirst/bf_{labmatch.SHORT}.npz"
# A card opens a little before the players start and shuts after they stop.
# Seconds, and the same two numbers bodyfirst.py's own `cards()` uses.
BF_PAD0 = float(os.environ.get("V3_BF_PAD0", "0.4"))
BF_PAD1 = float(os.environ.get("V3_BF_PAD1", "0.8"))

# The four things the ball is allowed to say about a body stretch, each
# switchable on its own so each can be measured on its own.
BF_SERVE = os.environ.get("V3_BF_SERVE", "0") == "1"
# A stretch with no net crossing inside it is not a rally. "quiet" is the
# softer reading: throw it away only when the ball was never seen doing
# ANYTHING there -- no crossing and no bounce on our own table either.
BF_NOCROSS = os.environ.get("V3_BF_NOCROSS", "")   # "" off, "1" strict, "quiet" soft
# Two serves this many SECONDS apart inside one stretch is two points.
BF_SPLIT = float(os.environ.get("V3_BF_SPLIT", "0"))
# Pull the end back to the last thing the ball was seen doing: "cross" (net
# crossings), "bounce" (bounces on the table), "both", or "" for off.
BF_END = os.environ.get("V3_BF_END", "")
BF_END_PAD = float(os.environ.get("V3_BF_END_PAD", "0.8"))   # seconds after it
# V3_BF_EXTEND: LET THE BALL KEEP A CARD OPEN, NEVER SHUT ONE.
#
# The bodies lose a card's end when a player leaves the picture or hides
# behind the other one. Measured on 320 pressed points (2026-09-08): the
# ball's LAST sighting is useless as an end (144 ends pushed >2 s late --
# players bounce the ball before serving, fetch it, knock it about), but the
# ball as CONTINUITY is clean: extend while crossings and table bounces keep
# arriving with gaps <= 1.2 s from before the body's end and the body's own
# play reading stays >= 0.3, stop at the first silence. 9 of 30 early endings
# repaired, 2 pushed late, no card created. "cross", "bounce" or "both".
BF_EXTEND = os.environ.get("V3_BF_EXTEND", "")
BF_EXTEND_GAP = float(os.environ.get("V3_BF_EXTEND_GAP", "1.2"))
BF_EXTEND_PMIN = float(os.environ.get("V3_BF_EXTEND_PMIN", "0.3"))
# V3_BF_AFTER_FIRST: DO NOT ADD A BODY CLIP BEFORE THE MATCH HAS STARTED.
#
# The bodies find real table tennis before the first scored point -- on Louis
# the owner starts scoring at 3:40 and there are twenty rallies before it, with
# the same lengths and the same gaps as the scored ones. They are not detector
# errors; they are practice points nobody scored. But they are still twenty
# clips to delete, and they are where almost all of the union's extra junk
# comes from (Louis 7 -> 25, Koko 2 7 -> 14). The ball pipeline's own first
# card is the cheapest available answer to "has the match started", it needs
# no new evidence, and it is the same line the ball pipeline already draws for
# itself.
BF_AFTER_FIRST = os.environ.get("V3_BF_AFTER_FIRST", "") == "1"


def _bf_segments():
    """[(start, end)] seconds, from bodyfirst.py's dump for THIS match."""
    if not os.path.exists(BF_FILE):
        raise SystemExit(
            f"V3_BODYFIRST is set but there is no body segmentation for "
            f"{labmatch.SHORT}: {BF_FILE} does not exist. Run "
            f"`python bodyfirst.py <run> {labmatch.SHORT} --dump` first.")
    z = np.load(BF_FILE)
    segs = np.asarray(z["segs"], float).reshape(-1, 2)
    return [(float(a), float(b)) for a, b in segs]


_BF_PLAY = None


def _bf_play():
    """(T, p) from the dump: the per-frame play reading the segments came from."""
    global _BF_PLAY
    if _BF_PLAY is None:
        z = np.load(BF_FILE)
        _BF_PLAY = (np.asarray(z["T"], float), np.asarray(z["p"], float))
    return _BF_PLAY


def _bf_pmin(a, b):
    T, p = _bf_play()
    i0, i1 = np.searchsorted(T, a), np.searchsorted(T, b)
    return float(p[i0:i1].min()) if i1 > i0 else 1.0


def _bf_cards(e):
    return [dict(t0=max(0.0, a - BF_PAD0), t1=min(e.duration, b + BF_PAD1),
                 serve_s=None, why="bodies", end_evidence_s=b)
            for a, b in _bf_segments()]


def _bf_refine(e, cards):
    """What the ball has to say about a stretch the bodies found.

    Four separate statements, and none of them is allowed to invent a card:
    the bodies decide WHERE the points are, the ball only sharpens or
    withdraws one.
    """
    cr = np.asarray(e.cross, float)
    bt = np.asarray(e.bt_table, float)
    sv = sorted(float(x) for x in e.serves)
    out = []
    cards = sorted(cards, key=lambda c: c["t0"])
    for ci, c in enumerate(cards):
        t0, t1 = c["t0"], c["t1"]
        nxt_t0 = cards[ci + 1]["t0"] if ci + 1 < len(cards) else float(e.duration)
        # A RALLY CROSSES THE NET. A stretch where the ball never once went
        # over it is two people moving about, not a point.
        inside = [x for x in sv if t0 <= x <= t1]
        if BF_NOCROSS:
            _seen = len(cr[(cr >= t0) & (cr <= t1)])
            if BF_NOCROSS == "quiet":
                _seen += len(bt[(bt >= t0) & (bt <= t1)])
            # "serve": a stretch with no crossing is kept only if a serve was
            # detected inside it -- a serve fault is a point with no crossing;
            # players passing, whipping or fetching the ball are not (Adil's
            # Yu Yu Lin calls, 2026-09-08: five of eight wrong cards).
            if BF_NOCROSS == "serve":
                _seen += len(inside)
            if not _seen:
                continue
        # A RALLY NEVER HAS TWO SERVES IN IT. Two detected serves this far
        # apart inside one stretch means the decode glued two points.
        cuts = []
        if BF_SPLIT > 0 and len(inside) >= 2:
            last = inside[0]
            for x in inside[1:]:
                if x - last >= BF_SPLIT:
                    cuts.append(x)
                last = x
        parts, a = [], t0
        for x in cuts:
            b = max(a + V2.MIN_CARD_S, x - V2.HEAD_LEAD)
            if b >= t1:
                break
            parts.append((a, b))
            a = b + V2.MIN_GAP_S
        parts.append((a, t1))
        for a, b in parts:
            d = dict(c); d["t0"], d["t1"] = a, b
            if d["end_evidence_s"] is not None and not (a <= d["end_evidence_s"] <= b):
                d["end_evidence_s"] = None
            ins = [x for x in sv if a <= x <= b]
            if BF_SERVE and ins:
                # The card now knows which moment its point began at, which
                # is the only thing the server reading has to work from.
                d["serve_s"] = ins[0]
                d["why"] = "bodies, serve seen"
            if BF_END:
                ev = []
                if BF_END in ("cross", "both"):
                    x = cr[(cr >= a) & (cr <= b)]
                    if len(x): ev.append(float(x[-1]))
                if BF_END in ("bounce", "both"):
                    x = bt[(bt >= a) & (bt <= b)]
                    if len(x): ev.append(float(x[-1]))
                if ev:
                    last = max(ev)
                    floor = max(a + V2.MIN_CARD_S,
                                (d["serve_s"] or a) + V2.MIN_CARD_S)
                    d["t1"] = max(floor, min(d["t1"], last + BF_END_PAD))
                    d["end_evidence_s"] = last
            if BF_EXTEND:
                ev = []
                if BF_EXTEND in ("cross", "both"): ev += [float(x) for x in cr]
                if BF_EXTEND in ("bounce", "both"): ev += [float(x) for x in bt]
                ev.sort()
                end = d["t1"]
                # Never run into the next card or past the next serve: a
                # serve after this end IS the next point, whatever the ball
                # did in between.
                cap = nxt_t0 - V2.MIN_DEAD_S
                nxt_sv = [x for x in sv if x > end]
                if nxt_sv:
                    cap = min(cap, nxt_sv[0] - V2.MIN_DEAD_S)
                import bisect as _bs
                j = _bs.bisect_right(ev, end)
                if j > 0 and end - ev[j - 1] <= BF_EXTEND_GAP:
                    t = ev[j - 1]
                    while (j < len(ev) and ev[j] - t <= BF_EXTEND_GAP
                           and ev[j] + BF_END_PAD <= cap):
                        if BF_EXTEND_PMIN > 0 and _bf_pmin(t, ev[j]) < BF_EXTEND_PMIN:
                            break
                        t = ev[j]; j += 1
                    new_end = min(t + BF_END_PAD, cap)
                    if new_end > d["t1"] + 0.05:
                        d["t1"] = new_end
                        d["end_evidence_s"] = t
                        d["why"] = d["why"] + ", end kept open by the ball"
            V2.clamp_evidence(d)
            if d["t1"] - d["t0"] >= V2.MIN_CARD_S:
                out.append(d)
    return out


def assemble():
    e = make_e()
    if BODYFIRST in ("1", "confirm"):
        cs = _bf_cards(e)
        if BODYFIRST == "confirm":
            cs = _bf_refine(e, cs)
        return e, V2.resolve(cs)
    cards = V2.resolve(blindblock.serve_points(e, BLIND_BLOCK))
    if RESCUE_S > 0 and SV_RESCUE:
        # The stretches no card covers, and how long each one is.
        _gaps, _prev = [], 0.0
        for _c in sorted(cards, key=lambda c: c["t0"]):
            if _c["t0"] - _prev >= RESCUE_S:
                _gaps.append((_prev, _c["t0"]))
            _prev = max(_prev, _c["t1"])
        if e.duration - _prev >= RESCUE_S:
            _gaps.append((_prev, e.duration))
        if not RESCUE_HEAD and _gaps and _gaps[0][0] <= 0.0:
            _gaps = _gaps[1:]
        _add, _last = [], -99.0
        for _t, _b_, _side in sorted(SV_RESCUE):
            if not any(g0 + RESCUE_CLEAR <= _t <= g1 - RESCUE_CLEAR for g0, g1 in _gaps):
                continue
            if _t - _last < V2.MIN_GAP_S:
                continue
            if RESCUE_CROSS_N > 0 and sum(
                    1 for _x in e.cross if _t < float(_x) <= _t + RESCUE_CROSS_WIN) < RESCUE_CROSS_N:
                continue
            _end, _ev = V2.rally_end_ev(e, _t)
            _end = min(_end, _t + V2.MAX_RALLY_S)
            _add.append(V2.clamp_evidence({"t0": max(0.0, _t - V2.HEAD_LEAD),
                                           "t1": min(e.duration, _end),
                                           "serve_s": _t, "why": "serve (second look)",
                                           "end_evidence_s": _ev}))
            e.server_by_contact.setdefault(round(_t, 2), _side)
            _last = _t
        if _add:
            cards = V2.resolve(cards + _add)
    if POSE_FALLBACK:
        _pp = np.load(POSE_PLAY_FILE); _T, _p = _pp["T"], _pp["p"]
        _on = _p > 0.5; _segs = []; _i = 0
        while _i < len(_on):
            if _on[_i]:
                _j = _i
                while _j + 1 < len(_on) and _on[_j + 1]: _j += 1
                if (_T[_j] - _T[_i] >= POSE_FB_MIN_S
                        and float(_p[_i:_j + 1].mean()) >= POSE_FB_MINP):
                    _segs.append((float(_T[_i]), float(_T[_j])))
                _i = _j + 1
            else: _i += 1
        _fb = []
        for _a, _b in _segs:
            if FB_ABSORB_S > 0:
                # ONE SERVE BESIDE IT: THE BODIES ARE THAT POINT'S OWN.
                _touch = [c for c in cards
                          if c["t0"] - FB_ABSORB_S <= _b and c["t1"] + FB_ABSORB_S >= _a]
                if len(_touch) == 1:
                    _c = _touch[0]
                    _t0 = min(_c["t0"], max(0.0, _a - 0.5))
                    _t1 = max(_c["t1"], min(e.duration, _b + 1.0))
                    if _t1 - _t0 <= MERGE["maxlen"]:
                        _c["t0"], _c["t1"] = _t0, _t1
                        V2.clamp_evidence(_c)
                        continue
            # trim to what no serve card claims, with a gap either side
            _free = [(_a, _b)]
            for c in cards:
                _free = [seg for x0, x1 in _free for seg in ((x0, min(x1, c["t0"] - POSE_FB_GAP_S)), (max(x0, c["t1"] + POSE_FB_GAP_S), x1)) if seg[1] - seg[0] >= POSE_FB_MIN_S]
            for x0, x1 in _free:
                _fb.append(dict(t0=max(0.0, x0 - 0.5), t1=min(e.duration, x1 + 1.0), serve_s=None, why="bodies say play", end_evidence_s=None))
        cards = V2.resolve(cards + _fb)
    if FALLBACK:
        fb = V2.fallback_points(e, cards)
        if FALLBACK_GAP > 0:
            fb = [c for c in fb if all(c["t0"] >= s_["t1"] + FALLBACK_GAP or c["t1"] <= s_["t0"] - FALLBACK_GAP for s_ in cards)]
        if FALLBACK_VETO:
            _shape = e.shape; e.shape = 1.0          # ask the veto everywhere, end-on included
            fb, _cut = V2.veto(e, fb); e.shape = _shape
        if FALLBACK_RATE > 0:
            def _local_rate(c):
                lo, hi = max(0.0, c["t0"] - 60.0), min(e.duration, c["t1"] + 60.0)
                n = sum(1 for s_ in cards if lo <= s_["t0"] <= hi)
                return n / max((hi - lo) / 60.0, 1e-6)
            fb = [c for c in fb if _local_rate(c) < FALLBACK_RATE]
        cards = V2.resolve(cards + fb)
    _before = {id(c) for c in cards}
    cards = V2.split_long(e, cards)
    for c in cards:
        if id(c) not in _before:
            # split_long returns a NEW dict for each half it makes and the
            # very same object for a card it left alone, so identity is what
            # says which is which. A split half ends at the split, not at a
            # rally end; _regrow must leave it where it is.
            c["no_regrow"] = True
    cards = V2.resolve(cards)
    cards = _not_passed(e, _not_rolling(e, _on_own_table(e, cards)))
    if WARMUP:
        import warmup as _WU
        global WARMUP_END
        WARMUP_END = _WU.knockup_end(e.cross, duration=e.duration, **WARMUP_KW)
        if WARMUP_END is not None:
            cards = [c for c in cards
                     if c["t1"] >= WARMUP_END + WARMUP_GRACE
                     and not (WARMUP_STARTED and c["t0"] < WARMUP_END)]
    if not cards:
        return e, []
    cards = sorted(cards, key=lambda c: c["t0"])
    out = [dict(cards[0])]
    for c in cards[1:]:
        prev = out[-1]; gap = max(c["t0"] - prev["t1"], 0.01)
        nb = int(((e.bt_table >= prev["t1"] - 0.05) & (e.bt_table <= c["t0"] + 0.05)).sum())
        # The ball dying between two cards means the point ended there,
        # however dense the bounces look — a pass-back IS dense.
        #
        # Measured from the EVIDENCE end, never from t1. t1 is padded by
        # TAIL_AFTER_BOUNCE so a winner tap lands inside, and that padding
        # is 2.6s long — wide enough to put the dead ball BEHIND the window
        # this test looks in. On card 3 the rally died at 41.03 and the
        # card ends at 43.63, so the veto missed a dead run sitting exactly
        # where the rally stopped and glued two points into one card.
        ref = prev.get("end_evidence_s")
        if ref is None:
            ref = prev["t1"]
        died = any(ref - 0.4 <= a <= c["t0"] + 0.4 for a, _b in VETO_DEAD)
        # A fallback card has no serve of its own (serve_s None); only a card
        # opened by a serve can claim the paired-serve exemption.
        if MERGE_SKIP_PAIRED and c.get("serve_s") is not None and any(
                abs(c["serve_s"] + V2.CONTACT_LOOKBACK_S - pt) < 0.03 for pt in PAIRED_T):
            # TWO BOUNCES ON OPPOSITE HALVES IS A SERVE, not a fragment of the
            # rally before it. 77fc4dee's point 4 (0:45.5, paired, 171 cm of
            # travel) passed every gate and was glued to the previous card here.
            out.append(dict(c)); continue
        if (not died and gap <= MERGE["gap_max"] and nb / gap >= MERGE["dens_min"]
                and c["t1"] - prev["t0"] <= MERGE["maxlen"]):
            prev["t1"] = c["t1"]
        else:
            out.append(dict(c))
    # ...read on the finished cards, because the gap either side of a card
    # is what says whether the players had a pause in which to play it.
    out = _not_wedged(e, out)
    if REGROW:
        out = _regrow(e, out)
    if BODYFIRST == "union":
        # ONLY WHERE NOTHING REACHES. A body stretch that touches a ball card
        # is that card's own point seen a second way, not a second point.
        _add = [c for c in _bf_refine(e, _bf_cards(e))
                if not any(o["t0"] < c["t1"] and o["t1"] > c["t0"] for o in out)]
        if BF_AFTER_FIRST and out:
            _first = min(o["t0"] for o in out)
            _add = [c for c in _add if c["t1"] > _first]
        if _add:
            out = V2.resolve(out + _add)
    return e, out


def stats(cs):
    g = defaultdict(list); junk = 0
    for c in cs:
        hit = None
        for i, p in SCORED.items():
            if c["t0"] < float(p["t1"]) and c["t1"] > float(p["t0"]):
                hit = i; break
        if hit is None: junk += 1
        else: g[hit].append(c)
    return dict(cards=len(cs), points=len(g),
                dupes=sum(len(v) - 1 for v in g.values()), junk=junk)


if __name__ == "__main__":
    deadsplit.uninstall()
    _, base = assemble(); s = stats(base)
    print(f"{'rise':>5s} {'run':>4s} {'serve must follow':>18s} "
          f"{'cards':>6s} {'points':>7s} {'dupes':>6s} {'junk':>5s}")
    print("-" * 62)
    print(f"{'--':>5s} {'--':>4s} {'--':>18s} {s['cards']:6d} {s['points']:7d} "
          f"{s['dupes']:6d} {s['junk']:5d}   no dead-ball rule")
    rows = []
    for rise in (25, 40, 60):
        for rl in (2, 3, 4):
            for fol in (2.5, 4.0, 6.0, None):
                deadsplit.DEAD = deadsplit.dead_runs(H, track, rise, rl)
                deadsplit.install([c for c, _, _ in SV], serve_follow=fol)
                _, cs = assemble(); st = stats(cs)
                deadsplit.uninstall()
                lbl = f"within {fol}s" if fol else "not required"
                print(f"{rise:5d} {rl:4d} {lbl:>18s} {st['cards']:6d} {st['points']:7d} "
                      f"{st['dupes']:6d} {st['junk']:5d}")
                rows.append((st['points'] - st['dupes'] - st['junk'], rise, rl, fol, st))
    rows.sort(reverse=True, key=lambda r: r[0])
    sc, rise, rl, fol, st = rows[0]
    print(f"\nbest: rise<{rise}px x{rl}, serve follow {fol} -> {st}")
