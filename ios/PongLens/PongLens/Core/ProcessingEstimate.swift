import Foundation

struct ProcessingEstimate: Decodable, Hashable {
    let readyScope: String?
    let state: String?
    let observedAt: String?
    let expiresAt: String?
    let readyEarliestAt: String?
    let readyLatestAt: String?
    let startEarliestAt: String?
    let startLatestAt: String?
    let basis: String?
    let reason: String?
    enum CodingKeys: String, CodingKey {
        case readyScope = "ready_scope"
        case state, basis, reason
        case observedAt = "observed_at", expiresAt = "expires_at"
        case readyEarliestAt = "ready_earliest_at", readyLatestAt = "ready_latest_at"
        case startEarliestAt = "start_earliest_at", startLatestAt = "start_latest_at"
    }
    struct Message { let summary: String; let detail: String }
    func message(jobStatus: String?, serviceState: String?, now: Date = Date()) -> Message? {
        guard readyScope == "match", state != "queue_only" else { return nil }
        guard serviceState == "available", jobStatus == "queued" || jobStatus == "processing" else { return nil }
        let iso = ISO8601DateFormatter()
        func date(_ text: String?) -> Date? {
            guard let text else { return nil }
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let value = iso.date(from: text) { return value }
            iso.formatOptions = [.withInternetDateTime]
            return iso.date(from: text)
        }
        guard let observed = date(observedAt), let expires = date(expiresAt),
              observed.timeIntervalSince(now) <= 30, now.timeIntervalSince(observed) <= 90,
              expires > now, expires > observed else { return nil }
        let overdue = Message(summary: "Processing is taking longer than estimated.",
                              detail: "Your video is still in the processing queue. You can check back later.")
        if state == "overdue" { return overdue }
        guard state == "range" || state == "queue_only" else { return nil }
        let queueOnly = state == "queue_only"
        guard let low = date(queueOnly ? startEarliestAt : readyEarliestAt),
              let high = date(queueOnly ? startLatestAt : readyLatestAt), low <= high else { return nil }
        if high <= now { return queueOnly ? nil : overdue }
        let lower = max(0, Int(floor(low.timeIntervalSince(now) / 300)) * 5)
        let upper = max(5, Int(ceil(high.timeIntervalSince(now) / 300)) * 5)
        let range = lower == 0 ? "within about \(upper) minutes"
            : lower == upper ? "in about \(upper) minutes" : "in about \(lower)–\(upper) minutes"
        if queueOnly {
            let wait = range.hasPrefix("in ") ? String(range.dropFirst(3)) : range
            return Message(summary: "Estimated wait before processing: \(wait).",
                           detail: reason == "metadata_unknown" ? "Processing time will be estimated after the video check." : "Processing time is not available yet.")
        }
        return Message(summary: "Estimated ready \(range).", detail: "This is a rough estimate based on recent processing.")
    }
}
