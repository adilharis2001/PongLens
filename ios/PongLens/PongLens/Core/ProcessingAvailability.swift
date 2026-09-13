import Foundation

enum ProcessingServiceState: String, Decodable { case available, unavailable, maintenance, unknown }
enum ProcessingServiceLane: String, Decodable { case main, fast, hand }
enum AvailabilityContext { case savedMatch, savedVideo, savedIdle, savedProcessing, hand, queuedWork, importRequest, uploading, beforeUpload, beforeImport, fast, export }

struct ProcessingServiceStatus: Decodable {
    var main: ProcessingServiceState = .unknown
    var fast: ProcessingServiceState = .unknown
    var hand: ProcessingServiceState = .unknown
    var clipLane: ProcessingServiceLane = .main
    var observedAt: Date?
    static let unknown = ProcessingServiceStatus()

    init() {}
    enum CodingKeys: String, CodingKey { case main, fast, hand, clipLane = "clip_lane", observedAt = "observed_at" }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        main = (try? c.decode(ProcessingServiceState.self, forKey: .main)) ?? .unknown
        fast = (try? c.decode(ProcessingServiceState.self, forKey: .fast)) ?? .unknown
        hand = (try? c.decode(ProcessingServiceState.self, forKey: .hand)) ?? .unknown
        clipLane = (try? c.decode(String.self, forKey: .clipLane)) == "fast" ? .fast : .main
        if let raw = try? c.decode(String.self, forKey: .observedAt) {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            observedAt = formatter.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
        }
    }
    func state(for lane: ProcessingServiceLane, now: Date = Date()) -> ProcessingServiceState {
        guard let observedAt, now.timeIntervalSince(observedAt) <= 90,
              observedAt.timeIntervalSince(now) <= 30 else { return .unknown }
        switch lane { case .main: return main; case .fast: return fast; case .hand: return hand }
    }
}

func processingServiceLane(kind: String?, clipLane: ProcessingServiceLane = .main, scope: String = "") -> ProcessingServiceLane {
    if kind == "hand_cut" { return .hand }
    if kind == "reclip" || (kind == "reel" && scope.hasPrefix("v:")) { return clipLane }
    return .main
}

func processingContext(kind: String?, videoSaved: Bool = true) -> AvailabilityContext {
    if kind == "youtube_import", !videoSaved { return .importRequest }
    if kind == "content_check" { return .savedVideo }
    if kind == "hand_cut" { return .hand }
    if kind == "deadspace_cut" { return .savedMatch }
    return .savedProcessing
}

struct ProcessingAvailabilityNotice: Equatable {
    let title: String
    let body: String
}

func availabilityNotice(_ state: ProcessingServiceState, context: AvailabilityContext) -> ProcessingAvailabilityNotice? {
    guard state == .unavailable || state == .maintenance else { return nil }
    let title: String
    switch context {
    case .export: title = "Video exports are temporarily unavailable"
    case .fast: title = "Clip updates and exports are temporarily unavailable"
    default: title = state == .maintenance ? "Video processing is paused for maintenance" : "Video processing is temporarily unavailable"
    }
    let body: String
    switch context {
    case .savedMatch: body = "Your video is saved and queued. Processing will resume automatically when service is restored. You can leave this page. We’ll email you when your match is ready."
    case .savedVideo: body = "Your video is saved. Its video check will continue when service is restored. You can leave this page."
    case .savedIdle: body = "Your video is saved. You can request processing, but it will not start until service is restored."
    case .hand: body = "Your video is saved. Clip preparation will resume automatically when service is restored. You can leave this page."
    case .queuedWork: body = "Your processing requests are saved. Work on the affected videos will continue when service is restored. You can leave this page."
    case .savedProcessing: body = "Your video is saved and queued. Processing will resume automatically when service is restored. You can leave this page."
    case .importRequest: body = "Your import request is queued and will continue when service is restored. You can leave this page."
    case .uploading: body = "Your video is still uploading. Processing will wait until the upload finishes and service is restored."
    case .beforeUpload: body = "You can still upload a video. Processing requests will wait until service is restored."
    case .beforeImport: body = "You can still submit a YouTube link. Import requests will wait until service is restored."
    case .fast: body = "Any requested clip updates or exports will continue when service is restored. Your existing videos and scoring remain available."
    case .export: body = "Any requested exports will continue when service is restored. Videos that are already prepared can still be downloaded."
    }
    return ProcessingAvailabilityNotice(title: title, body: body)
}
