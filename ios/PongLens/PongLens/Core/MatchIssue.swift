import Foundation
import Observation

extension Notification.Name {
    static let matchProcessingVersionChanged = Notification.Name("matchProcessingVersionChanged")
}

/// These API responses use camelCase. Notification rows still decode their
/// database snake_case keys in AccountStore; the two contracts are separate.
enum MatchIssueChoice: String, Codable, CaseIterable, Identifiable {
    case positive, problem, reprocess, refund
    var id: String { rawValue }

    func label(minutes: Int?) -> String {
        switch self {
        case .positive: "Looks good"
        case .problem: "Report an issue"
        case .reprocess: "Try processing again"
        case .refund: minutes.map { "Request \($0) \($0 == 1 ? "minute" : "minutes") back" } ?? "Request minutes back"
        }
    }

    var detail: String {
        switch self {
        case .positive: "The rallies and timing look right."
        case .problem: ""
        case .reprocess: "Some rallies were missed or cut at the wrong time."
        case .refund: "I do not want this match processed again."
        }
    }

    var action: String {
        switch self {
        case .positive: "Send feedback"
        case .problem: "Send report"
        case .reprocess, .refund: "Send request"
        }
    }
}

struct MatchIssue: Decodable, Identifiable {
    let id: UUID
    let matchId: UUID
    let kind: MatchIssueChoice
    let status: String
    let message: String
    let resolution: String?
    let playerNote: String?
    let refundableMinutes: Int?
    let createdAt: String
    let updatedAt: String
}

struct MatchIssueEvent: Decodable, Identifiable {
    let id: UUID
    let issueId: UUID
    let kind: String
    let playerNote: String
    let createdAt: String

    var label: String {
        switch kind {
        case "submitted": "Request sent"
        case "cancelled": "Cancelled"
        case "reprocess_queued": "Reprocessing queued"
        case "reprocessing": "Reprocessing"
        case "candidate_ready": "New version ready"
        case "execution_failed": "Needs another review"
        case "refunded": "Minutes returned"
        case "published": "New version published"
        case "kept_current": "Current version kept"
        case "restored": "Previous version restored"
        case "declined": "Request closed"
        default: "Request updated"
        }
    }
}

struct MatchIssueState: Decodable {
    let activeProcessingVersionId: UUID?
    struct AutomaticRefund: Decodable {
        let minutes: Int
        // Postgres bigint ledger IDs cross the web/native boundary as exact
        // decimal strings, not UUIDs or precision-limited JSON numbers.
        let receiptIds: [String]
    }
    let automaticRefund: AutomaticRefund?
    let role: String
    let matchStatus: MatchStatus
    var activeIssue: MatchIssue?
    let refundableMinutes: Int?
    var canPositive: Bool
    var canProblem: Bool
    var canReprocess: Bool
    var canRefund: Bool
    var events: [MatchIssueEvent]

    var isOwner: Bool { role == "owner" }
    var isOwnerCut: Bool { isOwner && matchStatus == .ready }
    var title: String { !isOwner ? "Report a cut problem" : isOwnerCut ? "How was the cut?" : "Report an issue" }

    var choices: [MatchIssueChoice] {
        if let status = activeIssue?.status, status != "recorded", status != "cancelled" { return [] }
        guard isOwnerCut else { return canProblem ? [.problem] : [] }
        var choices: [MatchIssueChoice] = []
        if canPositive { choices.append(.positive) }
        if canReprocess { choices.append(.reprocess) }
        if canRefund, (refundableMinutes ?? 0) > 0 { choices.append(.refund) }
        return choices
    }

    var shouldPoll: Bool {
        ["pending", "reprocess_queued", "reprocessing", "candidate_ready"].contains(activeIssue?.status ?? "")
    }
    var canCancel: Bool { isOwner && activeIssue?.status == "pending" }

    var automaticRefundMessage: String? {
        guard isOwner, matchStatus == .failed, let receipt = automaticRefund,
              receipt.minutes > 0, !receipt.receiptIds.isEmpty else { return nil }
        return "\(receipt.minutes) processing \(receipt.minutes == 1 ? "minute was" : "minutes were") returned automatically after processing failed."
    }

    var statusLabel: String? {
        guard let status = activeIssue?.status else { return nil }
        if status == "resolved_reprocessed", events.contains(where: { $0.kind == "restored" }) {
            return "Previous version restored"
        }
        return switch status {
        case "recorded": "Feedback sent"
        case "pending": "Under review"
        case "reprocess_queued": "Reprocessing queued"
        case "reprocessing": "Reprocessing"
        case "candidate_ready": "New version ready"
        case "resolved_reprocessed": "Reprocessed"
        case "resolved_refunded": "Minutes returned"
        case "declined": "Request closed"
        case "execution_failed": "Needs another review"
        case "cancelled": "Cancelled"
        default: "Request updated"
        }
    }

    var statusMessage: String? {
        guard let issue = activeIssue else { return nil }
        switch issue.status {
        case "recorded": return "Thanks for the feedback."
        case "pending": return "We will notify you when this has been reviewed."
        case "reprocess_queued": return "Your current match is still available."
        case "reprocessing": return "Your current match is still available while the new version is prepared."
        case "candidate_ready": return "We are reviewing the new result before it replaces anything."
        case "resolved_reprocessed":
            return events.contains(where: { $0.kind == "restored" })
                ? "The previous version is now active."
                : "The new version is now active. The previous version is still recoverable."
        case "resolved_refunded":
            guard isOwner, let minutes = issue.refundableMinutes else { return "The request has been reviewed." }
            return "\(minutes) processing \(minutes == 1 ? "minute was" : "minutes were") returned to your account."
        case "declined": return issue.playerNote.flatMap { $0.isEmpty ? nil : $0 } ?? "The request has been reviewed."
        case "execution_failed": return "Reprocessing did not finish. Your current match has not changed."
        case "cancelled": return "No changes were made."
        default: return nil
        }
    }

