"""The serve rule's settings, frozen.

Every value here was measured, and the record for each is in the lab's own
files and in `docs/research/2026-09-06-endon-routing.md`,
[[v3-side-on-generalisation]] and [[v3-corpus-round]]. They are data, not
knobs: the lab reaches them through environment variables so an experiment
can move one and score it, and the worker must not, because a setting that
can drift between two matches is a setting nobody can reason about later.

Anything changed here changes what a card's start means, so it changes the
parity fixture too, and the test in `worker/tests/` will say so.
"""

# serve_v3.rule.serves(**GATES). `player_at` is filled in per run.
GATES = dict(
    need_bounce=True, need_arrival=True, no_rally=True,
    need_person=True, person_pad=0.60, min_travel=0.30,
    person_bounce_fallback=True,
    person_jump_w=16.3,           # 25 m/s; was 120 px/frame
    person_frac=0.5,
    person_near_w=0.6,
    person_hole_s=0.10,           # was 3 frames
    fallback_near_only=True, fallback_pair_win=0.6,
    table_run_s=0.13,             # 4 frames at 30fps
    table_run_w=0.55,             # ~121px on the first camera; was 120
    table_run_hole_s=0.10,        # 3 frames at 30fps
    table_run_jump_w=16.3,
    net_margin_m=0.18,
    unpaired_stay_pct=23, unpaired_fast_pct=89, calib_min=30,
    unpaired_stay_s=1.3,          # the fallbacks
    bounce_pad_w=0.03, bounce_pad_ends_only=True,
    unpaired_fast_w=4.0,
    net_margin_paired_only=True,
    hands_box_per_frame=True,     # boxes read at each run-up frame's own moment
    hands_drop_still_s=0.1,       # a "ball" that does not move is a parked decoy
    hands_parked_px=8.0,          # ...and so is a twitch beside it
    hands_empty_abstain=True,     # no frame could be the ball: abstain...
    hands_abstain_rally=(1, 3.0),  # ...if at least one net crossing follows
    bounce_within=0.6,            # a long serve whose own bounce is unseen
    unpaired_rally=(2, 3.0),      # an unpaired bounce that starts a rally is not a pass
    cluster_prefer_paired=True,   # one serve seen twice: both bounces outranks first
    net_partner_clear_m=0.4,      # a near-net first bounce whose partner lands 40cm past it
    held_slow_w=2.0, held_min_s=0.1, held_trumps_rally=True, held_rally=(1, 2.5),
)

# The pass-and-hold filter (handover.tag): the ball is passed across and then
# sits in the other player's box, so the "serve" that was detected was the pass.
HANDOVER = dict(min_run_s=8 / 30.0, rest_gap=2.0, look=8.0, max_before=3)

# handover.prefer_paired: inside this window a detection showing both of a
# serve's bounces outranks one showing a single bounce.
PAIR_WIN_S = 6.0

# A RALLY OUTRANKS THE FILTER. A detection followed by at least this many net
# crossings inside this window is a serve whatever the pass rule thought, and
# it is applied to the pass filter's verdicts before the paired preference is
# computed on the survivors (the lab's V3_RALLY_OVERRIDE=AT:3:3.0 with
# V3_SEQ=2; the away veto it also covers is off and is not ported).
RALLY_OVERRIDE = (3, 3.0)

# The bounce finder's hole tolerance, as a duration. Production refuses a
# five-detection window when any step spans more than three frames, which is
# 0.100 s at 30 fps; the serve rule was measured with five frames, 0.167 s,
# because a ball descending into its bounce loses frames and a textbook
# bounce was being thrown away for it (holepatch).
BOUNCE_HOLE_S = 0.167

# deadsplit.dead_runs: consecutive table bounces the ball never rises between,
# which is the point ending. apex_w is in table widths (25px on a 220.8px
# table), run is a count of bounces.
DEAD_BALL = dict(apex_w=25 / 220.81102434502495, run=3)
