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
        if let text {
            states[segment.id] = .done(text)
        } else {
            states[segment.id] = .failed
            errorMessage = "Part of the lesson couldn't be transcribed. The rest is here."
        }
        pump()
    }

    /// Retry everything that failed, once the lesson is over and there may
    /// be a better network than the hall had.
    func retryFailed() {
        for (id, state) in states where state == .failed {
            states[id] = .waiting
        }
        errorMessage = nil
        pump()
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
        guard let transcript = response.transcript,
              !transcript.trimmingCharacters(in: .whitespaces).isEmpty else {
            throw NSError(domain: "LessonTranscriber", code: 1)
        }
        return transcript
    }
}
