import AVFoundation
import Foundation
import Speech

// Turning the lesson's segments into one transcript.
//
// Two tiers, meeting at a single string per segment:
//
//   On device  SpeechAnalyzer, iPhone 12 and later. Free, private, works
//              with no signal at all, which is what a club basement is.
//   Server     Every other device, and every on-device failure. The
//              segment goes to /api/transcribe, which is already the
//              journal's dictation path.
//
// The server tier is not a concession to old phones. It is the retry path
// this needs anyway: the locale asset may not be installed, the language
// may not be supported, and on-device work can fail halfway through. Once
// it exists, serving the four remaining A13 devices with it costs nothing.
//
// Segments are transcribed as they close, so when the lesson ends the work
// left is one segment rather than two hours of it.

@Observable
final class LessonTranscriber {

    enum Tier: Equatable {
        case onDevice
        case server
    }

    enum SegmentState: Equatable {
        case waiting
        case running
        case done(String)
        /// Both tiers refused it. The lesson continues without this piece
        /// rather than failing whole.
        case failed
    }

    private(set) var tier: Tier = .server
    private(set) var states: [UUID: SegmentState] = [:]
    private(set) var preparing = false
    private(set) var errorMessage: String?

    private var order: [LessonSegment] = []
    private var locale: Locale?
    private var running: Set<UUID> = []

    var finishedCount: Int {
        states.values.filter {
            if case .waiting = $0 { return false }
            if case .running = $0 { return false }
            return true
        }.count
    }

    var totalCount: Int { order.count }

    var allSettled: Bool {
        !order.isEmpty && finishedCount == order.count
    }

    /// Every segment's words, in the order they were spoken. Segments that
    /// failed are simply absent — a transcript with a hole in it is far
    /// more use than no transcript.
    var joined: String {
        order.compactMap { segment in
            if case .done(let text) = states[segment.id] {
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty ? nil : trimmed
            }
            return nil
        }.joined(separator: " ")
    }

    var failedCount: Int {
        states.values.filter { $0 == .failed }.count
    }

    // MARK: - Preparation

    /// Work out which tier this phone gets, and pull the language assets
    /// down if they are missing.
    ///
    /// Called before the lesson starts, never at the moment someone taps
    /// record: the asset download is a network operation, and a club is
    /// the worst possible place to discover that.
    func prepare() async {
        preparing = true
        defer { preparing = false }

        guard SpeechTranscriber.isAvailable else {
            // iPhone 11 and SE 2 land here. Not an error, just the other
            // tier, and the person never needs to know.
            tier = .server
            return
        }

        let wanted = Locale.current
        guard let supported = await SpeechTranscriber.supportedLocale(equivalentTo: wanted) else {
            tier = .server
            return
        }
        locale = supported

        let installed = await SpeechTranscriber.installedLocales
        let haveIt = installed.contains { $0.identifier(.bcp47) == supported.identifier(.bcp47) }
        if !haveIt {
            let module = Self.makeTranscriber(locale: supported)
            do {
                if let request = try await AssetInventory
                    .assetInstallationRequest(supporting: [module]) {
                    try await request.downloadAndInstall()
                }
            } catch {
                // No assets, no on-device work. The server tier covers it.
                tier = .server
                return
            }
        }
        tier = .onDevice
    }

    // MARK: - Work

    func enqueue(_ segments: [LessonSegment]) {
        for segment in segments where states[segment.id] == nil {
            order.append(segment)
            states[segment.id] = .waiting
        }
        order.sort { $0.index < $1.index }
        pump()
    }

    /// One segment at a time. Transcription is the heaviest thing the phone
    /// is doing during a lesson, and running several at once on an older
    /// device buys nothing but heat.
    private func pump() {
        guard running.isEmpty else { return }
        guard let next = order.first(where: { states[$0.id] == .waiting }) else { return }
        states[next.id] = .running
        running.insert(next.id)
        Task { await work(next) }
    }

    private func work(_ segment: LessonSegment) async {
        var text: String?

        if tier == .onDevice {
            text = try? await Self.onDevice(segment.url, locale: locale ?? .current)
        }
        if text == nil {
            text = try? await Self.viaServer(segment.url)
        }

        running.remove(segment.id)
        // The lesson may have been started over while this was running, in
        // which case the segment it belongs to no longer exists and writing
        // a result for it would resurrect a dead row.
        guard states[segment.id] != nil else { return }
        if let text {
            states[segment.id] = .done(text)
        } else {
            states[segment.id] = .failed
            errorMessage = "Part of the lesson couldn't be transcribed. The rest is here."
        }
        pump()
    }

