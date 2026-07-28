#!/usr/bin/env python3
"""Seed rich, realistic v3 placement data on the demo Alex match.

    cd worker && venv/bin/python ../scripts/demos/seed_placement.py

Demo staging only. The real vision output on the staged match maps too few
points to make the ball maps look like the product at its best, so this
replaces each point's placement HYPOTHESES with generated ones that are
coherent with the scored facts: serve rotation decides the server, the
seeded rally length follows the vision's n_hits, and the final shot matches
confirmed_how (winner landing, net, out). Candidates are left untouched.

Backs up every point's original placement JSON to
scripts/demos/raw/placement-backup-<match>.json before writing. Restore:

    cd worker && venv/bin/python ../scripts/demos/seed_placement.py --restore
"""

import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "worker"))
import worker  # noqa: E402

MATCH = "aa42d3b9-2109-4e02-a638-10297d0606e8"
BACKUP = Path(__file__).resolve().parent / "raw" / f"placement-backup-{MATCH[:8]}.json"

W, L, NET = 1.525, 2.74, 1.37

# how the loser lost, when confirmed_how names an error
ERROR_KIND = {
    "missed_long": "out",
    "missed_wide": "out",
    "hit_into_net": "net",
}


def half_v(side, depth):
    """v coordinate at `depth` (0 net .. 1 end line) into a physical half."""
    return NET - depth * (NET - 0.16) if side == "near" else NET + depth * (L - 0.16 - NET)


def serve_target(rng, who):
    """(u, depth) for a serve landing, styled per player."""
    if who == "user":
        # mixes short-wide forehand with long backhand-corner serves
        r = rng.random()
        if r < 0.45:
            return rng.uniform(1.08, 1.38), rng.uniform(0.12, 0.34)
        if r < 0.8:
            return rng.uniform(0.16, 0.44), rng.uniform(0.72, 0.94)
        return rng.uniform(0.6, 0.9), rng.uniform(0.5, 0.75)
    # opponent: mostly long into the middle/backhand
    r = rng.random()
    if r < 0.6:
        return rng.uniform(0.5, 0.95), rng.uniform(0.7, 0.95)
    if r < 0.85:
        return rng.uniform(0.2, 0.5), rng.uniform(0.6, 0.9)
    return rng.uniform(1.0, 1.3), rng.uniform(0.15, 0.4)


def rally_target(rng, final=False, edge=False):
    if edge:
        return rng.uniform(0.3, 1.2), rng.uniform(0.96, 1.0)
    if final:
        # winners go to the corners / wide
        u = rng.choice([rng.uniform(0.1, 0.32), rng.uniform(1.2, 1.42)])
        return u, rng.uniform(0.55, 0.95)
    return rng.uniform(0.25, 1.28), rng.uniform(0.45, 0.92)


def event(u, v, conf, rng):
    return {
        "event_id": None,
        "u": round(u, 3),
        "v": round(v, 3),
        "confidence": round(conf + rng.uniform(-0.06, 0.04), 2),
        "inferred": False,
    }


def gen_shots(rng, server_side, server_who, winner_who, how, n_hits, pid):
    """Coherent shot list in physical coords for one hypothesis."""
    other_side = "far" if server_side == "near" else "near"
    side_of = {server_who: server_side,
               ("user" if server_who == "opponent" else "opponent"): other_side}
    loser_who = "user" if winner_who == "opponent" else "opponent"

    # ending: (final hitter, terminal kind or None-for-landing)
    if how == "service_ace" and (n_hits or 1) <= 1:
        ending = None                      # serve alone ends it
    elif how in ERROR_KIND:
        ending = (loser_who, ERROR_KIND[how])
    elif how == "receive_error":
        ending = (loser_who, rng.choice(["net", "out"]))
    elif how in ("clean_winner", "edge_ball", "service_ace"):
        ending = (winner_who, None)
    else:  # unspecified: winner's ball lands 70%, loser error 30%
        ending = (winner_who, None) if rng.random() < 0.7 \
            else (loser_who, rng.choice(["net", "out"]))

    n = max(1, min(n_hits or rng.randint(2, 5), 7))
    if ending:
        hitter_of = lambda k: server_who if k % 2 == 1 else \
            ("user" if server_who == "opponent" else "opponent")
        if n < 2:
            n = 2
        if hitter_of(n) != ending[0]:
            n += 1

    shots = []
    for k in range(1, n + 1):
        who = server_who if k % 2 == 1 else \
            ("user" if server_who == "opponent" else "opponent")
        side = side_of[who]
        target_half = "far" if side == "near" else "near"
        last = k == n
        phase = "serve" if k == 1 else ("final" if last else "rally")
        landing = None
        terminal = None
        if last and ending and ending[1]:
            terminal = {"event_id": None, "kind": ending[1],
                        "confidence": round(rng.uniform(0.72, 0.9), 2),
                        "direction": None}
        elif k == 1:
            u, depth = serve_target(rng, who)
            landing = event(u, half_v(target_half, depth), 0.88, rng)
        else:
            u, depth = rally_target(rng, final=last, edge=(how == "edge_ball" and last))
            landing = event(u, half_v(target_half, depth), 0.82, rng)
        shots.append({
            "id": f"{pid[:8]}-s{k}",
            "seq": k,
            "phase": phase,
            "hitter_side": side,
            "contact_t": None,
            "contact": None,
            "serve_first_bounce": None,
            "landing": landing,
            "terminal": terminal,
            "confidence": round(rng.uniform(0.74, 0.94), 2),
        })
    return shots


