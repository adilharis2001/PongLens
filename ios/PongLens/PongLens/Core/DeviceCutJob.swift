import Foundation

// Cutting a hand-marked match on the phone: everything about the job that
// is not AVFoundation, a background task or the network. The job record the
// phone keeps on disk, the order of the work and where it resumes, the
// manifest the Mac checks, the progress it reports, and when it stops.
// Foundation only, so ios/Tests/run.sh checks it without a simulator.
//
// Contract: docs/superpowers/specs/2026-09-25-device-hand-cut-contract.md.
// The runner that drives this with real files is DeviceHandCut.swift.

// MARK: - What the claim hands the phone (contract 3.1)

nonisolated struct DeviceCutClaim: Codable, Equatable, Sendable {
    struct Keys: Codable, Equatable, Sendable {
        var cut: String
        var manifest: String
        var clips: [String]
    }
    struct Pads: Codable, Equatable, Sendable {
        var pre: Double
        var post: Double
    }

    var jobId: UUID
    var points: Int
    var bucket: String
    var keys: Keys
    var clipPads: Pads

    enum CodingKeys: String, CodingKey {
        case jobId = "job_id", points, bucket, keys
        case clipPads = "clip_pads"
    }

    /// The claim's keys and pads against the phone's plan. Nil when they
    /// agree; otherwise the reason the phone should not cut this one.
    func mismatch(with plan: CutPlan.Plan) -> String? {
        if abs(clipPads.pre - CutPlan.clipPre) > 1e-9 || abs(clipPads.post - CutPlan.clipPost) > 1e-9 {
            return "clip pads \(clipPads.pre)/\(clipPads.post)"
        }
        if keys.clips.count < plan.points.count {
            return "\(keys.clips.count) clip keys for \(plan.points.count) points"
        }
        for point in plan.points where !keys.clips[point.idx - 1].hasSuffix("/" + point.clip) {
            return "clip key \(point.idx) is \(keys.clips[point.idx - 1])"
        }
        return nil
    }

    /// The claim's key for one point's clip (1-based, t0 order).
    func clipKey(_ idx: Int) -> String? {
        keys.clips.indices.contains(idx - 1) ? keys.clips[idx - 1] : nil
    }
}

// MARK: - The source, as the phone read it

nonisolated struct DeviceCutSource: Codable, Equatable, Sendable {
    /// D: AVURLAsset with precise timing, `.duration`. Unrounded.
    var duration: Double
    /// `nominalFrameRate`, unrounded.
    var fps: Double
    /// `naturalSize`: the stored frame, before rotation.
    var width: Int
    var height: Int
    var rotation: Int
    var hasAudio: Bool
    var bytes: Int64

    var rotated: Bool { rotation % 180 != 0 }
}

// MARK: - The encoding settings (contract section 6)

nonisolated enum DeviceCutSettings {
    static let cutAudioBitrate = 128_000
    static let clipAudioBitrate = 96_000
    /// The Mac's clips: h264_videotoolbox at 2500k (worker._encode_clip).
    static let clipVideoBitrate = 2_500_000
    static let keyframeFrames = HandCutPlan.keyframeFrames
    static let clipWidth = HandCutPlan.clipWidth
    /// The cut's multipart part size, as the recording queue uses.
    static let partSize: Int64 = 64 * 1024 * 1024
    /// The route refuses a cut over 12 GB and a clip over 60 MB. The phone
    /// keeps well inside both.
    static let maxCutBytes: Int64 = 11 * 1024 * 1024 * 1024
    static let maxClipBytes: Int64 = 50 * 1024 * 1024

    /// The cut at source resolution: 0.1 bits per pixel per frame, near what
    /// the Mac's CRF 18 cut produces for 1080p table tennis.
    static func cutVideoBitrate(_ source: DeviceCutSource) -> Int {
        HandCutPlan.bitrate(width: source.width, height: source.height, fps: source.fps, bitsPerPixel: 0.1)
    }

    /// The Mac's 2.5 Mbps, lowered only for a clip long enough that it
    /// would otherwise pass the size the route accepts.
    static func clipVideoBitrate(seconds: Double) -> Int {
        guard seconds.isFinite, seconds > 0 else { return clipVideoBitrate }
        let budget = Double(maxClipBytes) * 8 / (seconds * overshoot) - Double(clipAudioBitrate)
        return max(500_000, min(clipVideoBitrate, Int(budget)))
    }

    /// A hardware encoder's average bitrate is a target, not a ceiling.
    static let overshoot = 1.15

    static func bytes(seconds: Double, videoBitrate: Int, audioBitrate: Int) -> Int64 {
        guard seconds.isFinite, seconds > 0 else { return 0 }
        return Int64((seconds * Double(videoBitrate + audioBitrate) / 8 * overshoot).rounded(.up))
    }

    /// Python's round(x, 3), the way the Mac writes ffprobe's frame rate.
    static func r3(_ x: Double) -> Double {
        guard x.isFinite else { return x }
        return Double(String(format: "%.3f", x)) ?? x
    }
}

