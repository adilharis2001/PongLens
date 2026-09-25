import AVFoundation
import CoreMedia
import Foundation
import os

// Cutting a match on the phone (spec 2026-09-24, section 7): the encoder.
//
// The cut is AVAssetReader over an AVMutableComposition of the kept
// segments, into AVAssetWriter. Not AVAssetExportSession, because the
// export session cannot set the keyframe interval, and a long one is what
// made the cut stutter in August. The settings match the Mac's
// (points_pipeline.py): H.264 at source resolution, a keyframe every 60
// frames, the index at the front, AAC 128k; clips 720 wide, AAC 96k.
//
// The plan (which seconds to keep, where each point's clip sits) comes
// from HandCutPlan.swift. Step 0's benchmark drives this with a synthetic
// plan; phase 2 drives it with the Swift port of the Python rules. Nothing
// here decides what to keep.
//
// Every heavy loop runs on its own serial queue, never the main actor and
// never a cooperative-pool thread, and checks the cancel flag between
// samples.

/// A cancel switch an encode checks between samples. Safe to flip from
/// any thread (a background task's expiration handler, a button).
nonisolated final class HandCutCancel: Sendable {
    private let flag = OSAllocatedUnfairLock(initialState: false)

    init() {}

    func cancel() { flag.withLock { $0 = true } }
    var isCancelled: Bool { flag.withLock { $0 } }
}

/// What a source video is, read once before planning.
nonisolated struct HandCutSourceInfo: Codable, Equatable, Sendable {
    var duration: Double
    /// As stored in the file (the encoder's frame).
    var naturalWidth: Int
    var naturalHeight: Int
    /// As shown, after the file's rotation flag.
    var displayWidth: Int
    var displayHeight: Int
    var rotationDegrees: Int
    var fps: Double
    /// Four-character codec code, e.g. "hvc1", "avc1".
    var codec: String
    /// The video track's average bitrate, bits per second.
    var videoBitrate: Double
    var hasAudio: Bool
    var audioSampleRate: Double?
    var audioChannels: Int?
    var bytes: Int64

    var rotated: Bool { rotationDegrees % 180 != 0 }
}

/// One file the encoder wrote.
nonisolated struct HandCutFileOutput: Sendable {
    var url: URL
    var bytes: Int64
    /// Length of the media written, seconds.
    var mediaSeconds: Double
    /// Wall time from the first sample read to the file closed, index
    /// rewritten to the front included.
    var wallSeconds: Double
    var width: Int
    var height: Int
}

nonisolated struct HandCutCutOutput: Sendable {
    var file: HandCutFileOutput
    /// HandCutPlan.cutStarts: the running total of kept durations.
    var plannedStarts: [Double]
    /// Where the composition placed each segment, read back from the
    /// composition's own track segments.
    var compositionStarts: [Double]
    /// The presentation time of each segment's first video frame in the
    /// file written, which is what a player seeking to the point sees.
    var measuredStarts: [Double]
}

nonisolated enum HandCutEncoderError: LocalizedError {
    case noVideoTrack
    case emptyPlan
    case unsupportedSettings(String)
    case readFailed(String)
    case writeFailed(String)
    case cancelled

    var errorDescription: String? {
        switch self {
        case .noVideoTrack: "The file has no video track."
        case .emptyPlan: "Nothing to keep."
        case .unsupportedSettings(let what): "The encoder refused the settings: \(what)."
        case .readFailed(let why): "Reading the source failed: \(why)"
        case .writeFailed(let why): "Writing the output failed: \(why)"
        case .cancelled: "Cancelled."
        }
    }
}

