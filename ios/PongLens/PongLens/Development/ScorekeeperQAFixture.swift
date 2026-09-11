#if DEBUG && targetEnvironment(simulator)
import Foundation
import Supabase
import SwiftUI

nonisolated struct ScorekeeperQAConfiguration: Equatable, Sendable {
    let delayMilliseconds: Int
    let failureOrdinal: Int?
    let startPoint: Int

    static func parse(arguments: [String]) -> ScorekeeperQAConfiguration? {
        guard arguments.contains("--qa-scorekeeper") else { return nil }
        func integer(after flag: String) -> Int? {
            guard let index = arguments.firstIndex(of: flag),
                  arguments.indices.contains(index + 1)
            else { return nil }
            return Int(arguments[index + 1])
        }
        let delay = max(0, min(30_000, integer(after: "--qa-delay-ms") ?? 0))
        let requestedFailure = integer(after: "--qa-fail-write")
        let failure = requestedFailure.flatMap { $0 > 0 ? $0 : nil }
        let requestedStart = integer(after: "--qa-start-point") ?? 2
        let start = (1...3).contains(requestedStart) ? requestedStart : 2
        return ScorekeeperQAConfiguration(
            delayMilliseconds: delay,
            failureOrdinal: failure,
            startPoint: start
        )
    }
}

nonisolated enum ScorekeeperQAIDs {
    static let owner = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
    static let match = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
    static let points = (1...3).map {
        UUID(uuidString: String(format: "33333333-3333-4333-8333-%012d", $0))!
    }
}

nonisolated struct ScorekeeperQAFields: Codable, Equatable, Sendable {
    let confirmedWinner: String?
    let isLet: Bool
    let scoredAtCutS: Double?

    enum CodingKeys: String, CodingKey {
        case confirmedWinner = "confirmed_winner"
        case isLet = "is_let"
        case scoredAtCutS = "scored_at_cut_s"
    }
}

nonisolated struct ScorekeeperQAWrite: Equatable, Sendable {
    let pointID: UUID
    let fields: ScorekeeperQAFields
}

nonisolated enum ScorekeeperQAValidationError: Error, Equatable {
    case unknownRequest
    case invalidPayload
    case eventLogUnavailable
}

nonisolated enum ScorekeeperQARequestValidator {
    static func validate(_ request: URLRequest) throws -> ScorekeeperQAWrite {
        guard request.httpMethod == "PATCH",
              let url = request.url,
              url.scheme == "http",
              url.host == "127.0.0.1",
              url.port == 54321,
              url.path == "/rest/v1/points",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.queryItems?.count == 1,
              let filter = components.queryItems?.first,
              filter.name == "id",
              let value = filter.value,
              value.hasPrefix("eq."),
              let pointID = UUID(uuidString: String(value.dropFirst(3))),
              ScorekeeperQAIDs.points.contains(pointID)
        else { throw ScorekeeperQAValidationError.unknownRequest }

        guard let body = try? bodyData(for: request),
              let object = try? JSONSerialization.jsonObject(with: body),
              let fields = object as? [String: Any],
              Set(fields.keys) == Set([
                "confirmed_winner", "is_let", "scored_at_cut_s",
              ]),
              let isLetNumber = fields["is_let"] as? NSNumber,
              CFGetTypeID(isLetNumber) == CFBooleanGetTypeID()
        else { throw ScorekeeperQAValidationError.invalidPayload }
        let isLet = isLetNumber.boolValue

        let winnerValue = fields["confirmed_winner"]
        let winner: String?
        if winnerValue is NSNull {
            winner = nil
        } else if let string = winnerValue as? String,
                  string == "user" || string == "opponent" {
            winner = string
        } else {
            throw ScorekeeperQAValidationError.invalidPayload
        }

        let scoredValue = fields["scored_at_cut_s"]
        let scoredAt: Double?
        if scoredValue is NSNull {
            scoredAt = nil
        } else if let number = scoredValue as? NSNumber,
                  CFGetTypeID(number) != CFBooleanGetTypeID(),
                  number.doubleValue.isFinite {
            scoredAt = number.doubleValue
        } else {
            throw ScorekeeperQAValidationError.invalidPayload
        }

        guard !isLet || (winner == nil && scoredAt == nil),
              winner != nil || scoredAt == nil
        else { throw ScorekeeperQAValidationError.invalidPayload }

        return ScorekeeperQAWrite(
            pointID: pointID,
            fields: ScorekeeperQAFields(
                confirmedWinner: winner,
                isLet: isLet,
                scoredAtCutS: scoredAt
            )
        )
    }

    /// URLSession represents a data-task body as a stream by the time a
    /// custom URLProtocol receives it. The endpoint and point allowlist are
    /// checked above before this reads anything, and scorer payloads are
    /// deliberately capped to keep an unexpected stream bounded.
    private static func bodyData(for request: URLRequest) throws -> Data {
        if let body = request.httpBody {
            guard body.count <= 4_096 else {
                throw ScorekeeperQAValidationError.invalidPayload
            }
            return body
        }
        guard let stream = request.httpBodyStream else {
            throw ScorekeeperQAValidationError.invalidPayload
        }
        stream.open()
        defer { stream.close() }
        var body = Data()
        var buffer = [UInt8](repeating: 0, count: 1_024)
        while true {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count < 0 {
                throw stream.streamError ?? ScorekeeperQAValidationError.invalidPayload
            }
            if count == 0 { return body }
            guard body.count + count <= 4_096 else {
                throw ScorekeeperQAValidationError.invalidPayload
            }
            body.append(buffer, count: count)
        }
    }
}