// MARK: - Why the phone stopped

/// Conditions that stop the phone until they clear: re-checked each time
/// the work resumes, and meanwhile the player can hand the cut to the Mac.
nonisolated enum DeviceCutHold: String, Codable, Equatable, Sendable {
    case heat
    case lowPower
    case storage
}

/// Stops that do not clear by themselves. Only the Mac finishes the job.
nonisolated enum DeviceCutStop: String, Codable, Equatable, Sendable {
    /// The cut failed twice, or three clips did.
    case encodeFailed
    /// The cut would be larger than the route accepts.
    case tooLarge
    /// The multipart upload vanished and there is nothing left to resend.
    case uploadLost
}

// MARK: - The job the phone keeps

nonisolated struct DeviceCutJob: Codable, Equatable, Sendable, Identifiable {
    struct CutResult: Codable, Equatable, Sendable {
        var bytes: Int64
        var duration: Double
        var width: Int
        var height: Int
        /// Where each segment's first source second landed on the cut's
        /// clock, read from the composition: `cut_segment_offsets`.
        var measuredOffsets: [Double]
        /// PTS of each segment's first written frame: `cut_first_frame_s`.
        var firstFrames: [Double]
        var wall: Double
    }

    struct ClipResult: Codable, Equatable, Sendable {
        var idx: Int
        var bytes: Int64
        var wall: Double
    }

    var id: UUID { jobId }
    var jobId: UUID
    var matchId: UUID
    var userId: UUID
    var createdAt: Date
    var claim: DeviceCutClaim
    var source: DeviceCutSource
    var cutSegments: [[Double]]
    var plannedOffsets: [Double]
    var points: [CutPlan.Point]
    var cutVideoBitrate: Int

    // Encoding, one checkpoint per finished file.
    var cut: CutResult?
    var clips: [ClipResult] = []
    /// Clips the phone gave up on: `clip: null` in the manifest, and the
    /// Mac cuts just those.
    var clipsAbandoned: [Int] = []
    /// Failed attempts per output ("cut", "clip-3"). Interruptions by the
    /// system (backgrounding, an expired task) are not failures.
    var failures: [String: Int] = [:]

    // Upload.
    var uploadId: String?
    var partCount: Int?
    var partsSliced = false
    var etags: [Int: String] = [:]
    var cutUploaded = false
    var clipsUploaded: [Int] = []
    var manifestUploaded = false
    var submitted = false

    var hold: DeviceCutHold?
    var stop: DeviceCutStop?

    // Diagnostics for the manifest.
    var clipsWall = 0.0
    var uploadStartedAt: Date?
    var uploadWall: Double?

    // The last report that reached the server.
    var reportedStage: String?
    var reportedProgress: Int?
    var reportedAt: Date?

    init(claim: DeviceCutClaim, matchId: UUID, userId: UUID, source: DeviceCutSource,
         plan: CutPlan.Plan, createdAt: Date = Date()) {
        self.jobId = claim.jobId
        self.matchId = matchId
        self.userId = userId
        self.createdAt = createdAt
        self.claim = claim
        self.source = source
        self.cutSegments = plan.cutSegments
        self.plannedOffsets = plan.offsets
        self.points = plan.points
        self.cutVideoBitrate = DeviceCutSettings.cutVideoBitrate(source)
    }

    // MARK: Derived

    var keptSeconds: Double { cutSegments.reduce(0) { $0 + ($1[1] - $1[0]) } }

    func clipSeconds(_ idx: Int) -> Double {
        guard let p = points.first(where: { $0.idx == idx }) else { return 0 }
        return max(0, p.clipT1 - p.clipT0)
    }

    var clipSecondsTotal: Double { points.reduce(0) { $0 + max(0, $1.clipT1 - $1.clipT0) } }

    func clipEncoded(_ idx: Int) -> ClipResult? { clips.first { $0.idx == idx } }

    /// Encoded or given up: nothing more to do for this clip's file.
    func clipSettled(_ idx: Int) -> Bool {
        clipEncoded(idx) != nil || clipsAbandoned.contains(idx)
    }

    var encodingDone: Bool { cut != nil && points.allSatisfy { clipSettled($0.idx) } }

    func partLength(_ n: Int) -> Int64 {
        guard let cut, let partCount, n >= 1, n <= partCount else { return 0 }
        let offset = Int64(n - 1) * DeviceCutSettings.partSize
        return min(DeviceCutSettings.partSize, cut.bytes - offset)
    }

    /// Everything that goes up, the manifest aside.
    var uploadBytesTotal: Int64 {
        (cut?.bytes ?? 0) + clips.reduce(0) { $0 + $1.bytes }
    }

    var uploadBytesDone: Int64 {
        let parts = cutUploaded ? (cut?.bytes ?? 0) : etags.keys.reduce(Int64(0)) { $0 + partLength($1) }
        let clipBytes = clips.filter { clipsUploaded.contains($0.idx) }.reduce(Int64(0)) { $0 + $1.bytes }
        return parts + clipBytes
    }
}

