import AVFoundation
import Foundation
import Speech
import UIKit

/// Listening for a game score called out at the phone during a match.
///
/// The design constraint that shapes everything here is that a hall is
/// loud and full of the word "game". Three filters run in order, cheapest
/// first, and each one throws away nearly everything the next would have
/// had to think about:
///
///   1. Loud and close. Plain arithmetic on buffers the capture session is
///      already handing us. Somebody calling a score two tables away never
///      crosses it, so the speech model never wakes for them and never
///      spends a joule on them.
///   2. The phrase. "Game three score", three ordinary words.
///   3. A score a game can actually end on. See SpokenScore.
///
/// Nothing that fails a filter is written down, and no transcript is ever
/// stored or sent anywhere. The only thing that survives is the numbers.
@Observable
final class ScoreListener {

    /// The rules and the board live in ScoreCapture, which has no audio
    /// in it and is tested the way ScoreLogic is. This class is only the
    /// plumbing that feeds it: microphone, gate, recogniser.
    private var capture = ScoreCapture()

    var scores: [SpokenGameScore] { capture.scores }
    var missedGame: Int? { capture.missedGame }
    /// The recogniser's text for approaches that captured nothing. Debug
    /// only, in memory only, shown behind a long-press on the strip.
    var heardLog: [String] { capture.heardLog }
    /// Somebody is at the phone: the gate is open. Drives the one live
    /// thing on screen, and needs no speech recognition to be true.
    private(set) var hearing = false
    /// Recording is paused. People wander over and chat near a paused
    /// phone; nothing said then is a score being reported.
    var suspended = false {
        didSet { if suspended, openSince != nil { closeWindow() } }
    }
    /// Why this cannot run at all, if it cannot. Shown once, quietly.
    private(set) var unavailable: String?
    private(set) var running = false

    /// Below this the room is just the room. Peak amplitude, so it is
    /// independent of how long the buffer is.
    private static let openLevel: Float = 0.12
    /// Hysteresis: once someone is speaking, hold the gate open through
    /// the gaps between their words.
    private static let holdLevel: Float = 0.05
    /// Quiet for this long and the utterance is over.
    private static let hangoverS = 1.6
    /// Once open, stay open at least this long however quiet it goes.
    /// "Game one ... score eleven five" has a pause in the middle of it,
    /// and a gate that shut in the gap would hand the recogniser two
    /// fragments where the phrase only means anything whole.
    private static let minOpenS = 4.0
    /// Fed in ahead of the gate opening, so the first word is not clipped.
    private static let prerollS = 0.7

    private var locale: Locale?
    private var transcriber: SpeechTranscriber?
    private var analyzer: SpeechAnalyzer?
    private var continuation: AsyncStream<AnalyzerInput>.Continuation?
    private var results: Task<Void, Never>?
    private var converter: AVAudioConverter?
    private var targetFormat: AVAudioFormat?
    private var sourceFormat: AVAudioFormat?

    /// Recent audio, kept only long enough to cover the gate's own
    /// reaction time. Never written to disk.
    private var preroll: [AVAudioPCMBuffer] = []
    private var prerollFrames: AVAudioFrameCount = 0
    private var openSince: Date?
    private var lastLoud: Date?
    private var missTimer: Task<Void, Never>?
    /// Set when a window has closed and its final text has not arrived.
    /// If the recogniser never delivers one — the failure that made 7-11
    /// vanish without a trace — this settles the window from its own
    /// volatiles, so a heard phrase ALWAYS leaves a verdict: a score, a
    /// ?? row, or a line in the debug log. Never silence.
    private var settleFallback: Task<Void, Never>?

    // MARK: - Availability