nonisolated enum ScorekeeperQAEventPhase: String, Codable, Equatable, Sendable {
    case submitted
    case accepted
    case failed
    case unexpected
}

nonisolated struct ScorekeeperQAEvent: Codable, Equatable, Sendable {
    let ordinal: Int?
    let phase: ScorekeeperQAEventPhase
    let pointID: UUID?
    let confirmedWinner: String?
    let isLet: Bool?
    let scoredAtCutS: Double?
    let requestMethod: String?
    let requestPath: String?
    let queryKeys: [String]?
    let bodyAvailability: String?

    enum CodingKeys: String, CodingKey {
        case ordinal, phase
        case pointID = "point_id"
        case confirmedWinner = "confirmed_winner"
        case isLet = "is_let"
        case scoredAtCutS = "scored_at_cut_s"
        case requestMethod = "request_method"
        case requestPath = "request_path"
        case queryKeys = "query_keys"
        case bodyAvailability = "body_availability"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(ordinal, forKey: .ordinal)
        try container.encode(phase, forKey: .phase)
        try container.encodeIfPresent(pointID, forKey: .pointID)
        if phase == .unexpected {
            try container.encodeIfPresent(requestMethod, forKey: .requestMethod)
            try container.encodeIfPresent(requestPath, forKey: .requestPath)
            try container.encodeIfPresent(queryKeys, forKey: .queryKeys)
            try container.encodeIfPresent(bodyAvailability, forKey: .bodyAvailability)
            return
        }
        if let confirmedWinner {
            try container.encode(confirmedWinner, forKey: .confirmedWinner)
        } else {
            try container.encodeNil(forKey: .confirmedWinner)
        }
        try container.encode(isLet, forKey: .isLet)
        if let scoredAtCutS {
            try container.encode(scoredAtCutS, forKey: .scoredAtCutS)
        } else {
            try container.encodeNil(forKey: .scoredAtCutS)
        }
    }
}

nonisolated enum ScorekeeperQAResult: String, Equatable, Sendable {
    case accepted
    case failed
}

nonisolated struct ScorekeeperQATransaction: Equatable, Sendable {
    let ordinal: Int
    let write: ScorekeeperQAWrite
    let result: ScorekeeperQAResult
}

nonisolated struct ScorekeeperQASnapshot: Sendable {
    let remote: [UUID: ScorekeeperQAFields]
    let events: [ScorekeeperQAEvent]
    let unexpectedRequestCount: Int
    let eventLogError: String?
}

