import Foundation

let now = ISO8601DateFormatter().date(from: "2026-09-13T06:00:00Z")!
var fixture: [String: Any] = [
    "ready_scope": "match",
    "state": "range", "observed_at": "2026-09-13T06:00:00Z", "expires_at": "2026-09-13T06:01:30Z",
    "ready_earliest_at": "2026-09-13T06:22:12Z", "ready_latest_at": "2026-09-13T06:43:18Z",
    "start_earliest_at": "2026-09-13T06:05:10Z", "start_latest_at": "2026-09-13T06:12:10Z",
    "basis": "recent_baseline_20260913"
]
func decoded(_ values: [String: Any]) throws -> ProcessingEstimate {
    try JSONDecoder().decode(ProcessingEstimate.self, from: JSONSerialization.data(withJSONObject: values))
}
func check(_ ok: Bool, _ message: String) {
    guard ok else { print("FAIL: \(message)"); exit(1) }
}
let value = try decoded(fixture)
check(value.message(jobStatus: "queued", serviceState: "available", now: now)?.summary == "Estimated ready in about 20–45 minutes.", "Outward-rounded ready range")
for state in ["unavailable", "maintenance", "unknown"] {
    check(value.message(jobStatus: "queued", serviceState: state, now: now) == nil, "No clock while capacity unavailable")
}
for status in ["done", "failed", "cancelled"] {
    check(value.message(jobStatus: status, serviceState: "available", now: now) == nil, "Terminal hides estimate")
}
check(value.message(jobStatus: "queued", serviceState: "available", now: now.addingTimeInterval(91)) == nil, "Stale cache hides estimate")
fixture["state"] = "queue_only"
fixture["reason"] = "metadata_unknown"
let queue = try decoded(fixture).message(jobStatus: "queued", serviceState: "available", now: now)
check(queue == nil, "Queue-only estimates stay internal")
var preliminary = fixture
preliminary["state"] = "range"
preliminary.removeValue(forKey: "ready_scope")
preliminary["ready_latest_at"] = "2026-09-13T06:00:48Z"
check(try decoded(preliminary).message(jobStatus: "queued", serviceState: "available", now: now) == nil,
    "A video-check duration cannot claim match readiness")
fixture["start_earliest_at"] = "2026-09-13T05:58:00Z"
fixture["start_latest_at"] = "2026-09-13T05:59:00Z"
check(try decoded(fixture).message(jobStatus: "queued", serviceState: "available", now: now) == nil, "Expired queue range does not renew countdown")
fixture["state"] = "overdue"
check(try decoded(fixture).message(jobStatus: "processing", serviceState: "available", now: now)?.summary == "Processing is taking longer than estimated.", "No frozen countdown")
fixture["observed_at"] = "2026-09-13T06:05:00Z"
check(try decoded(fixture).message(jobStatus: "processing", serviceState: "available", now: now) == nil, "Future timestamp rejected")
print("13 estimate assertions passed")