    /// Work out whether this phone can do the work, and fetch the language
    /// assets if they are missing.
    ///
    /// Called when the record screen opens, never at the moment the
    /// shutter is pressed: the download needs a network, and a club is the
    /// worst possible place to find that out.
    func prepare() async {
        guard SpeechTranscriber.isAvailable else {
            unavailable = "This needs an iPhone 12 or newer."
            return
        }
        guard let supported = await SpeechTranscriber
            .supportedLocale(equivalentTo: Locale.current) else {
            unavailable = "Not available in this language yet."
            return
        }
        locale = supported

        let installed = await SpeechTranscriber.installedLocales
        let have = installed.contains {
            $0.identifier(.bcp47) == supported.identifier(.bcp47)
        }
        if !have {
            let module = Self.makeTranscriber(locale: supported)
            do {
                if let request = try await AssetInventory
                    .assetInstallationRequest(supporting: [module]) {
                    try await request.downloadAndInstall()
                }
            } catch {
                unavailable = "The language pack couldn't be downloaded."
                return
            }
        }
        unavailable = nil
    }

    // MARK: - A match

    /// A new recording is starting: wipe the board. The scores of the
    /// previous match were handed to its details sheet when it stopped,
    /// and without this they haunt the next one.
    func beginSession() {
        capture.beginSession()
        missTimer?.cancel()
        settleFallback?.cancel()
    }

    func start() async {
        guard !running, unavailable == nil else { return }
        // Prepare here too, not only when the screen opened. Someone who
        // switches the setting on from the record screen's own settings
        // sheet never passes that earlier call, and without this the
        // listener returns silently at the shutter: no scores, and no
        // banner either, because nothing had failed yet. That is the
        // first thing anybody does with a new setting.
        if locale == nil { await prepare() }
        guard unavailable == nil, let locale else { return }

        let transcriber = Self.makeTranscriber(locale: locale)
        // Tell the recogniser what is coming instead of only widening our
        // own word lists after each mishearing. The phrases and number
        // words bias it toward "game three score eleven seven" over the
        // English it would otherwise prefer ("7-Eleven", "eleven too").
        let context = AnalysisContext()
        context.contextualStrings = [.general: Self.expectedPhrases]
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        // Biasing is best effort: a context the analyzer refuses loses
        // the nudge, not the feature.
        try? await analyzer.setContext(context)
        guard let format = await SpeechAnalyzer
            .bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
            unavailable = "The recogniser wouldn't start."
            return
        }

        // Bounded, and dropping the OLDEST when it fills. Unbounded is the
        // default and the wrong choice against a live microphone: if the
        // recogniser ever falls behind the room, an unbounded queue grows
        // for the rest of the match and takes the app down with it. Two
        // seconds of audio is far more headroom than it needs, and losing
        // the far side of that is better than losing the recording.
        let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream(
            bufferingPolicy: .bufferingNewest(100))
        do {
            try await analyzer.start(inputSequence: stream)
        } catch {
            unavailable = "The recogniser wouldn't start."
            return
        }

        self.transcriber = transcriber
        self.analyzer = analyzer
        self.continuation = continuation
        self.targetFormat = format
        self.running = true