nonisolated final class ScorekeeperQAStore: @unchecked Sendable {
    let delayMilliseconds: Int
    private let failureOrdinal: Int?
    private let eventsURL: URL
    private let lock = NSLock()
    private var writeOrdinal = 0
    private var remote: [UUID: ScorekeeperQAFields]
    private var events: [ScorekeeperQAEvent] = []
    private var unexpectedRequestCount = 0
    private var eventLogError: String?

    init(delayMilliseconds: Int, failureOrdinal: Int?, eventsURL: URL) {
        self.delayMilliseconds = delayMilliseconds
        self.failureOrdinal = failureOrdinal
        self.eventsURL = eventsURL
        remote = Dictionary(uniqueKeysWithValues: ScorekeeperQAIDs.points.map {
            ($0, ScorekeeperQAFields(
                confirmedWinner: $0 == ScorekeeperQAIDs.points[0] ? "user" : nil,
                isLet: false,
                scoredAtCutS: $0 == ScorekeeperQAIDs.points[0] ? 6 : nil
            ))
        })
        do {
            try FileManager.default.createDirectory(
                at: eventsURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try Data().write(to: eventsURL, options: .atomic)
        } catch {
            eventLogError = String(describing: error)
        }
    }

    func begin(_ request: URLRequest) throws -> ScorekeeperQATransaction {
        let write: ScorekeeperQAWrite
        do {
            write = try ScorekeeperQARequestValidator.validate(request)
        } catch {
            lock.lock()
            unexpectedRequestCount += 1
            appendLocked(ScorekeeperQAEvent(
                ordinal: nil,
                phase: .unexpected,
                pointID: nil,
                confirmedWinner: nil,
                isLet: nil,
                scoredAtCutS: nil,
                requestMethod: request.httpMethod,
                requestPath: request.url?.path,
                queryKeys: URLComponents(
                    url: request.url ?? URL(string: "about:blank")!,
                    resolvingAgainstBaseURL: false
                )?.queryItems?.map(\.name).sorted() ?? [],
                bodyAvailability: bodyAvailability(of: request)
            ))
            lock.unlock()
            throw error
        }

        lock.lock()
        defer { lock.unlock() }
        guard eventLogError == nil else {
            throw ScorekeeperQAValidationError.eventLogUnavailable
        }
        writeOrdinal += 1
        let ordinal = writeOrdinal
        appendLocked(event(.submitted, ordinal: ordinal, write: write))
        guard eventLogError == nil else {
            throw ScorekeeperQAValidationError.eventLogUnavailable
        }
        return ScorekeeperQATransaction(
            ordinal: ordinal,
            write: write,
            result: failureOrdinal == ordinal ? .failed : .accepted
        )
    }

    func finish(_ transaction: ScorekeeperQATransaction) {
        lock.lock()
        defer { lock.unlock() }
        if transaction.result == .accepted {
            remote[transaction.write.pointID] = transaction.write.fields
            appendLocked(event(
                .accepted,
                ordinal: transaction.ordinal,
                write: transaction.write
            ))
        } else {
            appendLocked(event(
                .failed,
                ordinal: transaction.ordinal,
                write: transaction.write
            ))
        }
    }

    func snapshot() -> ScorekeeperQASnapshot {
        lock.lock()
        defer { lock.unlock() }
        return ScorekeeperQASnapshot(
            remote: remote,
            events: events,
            unexpectedRequestCount: unexpectedRequestCount,
            eventLogError: eventLogError
        )
    }

    private func event(
        _ phase: ScorekeeperQAEventPhase,
        ordinal: Int,
        write: ScorekeeperQAWrite
    ) -> ScorekeeperQAEvent {
        ScorekeeperQAEvent(
            ordinal: ordinal,
            phase: phase,
            pointID: write.pointID,
            confirmedWinner: write.fields.confirmedWinner,
            isLet: write.fields.isLet,
            scoredAtCutS: write.fields.scoredAtCutS,
            requestMethod: nil,
            requestPath: nil,
            queryKeys: nil,
            bodyAvailability: nil
        )
    }

    private func bodyAvailability(of request: URLRequest) -> String {
        switch (request.httpBody != nil, request.httpBodyStream != nil) {
        case (true, true): "data+stream"
        case (true, false): "data"
        case (false, true): "stream"
        case (false, false): "none"
        }
    }

    private func appendLocked(_ event: ScorekeeperQAEvent) {
        events.append(event)
        guard eventLogError == nil else { return }
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            var line = try encoder.encode(event)
            line.append(0x0A)
            let handle = try FileHandle(forWritingTo: eventsURL)
            try handle.seekToEnd()
            try handle.write(contentsOf: line)
            try handle.close()
        } catch {
            eventLogError = String(describing: error)
        }
    }
}

