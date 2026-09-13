#if DEBUG && targetEnvironment(simulator)
import Foundation
import Supabase

/// Synthetic data and a deny-by-default transport for full production screens.
/// This file is absent from every device/Release build.
nonisolated enum AvailabilityQAData {
    static let ownerID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
    static let matchID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
    static let jobID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
    static let importID = UUID(uuidString: "44444444-4444-4444-8444-444444444444")!
    static let epoch = Date()
    static let loopbackURL = URL(string: "http://127.0.0.1:54322")!
    static func argument(_ name: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: name), args.indices.contains(i + 1) else { return nil }
        return args[i + 1]
    }
    static var kind: String {
        switch argument("--qa-availability-context") {
        case "hand": "hand_cut"
        case "saved_video": "content_check"
        default: "deadspace_cut"
        }
    }
    static var jobStatus: String { argument("--qa-job-status") == "processing" ? "processing" : "queued" }
    static func stamp(_ offset: Double = 0) -> String {
        ISO8601DateFormatter().string(from: epoch.addingTimeInterval(offset))
    }
    static let session: Session = {
        let user = User(id: ownerID, appMetadata: [:], userMetadata: ["full_name": .string("QA Player")],
            aud: "authenticated", email: "qa-availability@localhost.invalid", createdAt: epoch,
            confirmedAt: epoch, emailConfirmedAt: epoch, lastSignInAt: epoch,
            role: "authenticated", updatedAt: epoch)
        return Session(accessToken: "qa-availability-local-token", tokenType: "bearer",
            expiresIn: 31_536_000, expiresAt: epoch.timeIntervalSince1970 + 31_536_000,
            refreshToken: "qa-availability-refresh-disabled", user: user)
    }()
    static func matchObject(ready: Bool = false) -> [String: Any] {
        ["id": matchID.uuidString, "user_id": ownerID.uuidString, "job_id": jobID.uuidString,
         "opponent_name": "Alex", "match_type": "match", "played_at": "2026-09-13T12:00:00Z",
         "status": ready ? "ready" : ["saved_idle", "saved_video"].contains(argument("--qa-availability-context") ?? "") ? "uploaded" : "processing",
         "duration_s": 1240, "raw_path": "qa/owned-recording.mp4", "user_side": "near",
         "first_server": "user", "clip_pads": ["pre": 1, "post": 1],
         "created_at": "2026-09-13T12:00:00Z", "points": [["count": 0]]]
    }
    @MainActor static func match(ready: Bool = false) -> MatchRow {
        try! JSONDecoder().decode(MatchRow.self, from: JSONSerialization.data(withJSONObject: matchObject(ready: ready)))
    }
    static func jobObject(importing: Bool = false) -> [String: Any] {
        ["id": (importing ? importID : jobID).uuidString, "kind": importing ? "youtube_import" : kind,
         "status": jobStatus, "progress": jobStatus == "queued" ? 0 : 38,
         "original_name": "Practice with Alex.mp4", "created_at": stamp(-300),
         "options": importing ? [:] : ["match_id": matchID.uuidString.lowercased()]]
    }
    static var estimate: Any {
        let variant = argument("--qa-estimate") ?? "fresh"
        if variant == "missing" { return NSNull() }
        if variant == "malformed" { return false }
        let stale = variant == "stale"
        var value: [String: Any] = ["state": variant == "unknown" ? "unknown" : variant == "overdue" ? "overdue" : variant == "queue-only" ? "queue_only" : "range",
            "observed_at": stamp(stale ? -120 : 0), "expires_at": stamp(stale ? -30 : 90),
            "start_earliest_at": stamp(300), "start_latest_at": stamp(900),
            "ready_earliest_at": stamp(1200), "ready_latest_at": stamp(2700), "basis": "qa_fixture"]
        if variant == "queue-only" { value["reason"] = "metadata_unknown" }
        if kind == "deadspace_cut" { value["ready_scope"] = "match" }
        return value
    }
    static var feedback: [String: Any] {
        var value: [String: Any] = ["match_id": matchID.uuidString, "job_id": jobID.uuidString,
            "job_kind": kind, "job_status": jobStatus, "stage": "ball", "worker_state": "fresh",
            "lane": kind == "hand_cut" ? "hand" : "main", "estimate": estimate]
        if ProcessInfo.processInfo.arguments.contains("--qa-camera-warning") {
            value["camera_check"] = ["status": "changed", "changes": [["before_s": 10, "after_s": 20]]]
        }
        return value
    }

    private static let handMatchID = "55555555-5555-4555-8555-555555555555"
    private static let handJobID = "66666666-6666-4666-8666-666666666666"
    static var libraryMatches: [[String: Any]] {
        if argument("--qa-home-work") == "orphan" { return [] }
        guard argument("--qa-home-work") == "mixed" else { return [matchObject()] }
        var hand = matchObject()
        hand["id"] = handMatchID; hand["job_id"] = handJobID; hand["opponent_name"] = "Sam"
        return [matchObject(), hand]
    }
    static var libraryJobs: [[String: Any]] {
        if argument("--qa-home-work") == "orphan" { return [jobObject(importing: true)] }
        if argument("--qa-availability-context") == "saved_idle" { return [] }
        guard argument("--qa-home-work") == "mixed" else { return [jobObject()] }
        var hand = jobObject()
        hand["id"] = handJobID; hand["kind"] = "hand_cut"; hand["status"] = "processing"
        hand["options"] = ["match_id": handMatchID]
        return [jobObject(), hand]
    }
    static var libraryFeedback: [[String: Any]] {
        if argument("--qa-home-work") == "orphan" || argument("--qa-availability-context") == "saved_idle" { return [] }
        guard argument("--qa-home-work") == "mixed" else { return [feedback] }
        var hand = feedback
        hand["match_id"] = handMatchID; hand["job_id"] = handJobID
        hand["job_kind"] = "hand_cut"; hand["lane"] = "hand"; hand["job_status"] = "processing"
        hand["stage"] = "cut"
        return [feedback, hand]
    }

    static func verifyIsolation() {
        for method in ["GET", "POST", "PATCH", "DELETE"] {
            var request = URLRequest(url: URL(string: "https://www.ponglens.com/api/media-url")!)
            request.httpMethod = method
            precondition(response(request).0 == 403)
        }
        for path in ["/api/process", "/api/import-url", "/rest/v1/matches", "/rest/v1/points", "/rest/v1/rpc/enqueue_job"] {
            for method in ["POST", "PATCH", "DELETE"] {
                var request = URLRequest(url: loopbackURL.appendingPathComponent(path))
                request.httpMethod = method
                precondition(response(request).0 == 403)
            }
        }
        print("Availability QA: 19 network/write isolation assertions passed")
    }

    static let urlSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.protocolClasses = [AvailabilityQAURLProtocol.self]
        return URLSession(configuration: configuration)
    }()

    static func makeSupabaseClient() -> SupabaseClient {
        let storage = AvailabilityQAAuthStorage()
        try! storage.store(key: "availability-qa-session", value: JSONEncoder().encode(session))
        return SupabaseClient(supabaseURL: loopbackURL, supabaseKey: "qa-anon-key",
            options: SupabaseClientOptions(auth: .init(storage: storage, storageKey: "availability-qa-session",
                autoRefreshToken: false, emitLocalSessionAsInitialSession: true), global: .init(session: urlSession)))
    }

    private static func bodyData(_ request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open(); defer { stream.close() }
        var data = Data(), bytes = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&bytes, maxLength: bytes.count)
            if count <= 0 { break }
            data.append(contentsOf: bytes.prefix(count))
        }
        return data
    }

    /// Only named reads receive synthetic data. No request ever leaves URLProtocol.
    static func response(_ request: URLRequest) -> (Int, Any) {
        guard let url = request.url else { return (403, ["code": "qa_denied"]) }
        let method = request.httpMethod ?? "GET"
        let local = url.host == "127.0.0.1" && url.port == 54322
        let path = url.path
        guard local else { return (403, ["code": "qa_external_request_denied"]) }
        if argument("--qa-upload-recovery") != nil, method == "POST",
           let data = bodyData(request), let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if path == "/api/upload-url", body["action"] as? String == "complete",
               body["uploadId"] as? String == "qa-no-real-upload" {
                // The server registered successfully, but the completion
                // response was lost. The real queue must reconcile by key.
                return (503, ["code": "unavailable"])
            }
            if path == "/api/process", let key = body["requestId"] as? String,
               body["matchId"] as? String == matchID.uuidString {
                precondition(body["trimStartS"] as? Double == 12 && body["trimEndS"] as? Double == 100)
                print("Upload intent QA request \(key)")
                return argument("--qa-upload-recovery") == "pending"
                    ? (503, ["code": "unavailable"]) : (200, ["job_id": jobID.uuidString])
            }
        }
        if path == "/api/media-url", method == "POST" { return (200, ["url": NSNull()]) }
        if path.hasPrefix("/api/thumb/"), method == "GET" { return (404, ["code": "qa_no_thumbnail"]) }
        if path.hasPrefix("/api/match-issues/"), method == "GET" {
            return (200, ["state": ["role": "owner", "matchStatus": "processing", "canPositive": false,
                "canProblem": false, "canReprocess": false, "canRefund": false, "events": []]])
        }
        if method == "POST" {
            switch path {
            case "/rest/v1/rpc/my_match_processing_feedback": return (200, libraryFeedback)
            case "/rest/v1/rpc/my_processing_estimates": return (200, [["job_id": jobID.uuidString, "estimate": estimate], ["job_id": importID.uuidString, "estimate": estimate]])
            case "/rest/v1/rpc/my_processing_state": return (200, [["minutes_balance": 240]])
            case "/rest/v1/rpc/my_storage_state": return (200, [["used_bytes": 0, "storage_limit_bytes": 10_000_000_000]])
            default: return (403, ["code": "qa_write_denied"])
            }
        }
        guard method == "GET" || method == "HEAD" else { return (403, ["code": "qa_write_denied"]) }
        switch path {
        case "/rest/v1/matches":
            if argument("--qa-upload-recovery") == "registration-missing",
               URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "raw_path" }) == true {
                return (200, [])
            }
            if argument("--qa-upload-recovery") == "lookup-pending",
               URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "raw_path" }) == true,
               !AvailabilityUploadConnection.shared.restored {
                return (503, ["code": "qa_network_offline"])
            }
            let single = request.value(forHTTPHeaderField: "Accept")?.contains("vnd.pgrst.object") == true
            return (200, single ? matchObject() : libraryMatches)
        case "/rest/v1/jobs":
            let importing = url.query?.contains(importID.uuidString.lowercased()) == true || url.query?.contains(importID.uuidString) == true
            return (200, importing ? [jobObject(importing: true)] : libraryJobs)
        case "/rest/v1/points", "/rest/v1/point_notes", "/rest/v1/point_tags", "/rest/v1/tags", "/rest/v1/custom_reasons", "/rest/v1/notes", "/rest/v1/loss_reason_labels",
             "/rest/v1/share_links", "/rest/v1/coach_links", "/rest/v1/match_reels", "/rest/v1/app_config": return (200, [])
        default: return (403, ["code": "qa_unexpected_read"])
        }
    }
}

nonisolated final class AvailabilityUploadConnection: @unchecked Sendable {
    static let shared = AvailabilityUploadConnection()
    private let lock = NSLock()
    private var value = false
    var restored: Bool { lock.lock(); defer { lock.unlock() }; return value }
    func restore() { lock.lock(); value = true; lock.unlock() }
}

nonisolated final class AvailabilityQAAuthStorage: AuthLocalStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Data] = [:]
    func store(key: String, value: Data) throws { lock.lock(); defer { lock.unlock() }; values[key] = value }
    func retrieve(key: String) throws -> Data? { lock.lock(); defer { lock.unlock() }; return values[key] }
    func remove(key: String) throws { lock.lock(); defer { lock.unlock() }; values.removeValue(forKey: key) }
}

nonisolated final class AvailabilityQAURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let (status, object) = AvailabilityQAData.response(request)
        print("Availability QA \(request.httpMethod ?? "GET") \(request.url?.path ?? "") → \(status)")
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                  headerFields: ["Content-Type": "application/json", "Content-Range": "0-0/0"]),
              let data = try? JSONSerialization.data(withJSONObject: object) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse)); return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
#endif