        // Drained as the analyzer runs, not after: the sequence ends when
        // the analyzer does.
        results = Task { [weak self] in
            do {
                for try await result in transcriber.results {
                    let said = String(result.text.characters)
                    if result.isFinal {
                        await self?.windowSettled(said)
                    } else {
                        await self?.windowHeard(said)
                    }
                }
            } catch {
                // A recogniser that gives up mid-match takes the feature
                // down with it and nothing else. The recording is
                // untouched, which is the only thing that must not break.
                await self?.fail()
            }
        }
    }

    /// The capture session would not give up a second read of the
    /// microphone, so there is nothing to listen to.
    func reportNoMicrophone() {
        unavailable = "The microphone is busy."
    }

    func stop() {
        continuation?.finish()
        continuation = nil
        let analyzer = analyzer
        Task { try? await analyzer?.finalizeAndFinishThroughEndOfInput() }
        self.analyzer = nil
        transcriber = nil
        results?.cancel()
        results = nil
        converter = nil
        sourceFormat = nil
        preroll = []
        prerollFrames = 0
        openSince = nil
        lastLoud = nil
        hearing = false
        running = false
        missTimer?.cancel()
        missTimer = nil
        settleFallback?.cancel()
        settleFallback = nil
    }

    // MARK: - Corrections

    /// The likeliest mistake by far is the pair arriving the wrong way
    /// round, so tapping a row swaps it rather than deleting it. The
    /// capture also locks the game against the stream until the next
    /// approach, so stale text cannot quietly undo the tap.
    func swapSides(game: Int) {
        capture.swap(game: game)
    }

    func clearMiss() {
        missTimer?.cancel()
        capture.clearMiss()
    }

    // MARK: - Audio

    /// One buffer from the capture session, on its own queue.
    ///
    /// Deliberately does the loudness test before anything else: this runs
    /// for every buffer of a 45-minute match, and for all but a few
    /// seconds of it the answer is "nobody is there" and the work stops on
    /// the next line.
    nonisolated func ingest(_ sampleBuffer: CMSampleBuffer) {
        guard let pcm = Self.pcm(from: sampleBuffer) else { return }
        let peak = Self.peak(of: pcm)
        Task { @MainActor [weak self] in
            self?.gate(pcm, peak: peak)
        }
    }

    private func gate(_ buffer: AVAudioPCMBuffer, peak: Float) {
        guard running, !suspended else { return }
        let now = Date()
        let open = openSince != nil

        if peak >= (open ? Self.holdLevel : Self.openLevel) {
            lastLoud = now
            if !open {
                openSince = now
                hearing = true
                settleFallback?.cancel()
                capture.windowOpened()
                // Everything held back, so "game one" is not lost to the
                // gate's own reaction time.
                for held in preroll { feed(held) }
                preroll = []
                prerollFrames = 0
            }
        }

        if openSince != nil {
            feed(buffer)
            let held = now.timeIntervalSince(openSince ?? now)
            if held > Self.minOpenS, let last = lastLoud,
               now.timeIntervalSince(last) > Self.hangoverS {
                closeWindow()
            }
        } else {
            hold(buffer)
        }
    }

    private func closeWindow() {
        openSince = nil
        hearing = false
        let analyzer = analyzer
        // Flush rather than wait: the recogniser would otherwise sit on
        // the last phrase until the next time somebody spoke, which for a
        // score called at the end of a game could be several minutes.
        Task { try? await analyzer?.finalize(through: nil) }
        // And if that flush quietly does nothing — it is a try? for a
        // reason — settle the window from its own volatiles. Two seconds
        // is enough for a real final to arrive first and cancel this.
        settleFallback?.cancel()
        settleFallback = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            self?.windowSettled(nil)
        }
    }

    /// A rolling window of the most recent audio, dropped as it ages.
    private func hold(_ buffer: AVAudioPCMBuffer) {
        preroll.append(buffer)
        prerollFrames += buffer.frameLength
        let limit = AVAudioFrameCount(buffer.format.sampleRate * Self.prerollS)
        while prerollFrames > limit, !preroll.isEmpty {
            prerollFrames -= preroll.removeFirst().frameLength
        }
    }

    private func feed(_ buffer: AVAudioPCMBuffer) {
        guard let continuation, let converted = convert(buffer) else { return }
        continuation.yield(AnalyzerInput(buffer: converted))
    }

    /// Capture hands out whatever the hardware likes; the analyzer wants
    /// its own format. The converter is built once, on the first buffer,
    /// because the source format is not known until then.
    private func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let targetFormat else { return nil }
        if buffer.format == targetFormat { return buffer }
        if converter == nil || sourceFormat != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: targetFormat)
            sourceFormat = buffer.format
        }
        guard let converter else { return nil }
        let ratio = targetFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat,
                                         frameCapacity: capacity) else { return nil }
        var supplied = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if supplied {
                status.pointee = .noDataNow
                return nil
            }
            supplied = true
            status.pointee = .haveData
            return buffer
        }
        return error == nil && out.frameLength > 0 ? out : nil
    }

    // MARK: - Words

    private func windowHeard(_ said: String) {
        react(to: capture.heard(said))
    }

    private func windowSettled(_ said: String?) {
        settleFallback?.cancel()
        settleFallback = nil
        react(to: capture.settled(said))
    }

    private func react(to event: ScoreCapture.Event?) {
        switch event {
        case .captured:
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        case .missed:
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
            // Long enough to read while still standing at the phone, then
            // gone. The ?? row on the board is what persists; a nag that
            // is still on screen twenty minutes later is just noise.
            missTimer?.cancel()
            missTimer = Task { [weak self] in
                try? await Task.sleep(for: .seconds(20))
                guard !Task.isCancelled else { return }
                self?.capture.clearMiss()
            }
        case nil:
            break
        }
    }

    private func fail() {
        unavailable = "Stopped listening."
        stop()
    }

    // MARK: - Plumbing

    /// What the recogniser is told to expect. The trigger in every game
    /// number, plus the score numbers as words — built from the parser's
    /// own vocabulary so the two can never drift apart.
    static let expectedPhrases: [String] = {
        var phrases = (1...SpokenScore.maxGame).map {
            SpokenScore.examplePhrase(game: $0)
        }
        phrases += ["game", "score", "eleven", "twelve", "thirteen",
                    "fourteen", "fifteen", "deuce", "zero", "seven eleven",
                    "eleven seven"]
        return phrases
    }()

    private static func makeTranscriber(locale: Locale) -> SpeechTranscriber {
        // Results as they form, not only when the recogniser decides an
        // utterance has ended.
        //
        // This was finals-only, which is what a transcript wants and the
        // wrong thing entirely here. Streaming in, a final arrives when
        // the analyzer says so or when the input ends — and the input is
        // a whole match. Nothing came out at all until the recording
        // stopped. Half-formed text is harmless in this direction:
        // "game one score eleven" is not a legal score, so it simply
        // does not parse, and the badge shows nothing until the phrase
        // is complete enough to be right.
        SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [.volatileResults],
            attributeOptions: []
        )
    }

    private nonisolated static func pcm(
        from sampleBuffer: CMSampleBuffer
    ) -> AVAudioPCMBuffer? {
        guard let description = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(description),
              let format = AVAudioFormat(streamDescription: asbd)
        else { return nil }
        let frames = CMSampleBufferGetNumSamples(sampleBuffer)
        guard frames > 0,
              let buffer = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: AVAudioFrameCount(frames))
        else { return nil }
        buffer.frameLength = AVAudioFrameCount(frames)
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            sampleBuffer, at: 0, frameCount: Int32(frames),
            into: buffer.mutableAudioBufferList)
        return status == noErr ? buffer : nil
    }

    /// Loudest sample in the buffer. Capture gives 16-bit integers on some
    /// devices and floats on others, so both are read; anything else is
    /// treated as silence rather than guessed at.
    private nonisolated static func peak(of buffer: AVAudioPCMBuffer) -> Float {
        let frames = Int(buffer.frameLength)
        guard frames > 0 else { return 0 }
        let channels = Int(buffer.format.channelCount)
        var loudest: Float = 0
        if let data = buffer.floatChannelData {
            for channel in 0..<channels {
                let samples = data[channel]
                for frame in 0..<frames {
                    loudest = max(loudest, abs(samples[frame]))
                }
            }
        } else if let data = buffer.int16ChannelData {
            for channel in 0..<channels {
                let samples = data[channel]
                for frame in 0..<frames {
                    loudest = max(loudest, abs(Float(samples[frame]) / 32768))
                }
            }
        }
        return loudest
    }
}