def hypothesis(rng, server_side, server_who, winner, how, n_hits, pid, true_side):
    conf = rng.uniform(0.86, 0.95) if true_side else rng.uniform(0.5, 0.6)
    return {
        "serverSide": server_side,
        "server_side": server_side,
        "status": "ready",
        "confidence": round(conf, 2),
        "score": round(conf * rng.uniform(0.9, 1.0), 2),
        "reasons": [],
        "hard_reasons": [],
        "shots": gen_shots(rng, server_side, server_who, winner, how, n_hits, pid),
        "used_event_ids": [],
    }


def main():
    conn = worker.connect()
    conn.autocommit = True
    cur = conn.cursor()

    if "--restore" in sys.argv:
        saved = json.loads(BACKUP.read_text())
        for pid, placement in saved.items():
            cur.execute("update points set placement=%s::jsonb where id=%s",
                        (json.dumps(placement), pid))
        print(f"restored {len(saved)} points from {BACKUP.name}")
        return

    cur.execute(
        """select id, idx, is_let, confirmed_winner, confirmed_how,
                  coalesce((suggestion->>'n_hits')::int, 0), placement
           from points where match_id=%s and not deleted order by idx""",
        (MATCH,))
    rows = cur.fetchall()

    BACKUP.parent.mkdir(exist_ok=True)
    if not BACKUP.exists():  # never clobber the original backup on re-runs
        BACKUP.write_text(json.dumps({r[0]: r[6] for r in rows}))
        print(f"backed up {len(rows)} placements -> {BACKUP.name}")

    # walk games for rotation: 11 with 2 clear, first server alternates,
    # 2-serve blocks (every point from 10-10). user_side='near', ends swap.
    game, s_user, s_opp = 0, 0, 0
    for pid, idx, is_let, winner, how, n_hits, _old in rows:
        pre_sum = s_user + s_opp
        first = "user" if game % 2 == 0 else "opponent"
        block = pre_sum - 10 if min(s_user, s_opp) >= 10 else pre_sum // 2
        server_who = first if block % 2 == 0 else \
            ("user" if first == "opponent" else "opponent")
        user_phys = "near" if game % 2 == 0 else "far"
        server_phys = user_phys if server_who == "user" else \
            ("far" if user_phys == "near" else "near")

        rng = random.Random(f"{MATCH}:{idx}")
        true_h = hypothesis(rng, server_phys, server_who, winner, how,
                            n_hits, pid, True)
        # counterfactual side: never selected once rotation is known, but
        # kept coherent (as if the other side had served)
        alt_who = "user" if server_who == "opponent" else "opponent"
        alt_phys = "far" if server_phys == "near" else "near"
        alt_h = hypothesis(rng, alt_phys, alt_who, winner, how,
                           n_hits, pid, False)
        hyps = {server_phys: true_h, alt_phys: alt_h}

        cur.execute(
            """update points set placement =
                 jsonb_set(jsonb_set(placement, '{hypotheses}', %s::jsonb),
                           '{status}', '"ready"')
               where id=%s""",
            (json.dumps(hyps), pid))

        if not is_let and winner:
            if winner == "user":
                s_user += 1
            else:
                s_opp += 1
            if max(s_user, s_opp) >= 11 and abs(s_user - s_opp) >= 2:
                game, s_user, s_opp = game + 1, 0, 0

    print(f"seeded {len(rows)} points on match {MATCH[:8]}")


if __name__ == "__main__":
    main()