    var rowLabel: String {
        if !isOwner { return "Report a cut problem" }
        if let issue = activeIssue, issue.status != "recorded" { return "Match issue" }
        return title
    }
    var rowTrailing: String {
        if automaticRefundMessage != nil, let receipt = automaticRefund {
            return "\(receipt.minutes) \(receipt.minutes == 1 ? "minute" : "minutes") returned"
        }
        if isOwner, activeIssue?.status == "resolved_refunded", let minutes = activeIssue?.refundableMinutes {
            return "\(minutes) \(minutes == 1 ? "minute" : "minutes") returned"
        }
        return statusLabel ?? (isOwnerCut ? "Share feedback" : "")
    }
}

struct MatchIssueSubmission: Encodable {
    let kind: MatchIssueChoice
    let message: String
    let idempotencyKey: UUID

    init(choice: MatchIssueChoice, message: String, idempotencyKey: UUID = UUID()) {
        self.kind = choice
        self.message = choice == .positive ? "" : message.trimmingCharacters(in: .whitespacesAndNewlines)
        self.idempotencyKey = idempotencyKey
    }
}

/// Only the transport is replaceable; eligibility, draft handling and request
/// identity stay in the model for both the real app and its regression tests.
struct MatchIssueClient {
    var load: (UUID) async throws -> MatchIssueState
    var submit: (UUID, MatchIssueSubmission) async throws -> MatchIssue
    var cancel: (UUID, UUID) async throws -> MatchIssue

    static let live = MatchIssueClient(
        load: { id in
            struct Response: Decodable { let state: MatchIssueState }
            let response: Response = try await API.get("api/match-issues/\(id.uuidString.lowercased())")
            return response.state
        },
        submit: { id, input in
            struct Response: Decodable { let issue: MatchIssue }
            let response: Response = try await API.post("api/match-issues/\(id.uuidString.lowercased())", input)
            return response.issue
        },
        cancel: { id, issueId in
            struct Request: Encodable { let issueId: UUID }
            struct Response: Decodable { let issue: MatchIssue }
            let response: Response = try await API.request(
                "api/match-issues/\(id.uuidString.lowercased())", method: "DELETE", body: Request(issueId: issueId)
            )
            return response.issue
        }
    )
}

@MainActor @Observable
final class MatchIssueModel {
    let matchId: UUID
    var state: MatchIssueState?
    var choice: MatchIssueChoice?
    var message = ""
    var busy = false
    var loadError: String?
    var error: String?
    var confirmation: String?
    @ObservationIgnored private let client: MatchIssueClient
    @ObservationIgnored private var attempt: MatchIssueSubmission?
    @ObservationIgnored private var pollTask: Task<Void, Never>?
    @ObservationIgnored private var observing = false
    @ObservationIgnored private var loadGeneration = 0

    init(matchId: UUID, client: MatchIssueClient? = nil) {
        self.matchId = matchId
        self.client = client ?? .live
    }

    var selectedChoice: MatchIssueChoice? {
        choice ?? (state?.choices == [.problem] ? .problem : nil)
    }
    var canSubmit: Bool {
        guard !busy, let selectedChoice, state?.choices.contains(selectedChoice) == true else { return false }
        return selectedChoice != .problem || !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func load() async {
        loadGeneration += 1
        let generation = loadGeneration
        do {
            let fresh = try await client.load(matchId)
            guard generation == loadGeneration, !Task.isCancelled else { return }
            state = fresh
            loadError = nil
        } catch {
            guard generation == loadGeneration, !Task.isCancelled else { return }
            loadError = "Could not check your request. You can try again."
        }
        updatePolling()
    }

    func submit() async {
        guard canSubmit, let selectedChoice else { return }
        busy = true
        loadGeneration += 1
        error = nil
        confirmation = nil
        defer { busy = false }
        let input = MatchIssueSubmission(choice: selectedChoice, message: message)
        if attempt?.kind != input.kind || attempt?.message != input.message { attempt = input }
        guard let attempt else { return }
        do {
            let issue = try await client.submit(matchId, attempt)
            saved(issue)
            confirmation = selectedChoice == .positive ? "Thanks for the feedback." : "Request sent. We will notify you when it has been reviewed."
            self.attempt = nil
            choice = nil
            message = ""
            await load()
        } catch let APIError.http(status, _) where status == 409 {
            error = "This match has changed. Check the current request and try again."
            await load()
        } catch {
            self.error = "Could not send your request. Check your connection and try again."
        }
    }

    func cancel() async {
        guard !busy, state?.canCancel == true, let issue = state?.activeIssue else { return }
        busy = true
        loadGeneration += 1
        error = nil
        confirmation = nil
        defer { busy = false }
        do {
            saved(try await client.cancel(matchId, issue.id))
            await load()
        } catch {
            self.error = "Could not cancel this request. It may already have been reviewed."
            await load()
        }
    }

    private func saved(_ issue: MatchIssue) {
        loadGeneration += 1
        state?.activeIssue = issue
        state?.events = []
        updatePolling()
    }

    func startPolling() {
        observing = true
        updatePolling()
    }

    func stopPolling() {
        observing = false
        pollTask?.cancel()
        pollTask = nil
        loadGeneration += 1
    }

    private func updatePolling() {
        guard observing, state?.shouldPoll == true else {
            pollTask?.cancel()
            pollTask = nil
            return
        }
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled, let self else { return }
                if !self.busy { await self.load() }
            }
        }
    }
}
