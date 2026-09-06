"""One page carrying the whole audio study, and 100 real points to check it.

  ./venv/bin/python build_page.py <recent-dir> <study-dir> <out.html>

The argument of this study is made of numbers Adil cannot see. This page
puts the raw readings next to the audio they came from: for every point,
the onset curve the detector actually computed, every peak it picked, the
visual events production stored, Adil's own serve and winner taps where
they exist, and a playable snippet of the sound itself.

Points come from the ten most recent uploads across six different users,
which is deliberately NOT the seven-match study corpus: the study measured
matches Adil vouches for, and this asks whether the same behaviour shows
up on whatever people uploaded this week.
"""
import base64
import html
import json
import os
import subprocess
import sys

import numpy as np
import psycopg2
import psycopg2.extras

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audio_impacts as AUDIO

PAD_S = 0.6          # shown either side of the point
SNIPPET_MAX_S = 6.0  # embedded audio, capped so the page stays openable
STRIP_W, STRIP_H = 940, 74


def keychain(service):
    return subprocess.check_output(
        ["security", "find-generic-password", "-a", "openclaw",
         "-s", service, "-w"]).decode().strip()


def connect():
    conn = psycopg2.connect(os.environ.get("DATABASE_URL")
                            or keychain("ponglens-db-url"))
    conn.set_session(readonly=True)
    return conn


