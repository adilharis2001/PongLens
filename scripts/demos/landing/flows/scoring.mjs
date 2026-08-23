/**
 * Take the score off the match for the first half of the take, and put it
 * back before anything reads it.
 *
 * The scoring beat used to open the pad on a match that was already fully
 * scored: 8-9 on the board, a rail of chips already filled in, a "Game
 * ended" banner, and a paused frame — under the line "score the whole match
 * in about ten minutes, just by saying who won each point". The taps were
 * re-affirming answers that were already there.
 *
 * Unscoring for the whole take is not an option. Alex's score feeds the
 * analysis cards, the stats page, the point sheet's header, the score bug
 * burned into the picture, and the "1-1" on the fixed match strip. Half the
 * video is downstream of it.
 *
 * But there is a window. The last frame that needs the score before the
 * beat is the rally at 17s; the first one after it is the analysis page,
 * which re-loads at about 30s. So the score comes off while the upload
 * screen is up, and goes back on between the last tap and that navigation.
 * Everything in between — the point list, the player, the pad — is honestly
 * a match nobody has scored yet, which is also the order the story happens
 * in: bring it in, watch it, score it, then read it.
 *
 * Safety: this only ever writes `confirmed_winner`, guard.mjs has already
 * snapshotted every point to DISK before recording starts, and a restore
 * that does not come back with the same count throws rather than letting a
 * take run on to a render nobody will look at closely enough.
 */

const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";

const rest = async (key, url, init = {}) => {
  const res = await fetch(`${SUPABASE}/rest/v1/${url}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

/** Who won what, grouped by answer so putting it back is two writes. */
export async function takeWinners(key, matchId) {
  const rows = await rest(
    key,
    `points?match_id=eq.${matchId}&confirmed_winner=not.is.null&select=id,confirmed_winner`
  );
  const byValue = {};
  for (const r of rows) (byValue[r.confirmed_winner] ??= []).push(r.id);
  return { matchId, byValue, count: rows.length };
}

/**
 * Where to be on the cut timeline to answer each of the first `n` points.
 *
 * Not the start of the clip, near the END of it. Answering a rally with more
 * than TAIL_WATCH_S (3.5s) of its own footage still to run is treated as
 * answering early: the player finishes the clip before it advances, and
 * offers "two points in there?" on the way. So four taps on a fixed 1.1s
 * cadence all landed on the SAME point, toggling it Me, Alex, Me, Alex —
 * which was invisible for as long as the match arrived already scored, and
 * was the entire beat the moment it did not.
 *
 * A second before the end is where a person answering in real time would be
 * anyway, and from there the tap jumps straight to the next rally.
 */
export async function pointCuts(key, matchId, n) {
  const rows = await rest(
    key,
    `points?match_id=eq.${matchId}&deleted=is.false&select=id,idx,cut_t0,t0,t1&order=idx&limit=${n}`
  );
  return rows
    .filter((r) => r.cut_t0 !== null && r.t0 !== null && r.t1 !== null)
    .map((r) => ({
      id: r.id,
      at: Number(r.cut_t0) + (Number(r.t1) - Number(r.t0)) - 1.0,
    }));
}

export async function clearWinners(key, matchId) {
  await rest(
    key,
    `points?match_id=eq.${matchId}&confirmed_winner=not.is.null`,
    {
      method: "PATCH",
      body: JSON.stringify({ confirmed_winner: null }),
      headers: { Prefer: "return=minimal" },
    }
  );
}

export async function restoreWinners(key, taken) {
  for (const [value, ids] of Object.entries(taken.byValue)) {
    await rest(key, `points?id=in.(${ids.join(",")})`, {
      method: "PATCH",
      body: JSON.stringify({ confirmed_winner: value }),
      headers: { Prefer: "return=minimal" },
    });
  }
  // Count it back. A restore that half-lands is the kind of thing that only
  // shows up as an empty analysis card an hour later, in a render.
  //
  // Counted over THE IDS THIS RESTORE TOUCHED, not over every scored point
  // in the match. It used to be the match-wide total, which is a number a
  // second restorer can move: flows/desktop.mjs also declares `guard`, and
  // guard.mjs snapshots the same point rows and puts back anything the take
  // changed. When it restored a row this snapshot did not hold, the total
  // came back one high and a take that had gone perfectly aborted at the
  // very end. Verifying its own work is both immune to that and the
  // stricter question — a global tally can be right while these particular
  // rows are wrong.
  const ids = Object.values(taken.byValue).flat();
  const back = ids.length
    ? await rest(
        key,
        `points?id=in.(${ids.join(",")})&confirmed_winner=not.is.null&select=id`
      )
    : [];
  if (back.length !== ids.length) {
    throw new Error(
      `score restore came back ${back.length} of ${ids.length} — stopping before this take goes any further`
    );
  }
  return back.length;
}
