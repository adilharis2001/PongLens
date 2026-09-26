import Foundation

// The arithmetic behind cutting a match on the phone (spec 2026-09-24,
// section 7). Foundation only, so ios/Tests/run.sh compiles and checks it
// without a simulator. The encoder that turns a plan into files is
// HandCutEncoder.swift; nothing here touches AVFoundation. Which seconds
// to keep comes from CutPlan.swift, the Swift port of the Python segment
// rules; this file holds what the encoder needs around it (clamping, the
// expected cut clock, the keyframe interval, the clip size).

/// A span of a video, in seconds of the SOURCE file unless a caller says
/// otherwise.
nonisolated struct TimeWindow: Codable, Equatable, Sendable {
    var start: Double
    var end: Double

    var duration: Double { max(0, end - start) }
}

nonisolated enum HandCutPlan {
    /// The Mac's GOP: a keyframe every 60 frames (`GOP_FRAMES` in
    /// points_pipeline.py). A long GOP is what made the cut stutter in
    /// August, because the player seeks constantly.
    static let keyframeFrames = 60

    /// Clips are 720 wide on the Mac (`scale=720:-2`).
    static let clipWidth = 720

    /// Segments clamped to [0, duration], empty ones dropped, sorted, and
    /// overlapping or touching ones merged. The encoder only ever sees a
    /// plan in this shape, so a composition never inserts the same second
    /// twice or runs past the end of the file.
    static func normalized(_ segments: [TimeWindow], duration: Double) -> [TimeWindow] {
        guard duration.isFinite, duration > 0 else { return [] }
        let clamped = segments
            .map { TimeWindow(start: max(0, $0.start), end: min(duration, $0.end)) }
            .filter { $0.end > $0.start }
            .sorted { $0.start < $1.start }
        var out: [TimeWindow] = []
        for window in clamped {
            if let last = out.last, window.start <= last.end {
                out[out.count - 1].end = max(last.end, window.end)
            } else {
                out.append(window)
            }
        }
        return out
    }

    /// Where each kept segment should start on the cut's own clock: the
    /// running total of the segments before it. The encoder reports the
    /// measured starts beside these, and phase 2 compares the two.
    static func cutStarts(for segments: [TimeWindow]) -> [Double] {
        var starts: [Double] = []
        var t = 0.0
        for segment in segments {
            starts.append(t)
            t += segment.duration
        }
        return starts
    }

    static func cutDuration(for segments: [TimeWindow]) -> Double {
        segments.reduce(0) { $0 + $1.duration }
    }

    /// The keyframe interval as a duration, consistent with the frame
    /// count: 60 frames is 2 s at 30 fps and 1 s at 60 fps. A source with
    /// no usable frame rate is treated as 30.
    static func keyframeSeconds(fps: Double, frames: Int = keyframeFrames) -> Double {
        let rate = fps.isFinite && fps > 1 ? fps : 30
        return Double(frames) / rate
    }

    /// The size a clip is encoded at: 720 wide as displayed, height from
    /// the displayed aspect and rounded to an even number (H.264 needs even
    /// dimensions), like `scale=720:-2`. `rotated` means the file carries a
    /// quarter-turn, so the encoded frame is the displayed one on its side.
    static func clipEncodedSize(
        naturalWidth: Double, naturalHeight: Double, rotated: Bool, targetWidth: Int = clipWidth
    ) -> (width: Int, height: Int) {
        let displayW = rotated ? naturalHeight : naturalWidth
        let displayH = rotated ? naturalWidth : naturalHeight
        guard displayW > 0, displayH > 0 else { return (targetWidth, evenFloor(Double(targetWidth) * 9 / 16)) }
        let height = evenRound(Double(targetWidth) * displayH / displayW)
        return rotated ? (height, targetWidth) : (targetWidth, height)
    }

    /// A video bitrate from bits per pixel per frame. 0.1 lands near what
    /// the Mac's x264 CRF 18 cut produces for 1080p table tennis.
    static func bitrate(width: Int, height: Int, fps: Double, bitsPerPixel: Double = 0.1) -> Int {
        let rate = fps.isFinite && fps > 1 ? fps : 30
        return max(500_000, Int((Double(width * height) * rate * bitsPerPixel).rounded()))
    }

    private static func evenRound(_ value: Double) -> Int {
        max(2, Int((value / 2).rounded()) * 2)
    }

    private static func evenFloor(_ value: Double) -> Int {
        max(2, Int(value / 2) * 2)
    }
}