// MARK: - The order of the work

nonisolated enum DeviceCutStep: Equatable, Sendable {
    case encodeCut
    case encodeClip(Int)
    /// Create the multipart upload and slice the cut into part files.
    case prepareUpload
    /// Parts and clips still to send.
    case upload(parts: [Int], clips: [Int])
    case completeCut
    case uploadManifest
    case submit
    case finished
    case stopped(DeviceCutStop)
}

nonisolated enum DeviceCutFlow {
    /// What to do next, from the job alone. The runner calls this after
    /// every step and on every resume, so a relaunch picks up exactly where
    /// the last finished file left off.
    static func next(_ job: DeviceCutJob) -> DeviceCutStep {
        if job.submitted { return .finished }
        if let stop = job.stop { return .stopped(stop) }
        if job.cut == nil { return .encodeCut }
        for p in job.points where !job.clipSettled(p.idx) { return .encodeClip(p.idx) }
        if job.uploadId == nil || !job.partsSliced || job.partCount == nil { return .prepareUpload }
        let parts = job.cutUploaded ? [] : (1...max(1, job.partCount ?? 1)).filter { job.etags[$0] == nil }
        let clips = job.clips.map(\.idx).filter { !job.clipsUploaded.contains($0) }.sorted()
        if !parts.isEmpty || !clips.isEmpty { return .upload(parts: parts, clips: clips) }
        if !job.cutUploaded { return .completeCut }
        if !job.manifestUploaded { return .uploadManifest }
        return .submit
    }

    /// A failed attempt. Returns true when the phone should stop and offer
    /// the Mac. An interruption the system caused is not counted.
    @discardableResult
    static func recordFailure(_ job: inout DeviceCutJob, step: DeviceCutStep, interrupted: Bool) -> Bool {
        guard !interrupted else { return false }
        switch step {
        case .encodeCut:
            job.failures["cut", default: 0] += 1
            if job.failures["cut", default: 0] >= 2 { job.stop = .encodeFailed }
        case .encodeClip(let idx):
            let key = "clip-\(idx)"
            job.failures[key, default: 0] += 1
            if job.failures[key, default: 0] >= 2, !job.clipsAbandoned.contains(idx) {
                job.clipsAbandoned.append(idx)
                // One clip the phone cannot make is the Mac's to cut; three
                // say the encoder itself is not working here.
                if job.clipsAbandoned.count >= 3 { job.stop = .encodeFailed }
            }
        default:
            break
        }
        return job.stop != nil
    }

    /// The multipart upload is gone (expired or aborted). Part files are
    /// deleted as each lands, so the cut is encoded again.
    static func uploadLost(_ job: inout DeviceCutJob) {
        job.uploadId = nil
        job.partCount = nil
        job.partsSliced = false
        job.etags = [:]
        job.cutUploaded = false
        job.cut = nil
        job.manifestUploaded = false
    }

    /// Objects the route found missing at submit: send them again.
    static func missing(_ job: inout DeviceCutJob, keys: [String]) {
        for key in keys {
            if key == job.claim.keys.cut {
                uploadLost(&job)
            } else if key == job.claim.keys.manifest {
                job.manifestUploaded = false
            } else if let i = job.claim.keys.clips.firstIndex(of: key) {
                job.clipsUploaded.removeAll { $0 == i + 1 }
                job.manifestUploaded = false
            }
        }
    }

    /// The stage the server hears (contract 3.2).
    static func reportStage(_ step: DeviceCutStep, paused: Bool) -> String {
        if paused { return "device_paused" }
        switch step {
        case .encodeCut: return "device_cut"
        case .encodeClip: return "device_clips"
        case .stopped: return "device_paused"
        default: return "device_upload"
        }
    }

    /// The phone's whole part as 0 to 100: cut 0 to 60, clips 60 to 80,
    /// upload 80 to 100. `fraction` is the file being encoded right now;
    /// `inflightBytes` what the uploads in the air have sent so far.
    static func progress(_ job: DeviceCutJob, step: DeviceCutStep, fraction: Double = 0,
                         inflightBytes: Int64 = 0) -> Int {
        let f = min(1, max(0, fraction.isFinite ? fraction : 0))
        let value: Double
        if job.submitted {
            value = 100
        } else if job.cut == nil {
            value = 60 * (step == .encodeCut ? f : 0)
        } else if !job.encodingDone {
            let total = max(0.001, job.clipSecondsTotal)
            var done = job.points.filter { job.clipSettled($0.idx) }.reduce(0) { $0 + job.clipSeconds($1.idx) }
            if case .encodeClip(let idx) = step { done += f * job.clipSeconds(idx) }
            value = 60 + 20 * min(1, done / total)
        } else {
            // 100 belongs to the submit that hands the job to the Mac.
            let total = max(1, job.uploadBytesTotal)
            let sent = min(total, job.uploadBytesDone + max(0, inflightBytes))
            value = min(99, 80 + 20 * Double(sent) / Double(total))
        }
        return Int(min(100, max(0, value)).rounded(.down))
    }
}

