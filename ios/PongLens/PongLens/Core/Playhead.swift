import Foundation

// Port of src/app/match/[id]/clipEdit.ts + playhead.ts.
//
// ANCHORING FACT: points.cut_t0 is the PADDED clip start inside the cut
// video — source t0 minus the point's EFFECTIVE pre pad — not the serve.
// In cut-video seconds a rally spans:
//
//   cut_t0 ──pre──> serve ──(t1 - t0)──> rally end ──post──> clip end
//
// Every constant here was tuned against real scoring sessions. Do not
// change them (see ios/docs/behavioral-spec.md).

struct ClipPad: Codable, Hashable {
    var pre: Double
    var post: Double
}

/// FROZEN fallback pads for pre-048 matches. Never track the worker's
/// current values; matches.clip_pads is the stored truth when present.
let CLIP_PAD: [String: ClipPad] = [
    "tight": ClipPad(pre: 0.5, post: 1.0),
    "normal": ClipPad(pre: 1.0, post: 1.6),
    "loose": ClipPad(pre: 1.6, post: 2.4),
]

/// Context kept at a split boundary. MUST match worker TIGHT_PAD.
let TIGHT_PAD = 0.3

/// A split at_t must sit this far inside the point on both edges.
let SPLIT_EDGE_S = 0.3

/// How far before an early answer a suggested split lands when there is no
/// gap evidence — the tap always comes after the deciding shot.
let SPLIT_LEAD_S = 0.6

func clipPad(strictness: String?, stored: ClipPad?) -> ClipPad {
    if let stored { return stored }
    return CLIP_PAD[strictness ?? "normal"] ?? CLIP_PAD["normal"]!
}

/// Full strictness pads on outer edges, min(pad, TIGHT_PAD) on split-born
/// edges — the pads a point's clip is ACTUALLY cut with.
func effectivePad(_ pad: ClipPad, tightStart: Bool, tightEnd: Bool) -> ClipPad {
    ClipPad(
        pre: tightStart ? min(pad.pre, TIGHT_PAD) : pad.pre,
        post: tightEnd ? min(pad.post, TIGHT_PAD) : pad.post
    )
}

/// Seconds into the cut video where the rally actually ends (the deciding
/// shot): cut_t0 + effective pre + (t1 - t0).
func rallyEnd(_ p: MatchPoint, _ pad: ClipPad) -> Double? {
    guard let cutT0 = p.cutT0, let t0 = p.t0, let t1 = p.t1 else { return nil }
    let eff = effectivePad(pad, tightStart: p.tightStart, tightEnd: p.tightEnd)
    return cutT0 + eff.pre + max(0, t1 - t0)
}

/// Full padded clip end — rallyEnd + the whole effective post pad.
func paddedEnd(_ p: MatchPoint, _ pad: ClipPad) -> Double? {
    guard let end = rallyEnd(p, pad) else { return nil }
    return end + effectivePad(pad, tightStart: p.tightStart, tightEnd: p.tightEnd).post
}

/// Margin kept after the winner tap: the 2026-08-16 boundary study puts
/// the tap at the rally's true end at the median but up to ~0.7s early,
/// so half a second stays on before the cut.
let TAP_END_GUARD_S = 0.5

/// Where a point's footage EFFECTIVELY ends, for playback and renders.
///
/// scoredAtCutS is the playhead at the winner tap — the owner saying
/// "decided by here" (067). Everything past tap + 0.5s is ball retrieval
/// and walking: ~25% of a scored match's cut
/// (docs/research/2026-08-25-tap-end-shave.md).
///
/// A CLAMP, never an extension: min(paddedEnd, tap + 0.5s). The tap is
/// ignored — the padded end stands — when `on` is false
/// (app_config.tap_end_playback, the kill switch), on hand-edited points
/// (the clip editor is explicit intent about boundaries and the tap
/// predates the edit), and when the tap lands before its own clip start
/// (a slipped or stale tap describes no point that can happen). Mirrors
/// playhead.ts effectiveEnd — the two must stay rule-identical.
func effectiveEnd(_ p: MatchPoint, _ pad: ClipPad, on: Bool) -> Double? {
    guard let padded = paddedEnd(p, pad) else { return nil }
    guard on, !p.edited, let tap = p.scoredAtCutS, let cutT0 = p.cutT0,
          tap >= cutT0 else { return padded }
    return min(padded, tap + TAP_END_GUARD_S)
}

/// Inverse of the anchoring fact: the SOURCE-video time for cut time T
/// inside point p's span.
func cutToSource(_ p: MatchPoint, _ t: Double, _ pad: ClipPad) -> Double? {
    guard let cutT0 = p.cutT0, let t0 = p.t0 else { return nil }
    let eff = effectivePad(pad, tightStart: p.tightStart, tightEnd: p.tightEnd)
    let anchor = max(0, t0 - eff.pre)
    return anchor + (t - cutT0)
}

/// How much of the post pad plays before the answer freeze.
let PAUSE_BEAT_S = 1.2

/// Keep-score pause boundary: rally end + a beat (capped), clamped to just
/// before the next padded start on dense cuts.
func pauseEnd(_ p: MatchPoint, _ pad: ClipPad, nextStart: Double?) -> Double? {
    guard let end = rallyEnd(p, pad) else { return nil }
    let beat = min(
        effectivePad(pad, tightStart: p.tightStart, tightEnd: p.tightEnd).post,
        PAUSE_BEAT_S
    )
    let stop = end + beat
    guard let nextStart else { return stop }
    return max(end, min(stop, nextStart - 0.05))
}

/// The next visible point's padded start after p.
func nextCutStart(_ points: [MatchPoint], after p: MatchPoint) -> Double? {
    guard let i = points.firstIndex(where: { $0.id == p.id }) else { return nil }
    for j in (i + 1)..<points.count {
        if let c = points[j].cutT0 { return c }
    }
    return nil
}

/// WYSIWYG resolver: the last point whose padded span start (cut_t0, with
/// a 0.25 s lead) the playhead has reached. The single source of truth for
/// which rally is on screen.
func playingPointId(_ points: [MatchPoint], at t: Double) -> UUID? {
    var id: UUID?
    for p in points {
        guard let cutT0 = p.cutT0 else { continue }
        if t >= cutT0 - 0.25 { id = p.id } else { break }
    }
    return id
}

/// Legacy fallback: the point whose rally END the playhead most recently
/// crossed.
func armedPointId(_ points: [MatchPoint], at t: Double, _ pad: ClipPad) -> UUID? {
    var id: UUID?
    for p in points {
        guard let end = rallyEnd(p, pad) else { continue }
        if t >= end - 0.15 { id = p.id } else { break }
    }
    return id
}