    /// Run everything that produced no words again, once the lesson is over
    /// and there may be a better network than the hall had.
    func retry() {
        errorMessage = nil
        if requeueEmpty() > 0 { pump() }
    }

    /// Hand the whole lesson to the server after the phone heard nothing.
    ///
    /// An on-device pass that returns an empty string looks identical
    /// whether the room was silent or the transcriber quietly gave up
    /// halfway — a missing locale asset, a model that never loaded. Before
    /// anyone is told their lesson has no words in it, the other tier gets
    /// one turn. Only when EVERY segment came back empty, so a lesson that
    /// worked never pays for this.
    ///
    /// Returns false when there is no other tier left to try, which is how
    /// the caller knows to stop waiting.
    func escalateToServer() -> Bool {
        guard tier == .onDevice else { return false }
        guard requeueEmpty() > 0 else { return false }
        tier = .server
        pump()
        return true
    }

    /// Put every segment that produced no words back in the queue, and say
    /// how many there were.
    ///
    /// Both states count. A segment that transcribed cleanly to an empty
    /// string sits in `.done("")`, which is not `.failed` — so a retry that
    /// only reset failures could reset nothing, change no state and start
    /// no work, leaving a screen waiting on a result that was never
    /// coming. That is precisely what a lesson recorded in silence
    /// produces.
    private func requeueEmpty() -> Int {
        var count = 0
        for (id, state) in states {
            switch state {
            case .failed:
                states[id] = .waiting
                count += 1
            case .done(let text)
                where text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty:
                states[id] = .waiting
                count += 1
            default:
                break
            }
        }
        return count
    }

    /// Forget the lesson entirely, for one that is being started over. The
    /// old segments' files are gone by then, so their states must go too.
    func reset() {
        order = []
        states = [:]
        running = []
        errorMessage = nil
    }

    // MARK: - Tiers

    private static func makeTranscriber(locale: Locale) -> SpeechTranscriber {
        // Explicit options rather than a preset, and reportingOptions is
        // deliberately empty. `volatileResults` would stream partial text
        // that later gets superseded, and concatenating those would repeat
        // half the lesson. Finals only.
        SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [],
            attributeOptions: []
        )
    }

    private static func onDevice(_ url: URL, locale: Locale) async throws -> String {
        let transcriber = makeTranscriber(locale: locale)
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let file = try AVAudioFile(forReading: url)

        // The results sequence has to be drained while the analysis runs,
        // not after it: it finishes when the analyzer does.
        let collector = Task { () -> String in
            var out = AttributedString()
            for try await result in transcriber.results {
                out += result.text
            }
            return String(out.characters)
        }

        do {
            _ = try await analyzer.analyzeSequence(from: file)
            try await analyzer.finalizeAndFinishThroughEndOfInput()
        } catch {
            collector.cancel()
            throw error
        }
        return try await collector.value
    }

    private struct TranscribeResponse: Decodable {
        let transcript: String?
    }

    private static func viaServer(_ url: URL) async throws -> String {
        let data = try Data(contentsOf: url)
        // A five-minute AAC segment at 32 kbps is about 1.2 MB, which sits
        // under both this route's own 10 MB cap and Vercel's 4.5 MB body
        // limit. That is why the segments can be posted directly instead of
        // going the presigned-PUT route the video uploads need.
        let response: TranscribeResponse = try await API.postMultipart(
            "api/transcribe",
            field: "audio",
            filename: url.lastPathComponent,
            mime: "audio/mp4",
            data: data,
            // Ephemeral: the bytes are transcribed and dropped, never
            // written to R2 or anyone's storage ledger.
            fields: ["persist": "false"]
        )
        // An empty transcript is a legitimate answer: the route heard the
        // segment and there was no speech in it. Throwing here would file
        // silence as a failure, and the screen would offer a retry that
        // could never succeed instead of saying nothing was picked up.
        // Real failures are the ones that threw above this line.
        return response.transcript ?? ""
    }
}