// MARK: - When to report (contract 3.2)

nonisolated enum DeviceCutReportClock {
    /// Every stage change; otherwise at most every 10 s when the progress
    /// moved, and at least every 60 s while working.
    static func due(now: Date, stage: String, progress: Int,
                    lastStage: String?, lastProgress: Int?, lastAt: Date?) -> Bool {
        guard let lastStage, let lastAt else { return true }
        if stage != lastStage { return true }
        let gap = now.timeIntervalSince(lastAt)
        if gap >= 60 { return true }
        return gap >= 10 && progress != lastProgress
    }
}

// MARK: - Heat, power and space

nonisolated enum DeviceCutGuard {
    enum Decision: Equatable, Sendable {
        case go
        /// Serious heat: wait between files.
        case cool
        case hold(DeviceCutHold)
    }

    /// `thermal` is ProcessInfo.ThermalState's raw value: 0 nominal, 1 fair,
    /// 2 serious, 3 critical.
    static func decide(thermal: Int, lowPower: Bool, freeBytes: Int64?, neededBytes: Int64) -> Decision {
        if thermal >= 3 { return .hold(.heat) }
        if lowPower { return .hold(.lowPower) }
        if let freeBytes, freeBytes < neededBytes { return .hold(.storage) }
        if thermal == 2 { return .cool }
        return .go
    }

    /// Room kept free beyond the files themselves, so the phone is never
    /// run to empty.
    static let spareBytes: Int64 = 500 * 1024 * 1024

    /// What the rest of the job still needs on disk: the files not yet
    /// written, one part of slicing headroom while the cut is sliced, and
    /// the spare room.
    static func bytesNeeded(_ job: DeviceCutJob) -> Int64 {
        var need = spareBytes
        if job.cut == nil {
            need += DeviceCutSettings.bytes(seconds: job.keptSeconds, videoBitrate: job.cutVideoBitrate,
                                            audioBitrate: DeviceCutSettings.cutAudioBitrate)
        }
        for p in job.points where !job.clipSettled(p.idx) {
            let seconds = job.clipSeconds(p.idx)
            need += DeviceCutSettings.bytes(seconds: seconds,
                                            videoBitrate: DeviceCutSettings.clipVideoBitrate(seconds: seconds),
                                            audioBitrate: DeviceCutSettings.clipAudioBitrate)
        }
        if !job.partsSliced { need += DeviceCutSettings.partSize }
        return need
    }

    /// The same estimate before anything is claimed: the whole job.
    static func bytesNeeded(plan: CutPlan.Plan, source: DeviceCutSource) -> Int64 {
        let cut = DeviceCutSettings.bytes(seconds: plan.kept, videoBitrate: DeviceCutSettings.cutVideoBitrate(source),
                                          audioBitrate: DeviceCutSettings.cutAudioBitrate)
        let clips = plan.points.reduce(Int64(0)) { sum, p in
            let seconds = max(0, p.clipT1 - p.clipT0)
            return sum + DeviceCutSettings.bytes(seconds: seconds,
                                                 videoBitrate: DeviceCutSettings.clipVideoBitrate(seconds: seconds),
                                                 audioBitrate: DeviceCutSettings.clipAudioBitrate)
        }
        return cut + clips + DeviceCutSettings.partSize + spareBytes
    }

    /// The cut alone, against what the route accepts.
    static func cutTooLarge(plan: CutPlan.Plan, source: DeviceCutSource) -> Bool {
        DeviceCutSettings.bytes(seconds: plan.kept, videoBitrate: DeviceCutSettings.cutVideoBitrate(source),
                                audioBitrate: DeviceCutSettings.cutAudioBitrate) > DeviceCutSettings.maxCutBytes
    }
}

