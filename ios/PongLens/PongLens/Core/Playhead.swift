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

/// app_config.unscored_rally_end and its buffer (143).
struct RallyEndConfig {
    let on: Bool
    let bufferS: Double
}

/// Which endings are allowed to shorten a point. Mirrors EndOptions in
/// playhead.ts; a struct rather than a second Bool for the same reason —
/// eleven call sites, and a flag that quietly means one thing at some of
/// them is how the two platforms drift apart.
struct EndOptions {
    let tapEnd: Bool
    var rallyEnd: RallyEndConfig? = nil

    static let off = EndOptions(tapEnd: false)
}

/// Where a point's footage EFFECTIVELY ends, for playback and renders.
///
/// Two endings can shorten a point, and they are ranked, not combined.
///
/// 1. THE TAP. scoredAtCutS is the playhead at the winner tap — the owner
///    saying "decided by here" (067). Everything past tap + 0.5s is ball
///    retrieval and walking: ~25% of a scored match's cut
///    (docs/research/2026-08-25-tap-end-shave.md).
///
/// 2. THE RALLY. rallyEndCutS is the last moment the rally was observed —
///    the last bounce on the user's own table, which points_v2.py has
///    always computed and t1 pads by 2.6s precisely so a winner tap would
///    land inside. No tap is coming on an unscored match, so that padding
///    is ball retrieval too (143).
///
/// The tap WINS wherever it exists, and a scored point never falls through
/// to the rally even with tap trimming switched off: the tap is a person
/// watching the point, the bounce is a detector that can miss the last
/// shot of a rally that ended off the table.
///
/// A CLAMP, never an extension, at every rung. Both are ignored on
/// hand-edited points (the clip editor is explicit intent about boundaries
/// and both signals predate the edit) and when the mark lands before its
/// own clip start (a slipped or stale value describes no point that can
/// happen). Mirrors playhead.ts effectiveEnd — the two must stay
/// rule-identical, and ios/Tests/fixtures/rally-end-parity.json is what
/// proves it.
func effectiveEnd(_ p: MatchPoint, _ pad: ClipPad, _ ends: EndOptions) -> Double? {
    guard let padded = paddedEnd(p, pad) else { return nil }
    guard let cutT0 = p.cutT0 else { return padded }
    guard !p.edited else { return padded }

    if let tap = p.scoredAtCutS {
        if ends.tapEnd, tap >= cutT0 {
            return min(padded, tap + TAP_END_GUARD_S)
        }
        return padded
    }
    if let rally = ends.rallyEnd, rally.on,
       let observed = p.rallyEndCutS, observed >= cutT0 {
        return min(padded, observed + rally.bufferS)
    }
    return padded
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