nonisolated final class ScorekeeperQAURLProtocol: URLProtocol, @unchecked Sendable {
    private var workItem: DispatchWorkItem?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let store = ScorekeeperQAFixture.store
        do {
            let transaction = try store.begin(request)
            let work = DispatchWorkItem { [weak self] in
                guard let self else { return }
                store.finish(transaction)
                let status = transaction.result == .accepted ? 204 : 503
                let data = transaction.result == .accepted
                    ? Data()
                    : Data(#"{"code":"qa_forced_failure"}"#.utf8)
                self.respond(status: status, data: data)
            }
            workItem = work
            DispatchQueue.global(qos: .userInitiated).asyncAfter(
                deadline: .now() + .milliseconds(store.delayMilliseconds),
                execute: work
            )
        } catch {
            respond(
                status: 403,
                data: Data(#"{"code":"qa_unexpected_request"}"#.utf8)
            )
        }
    }

    override func stopLoading() {
        workItem?.cancel()
        workItem = nil
    }

    private func respond(status: Int, data: Data) {
        guard let url = request.url,
              let response = HTTPURLResponse(
                url: url,
                statusCode: status,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
              )
        else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if !data.isEmpty { client?.urlProtocol(self, didLoad: data) }
        client?.urlProtocolDidFinishLoading(self)
    }
}

nonisolated final class ScorekeeperQAAuthStorage: AuthLocalStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Data] = [:]

    func store(key: String, value: Data) throws {
        lock.lock()
        values[key] = value
        lock.unlock()
    }

    func retrieve(key: String) throws -> Data? {
        lock.lock()
        defer { lock.unlock() }
        return values[key]
    }

    func remove(key: String) throws {
        lock.lock()
        values.removeValue(forKey: key)
        lock.unlock()
    }
}