// MARK: - The manifest (contract section 6)

nonisolated struct DeviceCutManifest: Encodable, Equatable, Sendable {
    struct Source: Encodable, Equatable, Sendable {
        var duration: Double
        var fps: Double
        var width: Int
        var height: Int
        var rotation: Int?
    }
    struct Pads: Encodable, Equatable, Sendable {
        var pre: Double
        var post: Double
    }
    struct Cut: Encodable, Equatable, Sendable {
        var bytes: Int64
        var duration: Double
        var width: Int
        var height: Int
    }
    struct Point: Encodable, Equatable, Sendable {
        var idx: Int
        var t0: Double
        var t1: Double
        var clipT0: Double
        var clipT1: Double
        var cutT0: Double
        /// Null, written out, for a clip the phone could not make: the
        /// route skips a null and refuses a missing key.
        var clip: String?
        var clipBytes: Int64?

        enum CodingKeys: String, CodingKey {
            case idx, t0, t1, clip
            case clipT0 = "clip_t0", clipT1 = "clip_t1", cutT0 = "cut_t0", clipBytes = "clip_bytes"
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(idx, forKey: .idx)
            try c.encode(t0, forKey: .t0)
            try c.encode(t1, forKey: .t1)
            try c.encode(clipT0, forKey: .clipT0)
            try c.encode(clipT1, forKey: .clipT1)
            try c.encode(cutT0, forKey: .cutT0)
            if let clip { try c.encode(clip, forKey: .clip) } else { try c.encodeNil(forKey: .clip) }
            try c.encodeIfPresent(clipBytes, forKey: .clipBytes)
        }
    }
    struct EncoderInfo: Encodable, Equatable, Sendable {
        struct Cut: Encodable, Equatable, Sendable {
            var codec = "h264"
            var profile = "high"
            var keyframeFrames = DeviceCutSettings.keyframeFrames
            var videoBitrate: Int
            var audio = "aac"
            var audioBitrate = DeviceCutSettings.cutAudioBitrate
            var faststart = true
            enum CodingKeys: String, CodingKey {
                case codec, profile, audio, faststart
                case keyframeFrames = "keyframe_frames", videoBitrate = "video_bitrate", audioBitrate = "audio_bitrate"
            }
        }
        struct Clips: Encodable, Equatable, Sendable {
            var codec = "h264"
            var width = DeviceCutSettings.clipWidth
            var keyframeFrames = DeviceCutSettings.keyframeFrames
            var videoBitrate = DeviceCutSettings.clipVideoBitrate
            var audio = "aac"
            var audioBitrate = DeviceCutSettings.clipAudioBitrate
            enum CodingKeys: String, CodingKey {
                case codec, width, audio
                case keyframeFrames = "keyframe_frames", videoBitrate = "video_bitrate", audioBitrate = "audio_bitrate"
            }
        }
        var cut: Cut
        var clips = Clips()
        var device: String
        var os: String
        var appBuild: String
        enum CodingKeys: String, CodingKey {
            case cut, clips, device, os
            case appBuild = "app_build"
        }
    }
    struct Timing: Encodable, Equatable, Sendable {
        var cutWall: Double?
        var clipsWall: Double?
        var uploadWall: Double?
        enum CodingKeys: String, CodingKey {
            case cutWall = "cut_wall_s", clipsWall = "clips_wall_s", uploadWall = "upload_wall_s"
        }
    }

    var schema = 1
    var pipeline = "hand-v1"
    var cutter = "device"
    var jobId: String
    var matchId: String
    var source: Source
    var clipPads = Pads(pre: CutPlan.clipPre, post: CutPlan.clipPost)
    var cutSegments: [[Double]]
    var cutSegmentOffsets: [Double]
    var cutFirstFrameS: [Double]?
    var cut: Cut?
    var points: [Point]
    var encoder: EncoderInfo?
    var timing: Timing?

    enum CodingKeys: String, CodingKey {
        case schema, pipeline, cutter, source, cut, points, encoder, timing
        case jobId = "job_id", matchId = "match_id", clipPads = "clip_pads"
        case cutSegments = "cut_segments", cutSegmentOffsets = "cut_segment_offsets"
        case cutFirstFrameS = "cut_first_frame_s"
    }

    /// The Mac's tolerances for the phone's own clock (contract section 7).
    static let offsetTolerance = 0.05
    static let firstOffsetMax = 0.1
    static let firstFrameTolerance = 0.1

    /// The manifest for a job whose cut is encoded. Nil before that.
    static func build(_ job: DeviceCutJob, encoder: EncoderInfo? = nil, timing: Timing? = nil) -> DeviceCutManifest? {
        guard let cut = job.cut else { return nil }
        let points = job.points.map { p in
            let clip = job.clipEncoded(p.idx)
            return Point(idx: p.idx, t0: p.t0, t1: p.t1, clipT0: p.clipT0, clipT1: p.clipT1,
                         cutT0: p.cutT0, clip: clip == nil ? nil : p.clip, clipBytes: clip?.bytes)
        }
        // Diagnostic only, and a value outside the Mac's tolerance would
        // turn a good cut into a mismatch, so the list goes in only whole
        // and inside it.
        let frames = cut.firstFrames.count == cut.measuredOffsets.count
            && zip(cut.firstFrames, cut.measuredOffsets).allSatisfy { abs($0 - $1) <= firstFrameTolerance }
            ? cut.firstFrames.map { rounded($0, 6) } : nil
        return DeviceCutManifest(
            jobId: job.jobId.uuidString.lowercased(),
            matchId: job.matchId.uuidString.lowercased(),
            source: Source(duration: job.source.duration, fps: DeviceCutSettings.r3(job.source.fps),
                           width: job.source.width, height: job.source.height,
                           rotation: job.source.rotation),
            cutSegments: job.cutSegments,
            cutSegmentOffsets: cut.measuredOffsets.map { rounded($0, 6) },
            cutFirstFrameS: frames,
            cut: Cut(bytes: cut.bytes, duration: rounded(cut.duration, 6), width: cut.width, height: cut.height),
            points: points,
            encoder: encoder,
            timing: timing)
    }

    /// The Mac's checks of the phone's own clock (5) and shape (1, 3), run
    /// before anything is uploaded, so a cut the Mac would redo is redone
    /// here instead. Nil means it passes.
    func selfCheck(plannedOffsets: [Double], expectedPoints: Int) -> String? {
        guard schema == 1, pipeline == "hand-v1", cutter == "device" else { return "header" }
        guard source.duration.isFinite, source.duration > 0, source.fps > 0,
              source.width > 0, source.height > 0 else { return "source" }
        guard points.count == expectedPoints else { return "\(points.count) points for \(expectedPoints)" }
        guard cutSegmentOffsets.count == cutSegments.count,
              plannedOffsets.count == cutSegments.count else { return "offsets count" }
        if let first = cutSegmentOffsets.first, first < 0 || first > Self.firstOffsetMax {
            return "the first segment starts at \(first)s"
        }
        for (a, b) in zip(cutSegmentOffsets, cutSegmentOffsets.dropFirst()) where b <= a {
            return "offsets are not increasing"
        }
        for (i, (got, want)) in zip(cutSegmentOffsets, plannedOffsets).enumerated()
        where abs(got - want) > Self.offsetTolerance {
            return "segment \(i + 1) starts at \(got)s, planned \(want)s"
        }
        return nil
    }

    func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }

    private static func rounded(_ x: Double, _ places: Int) -> Double {
        guard x.isFinite else { return x }
        return Double(String(format: "%.\(places)f", x)) ?? x
    }
}