nonisolated enum HandCutEncoder {
    /// The Mac's audio bitrates.
    static let cutAudioBitrate = 128_000
    static let clipAudioBitrate = 96_000

    private static let queue = DispatchQueue(label: "com.ponglens.handcut.encode", qos: .userInitiated)

    // MARK: - Inspect

    static func inspect(_ url: URL) async throws -> HandCutSourceInfo {
        let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        guard let video = try await asset.loadTracks(withMediaType: .video).first else {
            throw HandCutEncoderError.noVideoTrack
        }
        let (size, transform, fps, rate, formats) = try await video.load(
            .naturalSize, .preferredTransform, .nominalFrameRate, .estimatedDataRate, .formatDescriptions)
        let duration = try await asset.load(.duration).seconds
        let degrees = rotationDegrees(transform)
        let codec = formats.first.map { fourCC(CMFormatDescriptionGetMediaSubType($0)) } ?? "?"
        var sampleRate: Double?
        var channels: Int?
        let audio = try await asset.loadTracks(withMediaType: .audio).first
        if let audio,
           let desc = try await audio.load(.formatDescriptions).first,
           let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(desc)?.pointee {
            sampleRate = asbd.mSampleRate
            channels = Int(asbd.mChannelsPerFrame)
        }
        let bytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64)
            .flatMap { $0 } ?? 0
        let w = Int(size.width.rounded())
        let h = Int(size.height.rounded())
        let quarter = degrees % 180 != 0
        return HandCutSourceInfo(
            duration: duration.isFinite ? duration : 0,
            naturalWidth: w, naturalHeight: h,
            displayWidth: quarter ? h : w, displayHeight: quarter ? w : h,
            rotationDegrees: degrees, fps: Double(fps), codec: codec,
            videoBitrate: Double(rate), hasAudio: audio != nil,
            audioSampleRate: sampleRate, audioChannels: channels, bytes: bytes)
    }

    // MARK: - The cut

    /// Encode the kept `segments` (source seconds, as HandCutPlan.normalized
    /// leaves them) into one H.264 file at source resolution.
    static func encodeCut(
        source: URL, segments: [TimeWindow], to output: URL,
        videoBitrate: Int, audioBitrate: Int = cutAudioBitrate,
        cancel: HandCutCancel,
        progress: @escaping @Sendable (Double) -> Void
    ) async throws -> HandCutCutOutput {
        let asset = AVURLAsset(url: source, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        guard let sourceVideo = try await asset.loadTracks(withMediaType: .video).first else {
            throw HandCutEncoderError.noVideoTrack
        }
        let sourceAudio = try await asset.loadTracks(withMediaType: .audio).first
        let (size, transform, fps, videoRange, naturalTimeScale) = try await sourceVideo.load(
            .naturalSize, .preferredTransform, .nominalFrameRate, .timeRange, .naturalTimeScale)
        let audioFormat = try await audioShape(sourceAudio)
        let audioRange = try await sourceAudio?.load(.timeRange)

        let plan = HandCutPlan.normalized(segments, duration: videoRange.end.seconds)
        guard !plan.isEmpty else { throw HandCutEncoderError.emptyPlan }

        // One composition, segments laid end to end. Audio goes in at the
        // same cursor as video and the cursor advances by the planned
        // length, so a short audio track can leave silence but can never
        // slide the picture against the sound.
        let composition = AVMutableComposition()
        guard let compVideo = composition.addMutableTrack(
            withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
        else { throw HandCutEncoderError.noVideoTrack }
        let compAudio = sourceAudio == nil ? nil : composition.addMutableTrack(
            withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
        let timescale = max(600, naturalTimeScale)
        var cursor = CMTime.zero
        for segment in plan {
            let range = CMTimeRange(
                start: CMTime(seconds: segment.start, preferredTimescale: timescale),
                end: CMTime(seconds: segment.end, preferredTimescale: timescale))
            try compVideo.insertTimeRange(range, of: sourceVideo, at: cursor)
            if let compAudio, let sourceAudio, let audioRange {
                let clipped = range.intersection(audioRange)
                if clipped.duration > .zero {
                    try? compAudio.insertTimeRange(
                        clipped, of: sourceAudio, at: cursor + (clipped.start - range.start))
                }
            }
            cursor = cursor + range.duration
        }
        let total = cursor
        let compositionStarts = compVideo.segments
            .filter { !$0.isEmpty }
            .map { $0.timeMapping.target.start.seconds }

        let encoded = evenSize(width: Int(size.width.rounded()), height: Int(size.height.rounded()))
        let orientation = orientedTransform(degrees: rotationDegrees(transform),
                                            width: encoded.width, height: encoded.height)

        let reader: AVAssetReader
        do { reader = try AVAssetReader(asset: composition) } catch {
            throw HandCutEncoderError.readFailed(describe(error))
        }
        let videoOut = AVAssetReaderTrackOutput(track: compVideo, outputSettings: decodedPixels)
        videoOut.alwaysCopiesSampleData = false
        guard reader.canAdd(videoOut) else { throw HandCutEncoderError.readFailed("video output") }
        reader.add(videoOut)
        var audioOut: AVAssetReaderOutput?
        if let compAudio, let audioFormat {
            let mix = AVAssetReaderAudioMixOutput(
                audioTracks: [compAudio], audioSettings: pcmSettings(audioFormat))
            mix.alwaysCopiesSampleData = false
            if reader.canAdd(mix) {
                reader.add(mix)
                audioOut = mix
            }
        }

        let writer = try makeWriter(output)
        let videoIn = try makeVideoInput(
            writer: writer, width: encoded.width, height: encoded.height,
            fps: Double(fps), bitrate: videoBitrate, scaled: false, transform: orientation)
        let audioIn = try audioOut == nil ? nil : makeAudioInput(
            writer: writer, shape: audioFormat!, bitrate: audioBitrate)

        let job = Job(reader: reader, writer: writer, videoOut: videoOut, audioOut: audioOut,
                      videoIn: videoIn, audioIn: audioIn)
        let plannedStarts = HandCutPlan.cutStarts(for: plan)
        let starts = compositionStarts.count == plan.count ? compositionStarts : plannedStarts
        let result = try await pump(
            job, sessionStart: .zero, sessionEnd: total, cancel: cancel,
            segmentStarts: starts, progress: progress)
        let file = HandCutFileOutput(
            url: output, bytes: fileSize(output), mediaSeconds: total.seconds,
            wallSeconds: result.wall, width: encoded.width, height: encoded.height)
        return HandCutCutOutput(
            file: file, plannedStarts: plannedStarts,
            compositionStarts: compositionStarts, measuredStarts: result.firstFrames)
    }

    // MARK: - A hand cut's video

    /// Encode a hand cut planned by CutPlan: `segments` are the plan's
    /// two-decimal source seconds, `offsets` where each one starts on the
    /// cut's clock (contract section 5).
    ///
    /// Each segment is inserted AT its planned offset, not at a running
    /// cursor, on a timescale where every two-decimal second is a whole
    /// number of ticks, so the measured clock equals the planned one by
    /// construction. `compositionStarts` is, per segment, where its first
    /// source second landed according to the composition's own time
    /// mapping (the manifest's `cut_segment_offsets`); `measuredStarts` the
    /// presentation time of its first written frame (`cut_first_frame_s`).
    static func encodePlannedCut(
        source: URL, segments: [[Double]], offsets: [Double], to output: URL,
        videoBitrate: Int, audioBitrate: Int = cutAudioBitrate,
        cancel: HandCutCancel,
        progress: @escaping @Sendable (Double) -> Void
    ) async throws -> HandCutCutOutput {
        guard !segments.isEmpty, segments.count == offsets.count else { throw HandCutEncoderError.emptyPlan }
        let asset = AVURLAsset(url: source, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        guard let sourceVideo = try await asset.loadTracks(withMediaType: .video).first else {
            throw HandCutEncoderError.noVideoTrack
        }
        let sourceAudio = try await asset.loadTracks(withMediaType: .audio).first
        let (size, transform, fps, videoRange, naturalTimeScale) = try await sourceVideo.load(
            .naturalSize, .preferredTransform, .nominalFrameRate, .timeRange, .naturalTimeScale)
        let audioFormat = try await audioShape(sourceAudio)
        let audioRange = try await sourceAudio?.load(.timeRange)

        let timescale = CutPlan.compositionTimescale(natural: naturalTimeScale)
        // Rounded, not CMTime(seconds:preferredTimescale:), which truncates:
        // 83.92999999999998 s became 50357/600 instead of 50358/600, and the
        // last segment landed a tick early.
        func tick(_ seconds: Double) -> CMTime {
            CMTime(value: CMTimeValue((seconds * Double(timescale)).rounded()), timescale: timescale)
        }

        let composition = AVMutableComposition()
        guard let compVideo = composition.addMutableTrack(
            withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
        else { throw HandCutEncoderError.noVideoTrack }
        compVideo.naturalTimeScale = timescale
        let compAudio = sourceAudio == nil ? nil : composition.addMutableTrack(
            withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)

        var compositionStarts: [Double] = []
        var end = CMTime.zero
        for (segment, offset) in zip(segments, offsets) {
            let range = CMTimeRange(start: tick(segment[0]), end: tick(segment[1]))
            let at = tick(offset)
            // A segment's tail can run past the video track (the plan clamps
            // to the asset's length, which the audio can set): insert what
            // the track has, at the place the plan gives it.
            let clipped = range.intersection(videoRange)
            guard clipped.duration > .zero else { throw HandCutEncoderError.emptyPlan }
            do {
                try compVideo.insertTimeRange(clipped, of: sourceVideo, at: at + (clipped.start - range.start))
            } catch {
                throw HandCutEncoderError.readFailed(describe(error))
            }
            if let compAudio, let sourceAudio, let audioRange {
                let heard = range.intersection(audioRange)
                if heard.duration > .zero {
                    try? compAudio.insertTimeRange(heard, of: sourceAudio, at: at + (heard.start - range.start))
                }
            }
            // Where this segment's first source second landed, read back
            // from the composition's own mapping rather than assumed.
            let placed = compVideo.segments.first { s in
                !s.isEmpty && s.timeMapping.target.start >= at - CMTime(value: 1, timescale: timescale)
            }
            if let placed {
                let mapping = placed.timeMapping
                compositionStarts.append(
                    mapping.target.start.seconds + (segment[0] - mapping.source.start.seconds))
            } else {
                compositionStarts.append(at.seconds)
            }
            end = max(end, at + range.duration)
        }

        let encoded = evenSize(width: Int(size.width.rounded()), height: Int(size.height.rounded()))
        let orientation = orientedTransform(degrees: rotationDegrees(transform),
                                            width: encoded.width, height: encoded.height)

        let reader: AVAssetReader
        do { reader = try AVAssetReader(asset: composition) } catch {
            throw HandCutEncoderError.readFailed(describe(error))
        }
        let videoOut = AVAssetReaderTrackOutput(track: compVideo, outputSettings: decodedPixels)
        videoOut.alwaysCopiesSampleData = false
        guard reader.canAdd(videoOut) else { throw HandCutEncoderError.readFailed("video output") }
        reader.add(videoOut)
        var audioOut: AVAssetReaderOutput?
        if let compAudio, let audioFormat {
            let mix = AVAssetReaderAudioMixOutput(
                audioTracks: [compAudio], audioSettings: pcmSettings(audioFormat))
            mix.alwaysCopiesSampleData = false
            if reader.canAdd(mix) {
                reader.add(mix)
                audioOut = mix
            }
        }

        let writer = try makeWriter(output)
        let videoIn = try makeVideoInput(
            writer: writer, width: encoded.width, height: encoded.height,
            fps: Double(fps), bitrate: videoBitrate, scaled: false, transform: orientation)
        let audioIn = try audioOut == nil ? nil : makeAudioInput(
            writer: writer, shape: audioFormat!, bitrate: audioBitrate)

        let job = Job(reader: reader, writer: writer, videoOut: videoOut, audioOut: audioOut,
                      videoIn: videoIn, audioIn: audioIn)
        let result = try await pump(
            job, sessionStart: .zero, sessionEnd: end, cancel: cancel,
            segmentStarts: compositionStarts, progress: progress)
        let file = HandCutFileOutput(
            url: output, bytes: fileSize(output), mediaSeconds: end.seconds,
            wallSeconds: result.wall, width: encoded.width, height: encoded.height)
        return HandCutCutOutput(
            file: file, plannedStarts: offsets,
            compositionStarts: compositionStarts, measuredStarts: result.firstFrames)
    }

    // MARK: - A clip

    /// Encode one clip window (source seconds) at `width` wide as displayed,
    /// height to the displayed aspect and even, like the Mac's
    /// `scale=720:-2`. Read straight from the source rather than from the
    /// cut, so clips do not wait for the cut to finish.
    static func encodeClip(
        source: URL, window: TimeWindow, to output: URL,
        videoBitrate: Int, audioBitrate: Int = clipAudioBitrate,
        width: Int = HandCutPlan.clipWidth,
        cancel: HandCutCancel,
        progress: @escaping @Sendable (Double) -> Void
    ) async throws -> HandCutFileOutput {
        let asset = AVURLAsset(url: source, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        guard let sourceVideo = try await asset.loadTracks(withMediaType: .video).first else {
            throw HandCutEncoderError.noVideoTrack
        }
        let sourceAudio = try await asset.loadTracks(withMediaType: .audio).first
        let (size, transform, fps, videoRange, naturalTimeScale) = try await sourceVideo.load(
            .naturalSize, .preferredTransform, .nominalFrameRate, .timeRange, .naturalTimeScale)
        let audioFormat = try await audioShape(sourceAudio)
        let clamped = HandCutPlan.normalized([window], duration: videoRange.end.seconds)
        guard let span = clamped.first else { throw HandCutEncoderError.emptyPlan }
        let timescale = max(600, naturalTimeScale)
        let range = CMTimeRange(
            start: CMTime(seconds: span.start, preferredTimescale: timescale),
            end: CMTime(seconds: span.end, preferredTimescale: timescale))

        let degrees = rotationDegrees(transform)
        let target = HandCutPlan.clipEncodedSize(
            naturalWidth: Double(size.width), naturalHeight: Double(size.height),
            rotated: degrees % 180 != 0, targetWidth: width)
        let orientation = orientedTransform(degrees: degrees, width: target.width, height: target.height)

        let reader: AVAssetReader
        do { reader = try AVAssetReader(asset: asset) } catch {
            throw HandCutEncoderError.readFailed(describe(error))
        }
        reader.timeRange = range
        let videoOut = AVAssetReaderTrackOutput(track: sourceVideo, outputSettings: decodedPixels)
        videoOut.alwaysCopiesSampleData = false
        guard reader.canAdd(videoOut) else { throw HandCutEncoderError.readFailed("video output") }
        reader.add(videoOut)
        var audioOut: AVAssetReaderOutput?
        if let sourceAudio, let audioFormat {
            let out = AVAssetReaderTrackOutput(track: sourceAudio, outputSettings: pcmSettings(audioFormat))
            out.alwaysCopiesSampleData = false
            if reader.canAdd(out) {
                reader.add(out)
                audioOut = out
            }
        }

        let writer = try makeWriter(output)
        let videoIn = try makeVideoInput(
            writer: writer, width: target.width, height: target.height,
            fps: Double(fps), bitrate: videoBitrate, scaled: true, transform: orientation)
        let audioIn = try audioOut == nil ? nil : makeAudioInput(
            writer: writer, shape: audioFormat!, bitrate: audioBitrate)

        let job = Job(reader: reader, writer: writer, videoOut: videoOut, audioOut: audioOut,
                      videoIn: videoIn, audioIn: audioIn)
        let result = try await pump(
            job, sessionStart: range.start, sessionEnd: range.end, cancel: cancel,
            segmentStarts: [], progress: progress)
        return HandCutFileOutput(
            url: output, bytes: fileSize(output), mediaSeconds: range.duration.seconds,
            wallSeconds: result.wall, width: target.width, height: target.height)
    }

    // MARK: - The pump

    /// The objects one encode owns, handed whole to the encode queue and
    /// touched nowhere else while it runs.
    private struct Job: @unchecked Sendable {
        let reader: AVAssetReader
        let writer: AVAssetWriter
        let videoOut: AVAssetReaderOutput
        let audioOut: AVAssetReaderOutput?
        let videoIn: AVAssetWriterInput
        let audioIn: AVAssetWriterInput?
    }

    private struct PumpResult: Sendable {
        var wall: Double
        var firstFrames: [Double]
    }

    private static func pump(
        _ job: Job, sessionStart: CMTime, sessionEnd: CMTime, cancel: HandCutCancel,
        segmentStarts: [Double], progress: @escaping @Sendable (Double) -> Void
    ) async throws -> PumpResult {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<PumpResult, Error>) in
            queue.async {
                do {
                    continuation.resume(returning: try runPump(
                        job, sessionStart: sessionStart, sessionEnd: sessionEnd, cancel: cancel,
                        segmentStarts: segmentStarts, progress: progress))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    /// One loop feeds both inputs whenever either will take a sample, so
    /// the writer's interleaving can never wait on an input nobody is
    /// feeding. Runs on `queue`.
    private static func runPump(
        _ job: Job, sessionStart: CMTime, sessionEnd: CMTime, cancel: HandCutCancel,
        segmentStarts: [Double], progress: @Sendable (Double) -> Void
    ) throws -> PumpResult {
        let began = CFAbsoluteTimeGetCurrent()
        let reader = job.reader
        let writer = job.writer
        func abandon() {
            reader.cancelReading()
            writer.cancelWriting()
            try? FileManager.default.removeItem(at: writer.outputURL)
        }
        guard reader.startReading() else {
            let why = describe(reader.error)
            abandon()
            throw HandCutEncoderError.readFailed(why)
        }
        guard writer.startWriting() else {
            let why = describe(writer.error)
            abandon()
            throw HandCutEncoderError.writeFailed(why)
        }
        writer.startSession(atSourceTime: sessionStart)

        let span = max(0.001, (sessionEnd - sessionStart).seconds)
        var firstFrames: [Double] = []
        var nextSegment = 0
        var videoDone = false
        var audioDone = job.audioOut == nil
        var lastReported = -1.0

        while !(videoDone && audioDone) {
            if cancel.isCancelled {
                abandon()
                throw HandCutEncoderError.cancelled
            }
            var moved = false
            if !videoDone && job.videoIn.isReadyForMoreMediaData {
                moved = true
                if let sample = job.videoOut.copyNextSampleBuffer() {
                    let pts = CMSampleBufferGetPresentationTimeStamp(sample)
                    if pts.isNumeric {
                        let t = pts.seconds
                        while nextSegment < segmentStarts.count, t >= segmentStarts[nextSegment] - 0.0005 {
                            firstFrames.append(t)
                            nextSegment += 1
                        }
                        let fraction = min(1, max(0, (t - sessionStart.seconds) / span))
                        if fraction - lastReported >= 0.005 {
                            lastReported = fraction
                            progress(fraction)
                        }
                    }
                    if !job.videoIn.append(sample) {
                        let why = describe(writer.error)
                        abandon()
                        throw HandCutEncoderError.writeFailed(why)
                    }
                } else {
                    job.videoIn.markAsFinished()
                    videoDone = true
                }
            }
            if !audioDone, let audioIn = job.audioIn, let audioOut = job.audioOut,
               audioIn.isReadyForMoreMediaData {
                moved = true
                if let sample = audioOut.copyNextSampleBuffer() {
                    if !audioIn.append(sample) {
                        let why = describe(writer.error)
                        abandon()
                        throw HandCutEncoderError.writeFailed(why)
                    }
                } else {
                    audioIn.markAsFinished()
                    audioDone = true
                }
            }
            if !moved {
                if reader.status == .failed {
                    let why = describe(reader.error)
                    abandon()
                    throw HandCutEncoderError.readFailed(why)
                }
                if writer.status == .failed {
                    let why = describe(writer.error)
                    abandon()
                    throw HandCutEncoderError.writeFailed(why)
                }
                usleep(1_000)
            }
        }
        if reader.status == .failed {
            let why = describe(reader.error)
            abandon()
            throw HandCutEncoderError.readFailed(why)
        }
        writer.endSession(atSourceTime: sessionEnd)
        let done = DispatchSemaphore(value: 0)
        writer.finishWriting { done.signal() }
        done.wait()
        guard writer.status == .completed else {
            let why = describe(writer.error)
            try? FileManager.default.removeItem(at: writer.outputURL)
            throw HandCutEncoderError.writeFailed(why)
        }
        progress(1)
        return PumpResult(wall: CFAbsoluteTimeGetCurrent() - began, firstFrames: firstFrames)
    }

    // MARK: - Settings

    private static let decodedPixels: [String: Any] = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
        kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
    ]

    private struct AudioShape: Sendable {
        var sampleRate: Double
        var channels: Int
    }

    /// AAC wants 44.1 or 48 kHz here, and the Mac writes stereo at most.
    private static func audioShape(_ track: AVAssetTrack?) async throws -> AudioShape? {
        guard let track else { return nil }
        let desc = try await track.load(.formatDescriptions).first
        let asbd = desc.flatMap { CMAudioFormatDescriptionGetStreamBasicDescription($0)?.pointee }
        let rate = asbd?.mSampleRate == 44_100 ? 44_100.0 : 48_000.0
        let channels = (asbd.map { Int($0.mChannelsPerFrame) } ?? 2) >= 2 ? 2 : 1
        return AudioShape(sampleRate: rate, channels: channels)
    }

    private static func channelLayout(_ channels: Int) -> Data {
        var layout = AudioChannelLayout()
        layout.mChannelLayoutTag = channels == 1 ? kAudioChannelLayoutTag_Mono : kAudioChannelLayoutTag_Stereo
        return Data(bytes: &layout, count: MemoryLayout<AudioChannelLayout>.size)
    }

    private static func pcmSettings(_ shape: AudioShape) -> [String: Any] {
        [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
            AVSampleRateKey: shape.sampleRate,
            AVNumberOfChannelsKey: shape.channels,
            AVChannelLayoutKey: channelLayout(shape.channels),
        ]
    }

    private static func makeWriter(_ output: URL) throws -> AVAssetWriter {
        try? FileManager.default.removeItem(at: output)
        let writer: AVAssetWriter
        do { writer = try AVAssetWriter(outputURL: output, fileType: .mp4) } catch {
            throw HandCutEncoderError.writeFailed(describe(error))
        }
        // The moov index at the front, like the Mac's +faststart: a player
        // can start and seek without fetching the tail of the file first.
        writer.shouldOptimizeForNetworkUse = true
        return writer
    }

    private static func makeVideoInput(
        writer: AVAssetWriter, width: Int, height: Int, fps: Double, bitrate: Int,
        scaled: Bool, transform: CGAffineTransform
    ) throws -> AVAssetWriterInput {
        let rate = fps.isFinite && fps > 1 ? fps : 30
        var settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: bitrate,
                // Both limits, consistent with each other: 60 frames is 2 s
                // at 30 fps and 1 s at 60 fps.
                AVVideoMaxKeyFrameIntervalKey: HandCutPlan.keyframeFrames,
                AVVideoMaxKeyFrameIntervalDurationKey: HandCutPlan.keyframeSeconds(fps: rate),
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoH264EntropyModeKey: AVVideoH264EntropyModeCABAC,
                AVVideoExpectedSourceFrameRateKey: Int(rate.rounded()),
            ] as [String: Any],
        ]
        if scaled { settings[AVVideoScalingModeKey] = AVVideoScalingModeResizeAspectFill }
        guard writer.canApply(outputSettings: settings, forMediaType: .video) else {
            throw HandCutEncoderError.unsupportedSettings("H.264 \(width)x\(height) at \(bitrate / 1000) kbps")
        }
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = false
        input.transform = transform
        guard writer.canAdd(input) else { throw HandCutEncoderError.unsupportedSettings("video input") }
        writer.add(input)
        return input
    }

    private static func makeAudioInput(
        writer: AVAssetWriter, shape: AudioShape, bitrate: Int
    ) throws -> AVAssetWriterInput? {
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: shape.sampleRate,
            AVNumberOfChannelsKey: shape.channels,
            AVEncoderBitRateKey: bitrate,
            AVChannelLayoutKey: channelLayout(shape.channels),
        ]
        // A source whose sound the encoder will not take still gets its
        // picture; a silent cut beats no cut.
        guard writer.canApply(outputSettings: settings, forMediaType: .audio) else { return nil }
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        input.expectsMediaDataInRealTime = false
        guard writer.canAdd(input) else { return nil }
        writer.add(input)
        return input
    }

    // MARK: - Geometry

    /// The file's quarter-turns, from its display matrix.
    static func rotationDegrees(_ t: CGAffineTransform) -> Int {
        let degrees = Int((atan2(t.b, t.a) * 180 / .pi).rounded())
        return ((degrees % 360) + 360) % 360 / 90 * 90
    }

    /// A clean display matrix for an encoded frame of this size. The
    /// source's own matrix carries a translation for ITS size, which is
    /// wrong once the frame is scaled.
    static func orientedTransform(degrees: Int, width: Int, height: Int) -> CGAffineTransform {
        let w = CGFloat(width)
        let h = CGFloat(height)
        switch degrees {
        case 90: return CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: h, ty: 0)
        case 180: return CGAffineTransform(a: -1, b: 0, c: 0, d: -1, tx: w, ty: h)
        case 270: return CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: w)
        default: return .identity
        }
    }

    private static func evenSize(width: Int, height: Int) -> (width: Int, height: Int) {
        (max(2, width / 2 * 2), max(2, height / 2 * 2))
    }

    // MARK: - Helpers

    static func fileSize(_ url: URL) -> Int64 {
        (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64).flatMap { $0 } ?? 0
    }

    private static func fourCC(_ code: FourCharCode) -> String {
        let bytes = [24, 16, 8, 0].map { UInt8((code >> $0) & 0xFF) }
        return String(bytes: bytes, encoding: .ascii)?.trimmingCharacters(in: .whitespaces) ?? "\(code)"
    }

    /// Domain, code and the underlying error, because "The operation could
    /// not be completed" is what a backgrounded encoder usually says and
    /// the code is the only part that tells two causes apart.
    static func describe(_ error: Error?) -> String {
        guard let error else { return "unknown error" }
        let ns = error as NSError
        var text = "\(ns.domain) \(ns.code): \(ns.localizedDescription)"
        if let reason = ns.localizedFailureReason { text += " (\(reason))" }
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError {
            text += " <- \(underlying.domain) \(underlying.code)"
        }
        return text
    }
}