enum ScorekeeperQAFixture {
    static let configuration = ScorekeeperQAConfiguration.parse(
        arguments: ProcessInfo.processInfo.arguments
    )
    static var isEnabled: Bool { configuration != nil }
    static let loopbackURL = URL(string: "http://127.0.0.1:54321")!
    static let eventsURL = documentsURL.appendingPathComponent(
        "scorekeeper-qa-events.jsonl"
    )
    static let videoURL = documentsURL.appendingPathComponent(
        "scorekeeper-fixture.mp4"
    )
    nonisolated static let store = ScorekeeperQAStore(
        delayMilliseconds: configuration?.delayMilliseconds ?? 0,
        failureOrdinal: configuration?.failureOrdinal,
        eventsURL: eventsURL
    )
    nonisolated static let urlSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.protocolClasses = [ScorekeeperQAURLProtocol.self]
        return URLSession(configuration: configuration)
    }()

    private static let documentsURL = FileManager.default.urls(
        for: .documentDirectory,
        in: .userDomainMask
    )[0]

    static func makeSupabaseClient() -> SupabaseClient {
        SupabaseClient(
            supabaseURL: loopbackURL,
            supabaseKey: "qa-anon-key",
            options: SupabaseClientOptions(
                auth: .init(
                    storage: ScorekeeperQAAuthStorage(),
                    autoRefreshToken: false,
                    emitLocalSessionAsInitialSession: true,
                    accessToken: { "qa-local-token" }
                ),
                global: .init(session: urlSession)
            )
        )
    }

    static func makeAppState() -> AppState {
        let app = AppState()
        let now = Date(timeIntervalSince1970: 1_788_800_000)
        let user = User(
            id: ScorekeeperQAIDs.owner,
            appMetadata: [:],
            userMetadata: ["full_name": .string("QA Player")],
            aud: "authenticated",
            email: "qa-scorekeeper@localhost.invalid",
            createdAt: now,
            confirmedAt: now,
            emailConfirmedAt: now,
            lastSignInAt: now,
            role: "authenticated",
            updatedAt: now
        )
        app.phase = .signedIn(Session(
            accessToken: "qa-local-token",
            tokenType: "bearer",
            expiresIn: 31_536_000,
            expiresAt: now.timeIntervalSince1970 + 31_536_000,
            refreshToken: "qa-local-refresh-disabled",
            user: user
        ))
        app.tapEndPlayback = true
        app.unscoredRallyEnd = false
        app.gameEndDetection = false
        app.keepScoreFullCard = true
        app.rallyEndRespectsCard = true
        return app
    }

    static func makeMatch() -> MatchRow {
        let data = Data(#"""
        {
          "id":"22222222-2222-4222-8222-222222222222",
          "user_id":"11111111-1111-4111-8111-111111111111",
          "opponent_name":"Alex",
          "match_type":"match",
          "played_at":"2026-09-11T12:00:00Z",
          "status":"ready",
          "duration_s":27,
          "user_side":"near",
          "first_server":"user",
          "clip_pads":{"pre":1,"post":1},
          "created_at":"2026-09-11T12:00:00Z",
          "points":[{"count":3}]
        }
        """#.utf8)
        return try! JSONDecoder().decode(MatchRow.self, from: data)
    }

    static func makePoints() -> [MatchPoint] {
        let rows = (0..<3).map { index -> [String: Any] in
            [
                "id": ScorekeeperQAIDs.points[index].uuidString.lowercased(),
                "match_id": ScorekeeperQAIDs.match.uuidString.lowercased(),
                "idx": index + 1,
                "t0": Double(index * 9 + 1),
                "t1": Double(index * 9 + 7),
                "cut_t0": Double(index * 9),
                "is_let": false,
                "confirmed_winner": index == 0 ? "user" : NSNull(),
                "scored_at_cut_s": index == 0 ? 6.0 : NSNull(),
                "starred": false,
                "deleted": false,
                "edited": false,
                "tight_start": false,
                "tight_end": false,
            ]
        }
        let data = try! JSONSerialization.data(withJSONObject: rows)
        return try! JSONDecoder().decode([MatchPoint].self, from: data)
    }
}

struct ScorekeeperQAFixtureView: View {
    private let match = ScorekeeperQAFixture.makeMatch()
    @State private var app: AppState
    @State private var model: MatchDetailModel
    @State private var selectedPoint: Int
    @State private var playerOpen = false
    @State private var snapshot = ScorekeeperQAFixture.store.snapshot()
    @State private var sourceExists = FileManager.default.fileExists(
        atPath: ScorekeeperQAFixture.videoURL.path
    )
    @State private var didAutoOpen = false

    init() {
        let model = MatchDetailModel()
        model.points = ScorekeeperQAFixture.makePoints()
        model.videoURL = ScorekeeperQAFixture.videoURL
        model.loaded = true
        _model = State(initialValue: model)
        _app = State(initialValue: ScorekeeperQAFixture.makeAppState())
        _selectedPoint = State(
            initialValue: ScorekeeperQAFixture.configuration?.startPoint ?? 2
        )
    }

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Scorekeeper QA")
                        .font(.plPageTitle)
                        .foregroundStyle(PL.textBody)
                    sourceCard
                    startCard
                    stateCard
                    eventCard
                }
                .padding(20)
            }
        }
        .environment(app)
        .task {
            sourceExists = FileManager.default.fileExists(
                atPath: ScorekeeperQAFixture.videoURL.path
            )
            if sourceExists, !didAutoOpen {
                didAutoOpen = true
                playerOpen = true
            }
            while !Task.isCancelled {
                snapshot = ScorekeeperQAFixture.store.snapshot()
                try? await Task.sleep(for: .milliseconds(200))
            }
        }
        .fullScreenCover(isPresented: $playerOpen) {
            PlayerTakeover(
                match: match,
                model: model,
                pad: ClipPad(pre: 1, post: 1),
                videoURL: ScorekeeperQAFixture.videoURL,
                startAt: Double((selectedPoint - 1) * 9),
                mode: .score
            )
            .environment(app)
        }
    }

    private var sourceCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeading("Fixture source")
            Text(sourceExists ? "Documents/scorekeeper-fixture.mp4" : "Missing Documents/scorekeeper-fixture.mp4")
                .font(.plBody)
                .foregroundStyle(sourceExists ? PL.successText : PL.dangerText)
            Text("Events: Documents/scorekeeper-qa-events.jsonl")
                .font(.plCaption)
                .foregroundStyle(PL.text400)
            if let error = snapshot.eventLogError {
                Text("Event log unavailable: \(error)")
                    .font(.plCaption)
                    .foregroundStyle(PL.dangerText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard()
    }

    private var startCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Start at point")
            HStack(spacing: 8) {
                ForEach(1...3, id: \.self) { point in
                    Button("Point \(point)") { selectedPoint = point }
                        .buttonStyle(
                            point == selectedPoint
                                ? AnyButtonStyle(PLCyanGhostButtonStyle())
                                : AnyButtonStyle(PLSecondaryButtonStyle())
                        )
                }
            }
            Button("Open scorekeeper") {
                sourceExists = FileManager.default.fileExists(
                    atPath: ScorekeeperQAFixture.videoURL.path
                )
                if sourceExists { playerOpen = true }
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .buttonStyle(PLPrimaryButtonStyle())
            .disabled(!sourceExists)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard()
    }

    private var stateCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading("Scorer state")
            ForEach(Array(model.points.enumerated()), id: \.element.id) { index, point in
                let remote = snapshot.remote[point.id]
                VStack(alignment: .leading, spacing: 3) {
                    Text("Point \(index + 1)")
                        .font(.plRowTitle)
                        .foregroundStyle(PL.text100)
                    Text("Local  \(fields(winner: point.confirmedWinner?.rawValue, isLet: point.isLet, scoredAt: point.scoredAtCutS))")
                    Text("Remote  \(fields(winner: remote?.confirmedWinner, isLet: remote?.isLet ?? false, scoredAt: remote?.scoredAtCutS))")
                }
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(PL.text300)
            }
            Text("Unexpected requests: \(snapshot.unexpectedRequestCount)")
                .font(.plBody)
                .foregroundStyle(snapshot.unexpectedRequestCount == 0 ? PL.text300 : PL.dangerText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard()
    }

    private var eventCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeading("Payload order")
            if snapshot.events.isEmpty {
                Text("No requests recorded.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
            } else {
                ForEach(Array(snapshot.events.enumerated()), id: \.offset) { _, event in
                    Text(eventLine(event))
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(event.phase == .unexpected ? PL.dangerText : PL.text300)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard()
    }

    private func fields(winner: String?, isLet: Bool, scoredAt: Double?) -> String {
        "winner=\(winner ?? "null") let=\(isLet) tap=\(scoredAt.map { String($0) } ?? "null")"
    }

    private func eventLine(_ event: ScorekeeperQAEvent) -> String {
        guard let pointID = event.pointID else { return "unexpected" }
        let point = ScorekeeperQAIDs.points.firstIndex(of: pointID).map { $0 + 1 } ?? 0
        return "\(event.ordinal ?? 0) \(event.phase.rawValue) p\(point) "
            + fields(
                winner: event.confirmedWinner,
                isLet: event.isLet ?? false,
                scoredAt: event.scoredAtCutS
            )
    }
}

private struct AnyButtonStyle: ButtonStyle {
    private let makeBodyClosure: (Configuration) -> AnyView

    init<S: ButtonStyle>(_ style: S) {
        makeBodyClosure = { AnyView(style.makeBody(configuration: $0)) }
    }

    func makeBody(configuration: Configuration) -> some View {
        makeBodyClosure(configuration)
    }
}
#endif