// MARK: - What the player reads

nonisolated enum DeviceCutCopy {
    static let cutting = "Cutting on your iPhone"
    static let uploading = "Uploading from your iPhone"
    static let paused = "Paused on your iPhone"
    static let keepOpen = "Keep PongLens open while it cuts."
    static let cooling = "Waiting for your iPhone to cool down."
    static let waitingForApp = "Paused. It carries on when you open PongLens."
    static let offline = "Waiting for a connection."
    static let cutOnMac = "Cut on the Mac instead"
    static let moveFailed = "That didn't go through. Try again."

    static func hold(_ hold: DeviceCutHold) -> String {
        switch hold {
        case .heat: "Your iPhone is too hot to keep cutting."
        case .lowPower: "Cutting stopped because Low Power Mode is on."
        case .storage: "There isn't enough space on this iPhone to cut the match."
        }
    }

    static func stop(_ stop: DeviceCutStop) -> String {
        switch stop {
        case .encodeFailed: "This iPhone couldn't cut the match."
        case .tooLarge: "This match is too long to cut on this iPhone."
        case .uploadLost: "The upload from this iPhone didn't finish."
        }
    }

    /// The title while the phone holds the job.
    static func title(step: DeviceCutStep, paused: Bool) -> String {
        if paused { return Self.paused }
        switch step {
        case .encodeCut, .encodeClip: return Self.cutting
        case .stopped: return Self.paused
        default: return Self.uploading
        }
    }
}