def fetch_points(conn, match_id):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            select p.id, p.idx, p.t0, p.t1, p.placement, p.confirmed_winner,
                   p.is_let, p.starred,
                   b.start_source_s, b.end_source_s
            from public.points p
            left join public.point_boundaries b on b.point_id = p.id
            where p.match_id = %s and not p.deleted
            order by p.idx""", (match_id,))
        return [dict(r) for r in cur.fetchall()]


def snippet(wav, start, end, dest):
    """A listenable cut of the point. 48 kbps mono AAC keeps the click."""
    if os.path.exists(dest):
        return dest
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{start:.3f}",
                    "-t", f"{end - start:.3f}", "-i", wav, "-ac", "1",
                    "-c:a", "aac", "-b:a", "32k", dest], check=True)
    return dest


def strip_svg(times, z, impacts_hi, impacts_lo, visual, taps, t0, t1):
    """The onset curve with every mark on it, as one inline SVG."""
    if len(times) < 2:
        return "<div class='nostrip'>no audio in range</div>"
    lo, hi = times[0], times[-1]
    span = max(1e-6, hi - lo)

    def x(t):
        return (t - lo) / span * STRIP_W

    top, bottom = 6, STRIP_H - 16
    ceiling = max(8.0, float(np.percentile(z, 99.5)) if len(z) else 8.0)

    def y(value):
        return bottom - min(1.0, max(0.0, value / ceiling)) * (bottom - top)

    step = max(1, len(times) // STRIP_W)
    pts = " ".join(f"{x(times[i]):.1f},{y(z[i]):.1f}"
                   for i in range(0, len(times), step))
    parts = [f"<svg class='strip' viewBox='0 0 {STRIP_W} {STRIP_H}' "
             f"preserveAspectRatio='none'>"]
    parts.append(f"<rect x='{x(t0):.1f}' y='0' width='{max(1, x(t1) - x(t0)):.1f}'"
                 f" height='{STRIP_H}' class='window'/>")
    for a, b in taps:
        parts.append(f"<rect x='{x(a):.1f}' y='0' "
                     f"width='{max(1, x(b) - x(a)):.1f}' height='{STRIP_H}' "
                     f"class='taps'/>")
    parts.append(f"<polyline points='{pts}' class='curve'/>")
    for t, c in impacts_lo:
        parts.append(f"<line x1='{x(t):.1f}' y1='{bottom}' x2='{x(t):.1f}' "
                     f"y2='{bottom + 5}' class='mlo'><title>1.5-8 kHz peak "
                     f"z={c:.1f} at {t:.3f}s</title></line>")
    for t, c in impacts_hi:
        parts.append(f"<line x1='{x(t):.1f}' y1='{top}' x2='{x(t):.1f}' "
                     f"y2='{bottom}' class='mhi'><title>10 kHz+ peak "
                     f"z={c:.1f} at {t:.3f}s</title></line>")
    for t, kind, ok in visual:
        cls = {"bounce": "vb", "contact": "vc"}.get(kind, "vo")
        if not ok:
            cls += " offtable"
        parts.append(f"<circle cx='{x(t):.1f}' cy='{top + 4}' r='4' "
                     f"class='{cls}'><title>{kind}"
                     f"{'' if ok else ' (projects off the table)'} at "
                     f"{t:.3f}s</title></circle>")
    parts.append("</svg>")
    return "".join(parts)


def build():
    recent_dir, study_dir, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    manifest = json.load(open(os.path.join(recent_dir, "manifest.json")))
    per_match = max(1, round(100 / len(manifest)))
    tmp = os.path.join(recent_dir, "_snippets")
    os.makedirs(tmp, exist_ok=True)
    conn = connect()

    cards, stats = [], {"points": 0, "hi": 0, "lo": 0, "visual": 0, "taps": 0}
    for entry in manifest:
        slug = entry["slug"]
        wav = os.path.join(recent_dir, slug, "audio.wav")
        if not os.path.exists(wav):
            continue
        print(f"  {slug}: reading audio…", flush=True)
        samples, rate = AUDIO.read_wav(wav)
        magnitude, freqs = AUDIO.spectrogram(samples, rate)
        z_hi = AUDIO.local_z(AUDIO.flux(magnitude, freqs, AUDIO.HIGH_BAND), rate)
        z_lo = AUDIO.local_z(AUDIO.flux(magnitude, freqs, AUDIO.BALL_BAND), rate)
        frame_times = np.array([AUDIO.frame_time(i, rate) for i in range(len(z_hi))])
        peaks_hi = [(AUDIO.frame_time(i, rate), float(z_hi[i]))
                    for i in AUDIO.pick_peaks(z_hi, rate, 6.0)]
        peaks_lo = [(AUDIO.frame_time(i, rate), float(z_lo[i]))
                    for i in AUDIO.pick_peaks(z_lo, rate, 3.0)]

        points = fetch_points(conn, entry["id"])
        if not points:
            continue
        chosen = [points[i] for i in
                  np.linspace(0, len(points) - 1, min(per_match, len(points)),
                              dtype=int)]
        for point in chosen:
            t0, t1 = float(point["t0"]), float(point["t1"])
            lo_t, hi_t = max(0.0, t0 - PAD_S), t1 + PAD_S
            mask = (frame_times >= lo_t) & (frame_times <= hi_t)
            in_hi = [(t, c) for t, c in peaks_hi if lo_t <= t <= hi_t]
            in_lo = [(t, c) for t, c in peaks_lo if lo_t <= t <= hi_t]
            placement = point["placement"] or {}
            visual = []
            for cand in placement.get("candidates") or []:
                t = float(cand["t"])
                if lo_t <= t <= hi_t:
                    visual.append((t, cand.get("kind"),
                                   cand.get("u") is not None))
            taps = []
            if point["start_source_s"] is not None:
                taps.append((float(point["start_source_s"]),
                             float(point["end_source_s"])))
            end = min(hi_t, lo_t + SNIPPET_MAX_S)
            path = snippet(wav, lo_t, end,
                           os.path.join(tmp, f"{slug}_{point['idx']}.m4a"))
            audio_b64 = base64.b64encode(open(path, "rb").read()).decode()
            stats["points"] += 1
            stats["hi"] += len(in_hi)
            stats["lo"] += len(in_lo)
            stats["visual"] += len(visual)
            stats["taps"] += len(taps)
            cards.append({
                "slug": slug, "user": str(entry["user_id"])[:8],
                "opponent": entry["opponent_name"] or "—",
                "venue": entry["venue"] or "—", "date": entry["created"],
                "channels": entry["audio"].get("channels"),
                "idx": point["idx"], "t0": t0, "t1": t1,
                "winner": point["confirmed_winner"], "let": point["is_let"],
                "svg": strip_svg(frame_times[mask], z_hi[mask], in_hi, in_lo,
                                 visual, taps, t0, t1),
                "n_hi": len(in_hi), "n_lo": len(in_lo),
                "n_visual": len(visual),
                "n_offtable": sum(1 for _, _, ok in visual if not ok),
                "taps": taps, "audio": audio_b64,
                "rate_hi": len(in_hi) / max(0.1, t1 - t0),
            })
    json.dump({"cards": cards, "stats": stats},
              open(os.path.join(recent_dir, "cards.json"), "w"))
    print(f"{stats['points']} points, {stats['hi']} 10 kHz peaks, "
          f"{stats['lo']} 1.5-8 kHz peaks, {stats['visual']} visual events")
    return cards, stats, manifest


if __name__ == "__main__":
    build()
