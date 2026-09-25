import AVFoundation
import SwiftUI

// A hand-cut match, watched through (Adil, 2026-09-25): the full-match
// player plays exactly what the player marked, point after point, with hard
// cuts. The spans are Core/HandCutPlayback.swift; this is the player's side
// of it. Joins are made by a boundary observer at each End mark and a seek
// with a two-frame tolerance onto the next Begin mark, rather than by the
// fifth-of-a-second periodic tick, which let the pad after each point show.
//
// Why seeks and not an AVMutableComposition of the kept ranges: every other
// position this player knows (chips, flanks, the score bug, notes, inserted
// cards' detours) is a second on the CUT's clock. A composition would put a
// second clock under all of them, as the highlights file does, for joins
// that already land inside buffered footage a few seconds ahead. The
// composition stays the next step if a device shows a visible stall.
//
// Never on the highlights tape: `isCut` excludes it, so `markedTape` is
// empty there and no boundary is installed.

extension PlayerTakeover {

    /// A match cut by hand, watched through: exactly what the player marked,
    /// point after point, with hard cuts (Adil, 2026-09-25). Each kept point
    /// plays from its Begin mark to its End mark and the next one follows at
    /// once; pads, the footage between windows, lets and deleted points never
    /// show. Empty everywhere else, which leaves every other skip as it was:
    /// automatic matches, scoring, the original, the highlights tape.
    var markedTape: [MarkedSpan] {
        guard isCut, mode == .watch, HandCutPlayback.isHandCut(cutSource: match.cutSource) else { return [] }
        return HandCutPlayback.spans(points, pad: pad, ownClips: ownClips)
    }

    var tapeActive: Bool { !markedTape.isEmpty }

    // MARK: - A hand-cut match's tape (see markedTape)

    /// One decision per moment, the tape's: inside a kept point nothing
    /// happens, between two the next one's mark, past the last a stop.
    func tapeStep(at t: Double) {
        switch tapeMove(markedTape.map(\.timeSpan), at: t) {
        case .stay:
            return
        case .jump(let to):
            seek(to: to, toleranceAfter: HandCutPlayback.joinTolerance)
        case .end:
            player.pause()
            showChrome(autoHide: false)
        }
    }

    /// The joins, on time: a boundary observer at every kept point's End
    /// mark, rather than waiting up to a fifth of a second for the periodic
    /// tick, which let the pad after the point show. Cards that play their
    /// own clip end through the detour instead.
    func installTapeBoundary() {
        removeTapeBoundary()
        guard tapeActive, detourId == nil else { return }
        let times = markedTape.filter { !$0.ownClip }.map {
            NSValue(time: CMTime(seconds: $0.end, preferredTimescale: 600))
        }
        guard !times.isEmpty else { return }
        tapeBoundary = player.addBoundaryTimeObserver(forTimes: times, queue: .main) {
            MainActor.assumeIsolated { tapeBoundaryFired() }
        }
    }

    func removeTapeBoundary() {
        if let tapeBoundary { player.removeTimeObserver(tapeBoundary) }
        tapeBoundary = nil
    }

    /// Playing through an End mark. The clock can read a hair short of the
    /// boundary that fired, so it is read just past it.
    func tapeBoundaryFired() {
        guard tapeActive, detourId == nil, pendingSeekEpoch == nil, player.rate > 0, !scrubbing,
              !isHighlights else { return }
        let t = player.currentTime().seconds
        guard t.isFinite else { return }
        tapeStep(at: t + 0.02)
    }
}