// MARK: - The claim's refusals

nonisolated enum DeviceCutClaimOutcome: Equatable, Sendable {
    /// Cut on the Mac instead, silently: the switch is off for this account.
    case useMac
    /// The same sentence claim_hand_cut's refusal shows.
    case refused(String)

    /// The database's error codes (contract 3.1) in the marker's words,
    /// exactly as the Mac cut's claim reports them.
    static func from(message m: String) -> DeviceCutClaimOutcome {
        // Switched off for this account, or a database without the phone
        // cut at all (PostgREST's "no such function"): the Mac cuts it.
        if m.contains("not_enabled") || m.contains("PGRST202") || m.contains("Could not find the function") {
            return .useMac
        }
        if m.contains("already_cut") { return .refused("This match already has points.") }
        if m.contains("already_processing") { return .refused("Something is already running on this match.") }
        if m.contains("queue_full") { return .refused("Your queue is full. Wait for a video to finish.") }
        if m.contains("check_pending") { return .refused("Still checking the video. Try again in a moment.") }
        if m.contains("invalid_marks") { return .refused("Some marks are not valid. Check for very short points.") }
        return .refused("That didn't send. Check your connection and try again.")
    }
}

// MARK: - The route's answers (contract section 4)

nonisolated enum DeviceCutRouteAnswer: Equatable, Sendable {
    case ok(Data)
    /// 409 on submit: these objects never arrived. Send them again.
    case missing([String])
    /// 409: the job is no longer the phone's (submitted, moved to the Mac,
    /// released). The phone stops.
    case notOnPhone(phase: String?)
    /// 404: no such job for this account.
    case notFound
    /// Anything else, with the route's sentence.
    case refused(status: Int, message: String)

    init(status: Int, data: Data) {
        let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        switch status {
        case 200..<300:
            self = .ok(data)
        case 404:
            self = .notFound
        case 409:
            if let missing = body["missing"] as? [String], !missing.isEmpty {
                self = .missing(missing)
            } else {
                self = .notOnPhone(phase: body["phase"] as? String)
            }
        default:
            self = .refused(status: status, message: body["error"] as? String ?? "")
        }
    }

    func decode<T: Decodable>(_ type: T.Type) -> T? {
        guard case .ok(let data) = self else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
}

/// report_device_hand_cut's answer (contract 3.2). `accepted: false` means
/// the job is no longer the phone's, and the phone stops.
nonisolated struct DeviceCutReportAnswer: Decodable, Equatable, Sendable {
    var accepted: Bool
    var phase: String?
    var status: String?
}

/// The route's bodies the phone reads.
nonisolated enum DeviceCutRouteBodies {
    struct Created: Decodable, Sendable { let bucket: String?; let key: String?; let uploadId: String }
    struct Signed: Decodable, Sendable { let url: String }
    struct SignedKeys: Decodable, Sendable { let urls: [String: String] }
    struct Listed: Decodable, Sendable {
        struct Part: Decodable, Sendable {
            let PartNumber: Int?
            let ETag: String?
            let Size: Int64?
        }
        let parts: [Part]
        let gone: Bool?
    }
    struct Phase: Decodable, Sendable { let phase: String? }
}

extension DeviceCutFlow {
    /// Parts R2 already holds (list-parts), banked so they are not sent
    /// again after a relaunch. `gone` means the upload itself vanished.
    static func reconcile(_ job: inout DeviceCutJob, listed: DeviceCutRouteBodies.Listed) {
        if listed.gone == true {
            uploadLost(&job)
            return
        }
        for part in listed.parts {
            if let n = part.PartNumber, let etag = part.ETag, job.etags[n] == nil {
                job.etags[n] = etag
            }
        }
    }

    /// Where a transfer's completion belongs: "<job>|part|<n>" or
    /// "<job>|clip|<idx>".
    static func transfer(_ description: String) -> (jobId: UUID, kind: String, number: Int)? {
        let pieces = description.split(separator: "|")
        guard pieces.count == 3, let job = UUID(uuidString: String(pieces[0])),
              pieces[1] == "part" || pieces[1] == "clip", let n = Int(pieces[2]) else { return nil }
        return (job, String(pieces[1]), n)
    }

    static func transferName(_ jobId: UUID, kind: String, number: Int) -> String {
        "\(jobId.uuidString.lowercased())|\(kind)|\(number)"
    }
}
