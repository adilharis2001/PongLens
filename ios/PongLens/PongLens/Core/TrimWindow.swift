import Foundation

// The trim with its preview (Components/TrimPreview.swift), as rules: where
// a handle may go, what "Start here" and "End here" set, the clock the times
// are written in, and the one-seek-in-flight rule that lets a handle drag
// move the picture without getting the app killed. Foundation only, so
// ios/Tests/run.sh checks every rule here without a simulator; the view
// reads these and decides nothing of its own. The web's TrimBar and
// BreakIntoPoints make the same moves.

/// One of the trim bar's two handles.
enum TrimHandle: Equatable {
    case start, end
}

enum TrimWindow {
    /// The shortest window the bar keeps (the web's MIN_TRIM_S). A caller
    /// deciding whether to offer trimming at all asks this rather than
    /// picking its own number.
    static let minWindow: Double = 5

    /// A touch on the track grabs the nearer handle; a tie goes to the
    /// start. Decided once, when the finger lands, so a finger that wanders
    /// past the other handle keeps the one it took.
    static func grab(_ seconds: Double, start: Double, end: Double) -> TrimHandle {
        abs(seconds - start) <= abs(seconds - end) ? .start : .end
    }

    /// Where a finger `x` points into a track `width` wide sits, in seconds
    /// of a video `duration` long. Off either end reads as that end.
    static func seconds(x: Double, width: Double, duration: Double) -> Double {
        guard width > 0, duration > 0 else { return 0 }
        return duration * min(1, max(0, x / width))
    }

    /// `handle` moved to `seconds`. Each handle pushes only its own edge,
    /// never closer than `minWindow` to the other and never off the video,
    /// so a fast drag cannot fling the start past the end.
    static func move(
        _ handle: TrimHandle, to seconds: Double,
        start: Double, end: Double, duration: Double
    ) -> (start: Double, end: Double) {
        switch handle {
        case .start:
            return (max(0, min(seconds, end - minWindow)), end)
        case .end:
            return (start, min(duration, max(seconds, start + minWindow)))
        }
    }

    /// The moment the preview shows while `handle` moves: that handle's own
    /// time, so the picture is the frame the processing starts or ends on.
    static func seekTarget(_ handle: TrimHandle, start: Double, end: Double) -> Double {
        handle == .start ? start : end
    }

    /// "Start here": the start handle to the picture, within the same
    /// limits as a drag.
    static func stampStart(playhead: Double, start: Double, end: Double, duration: Double) -> Double {
        move(.start, to: playhead, start: start, end: end, duration: duration).start
    }

    /// "End here": the end handle to the picture.
    static func stampEnd(playhead: Double, start: Double, end: Double, duration: Double) -> Double {
        move(.end, to: playhead, start: start, end: end, duration: duration).end
    }

    /// The player's own clock: whole seconds rounded DOWN, as the preview's
    /// transport and the web player write them, so the bar and the picture
    /// never read a second apart (a 728.99 s file is 12:08 in both).
    static func clock(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0:00" }
        let t = Int(seconds.rounded(.down))
        let h = t / 3600
        let m = (t % 3600) / 60
        let s = t % 60
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%d:%02d", m, s)
    }
}

/// One seek to ask the player for.
struct TrimSeek: Equatable {
    let seconds: Double
    /// Either side, in seconds. Zero is the exact frame.
    let tolerance: Double
}

/// The preview's seeks. A drag moves a handle many times a second, and an
/// exact seek on this footage fetches and decodes a whole group of pictures,
/// over the network for the original; dozens of those a second and the
/// system kills the app with no crash report (it did, on Modify's markers).
/// So: at most one seek in flight, the newest request replaces any waiting
/// one, a loose seek while a finger is down, and the exact frame once, when
/// it lifts.
struct TrimSeekQueue: Equatable {
    /// Near enough to follow a finger, loose enough to land on a keyframe.
    static let dragTolerance: Double = 0.15

    private(set) var inFlight = false
    private(set) var pending: Double?

    /// Ask for `seconds`. The seek to start now, or nil when one is already
    /// running: then this one waits, replacing whatever was waiting.
    mutating func request(_ seconds: Double, dragging: Bool) -> TrimSeek? {
        guard seconds.isFinite else { return nil }
        if inFlight {
            pending = seconds
            return nil
        }
        inFlight = true
        return TrimSeek(seconds: max(0, seconds), tolerance: dragging ? Self.dragTolerance : 0)
    }

    /// The running seek landed. The waiting one to start, if any: loose
    /// while a finger is still down, exact once it has lifted.
    mutating func finished(dragging: Bool) -> TrimSeek? {
        inFlight = false
        guard let next = pending else { return nil }
        pending = nil
        return request(next, dragging: dragging)
    }
}
