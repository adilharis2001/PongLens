import Foundation
import Observation

/// One serial poller for all signed-in surfaces. A failed or suspended read
/// becomes unknown; old per-match feedback cannot prolong a service outage.
@MainActor @Observable
final class ProcessingServiceStore {
    private(set) var status = ProcessingServiceStatus.unknown
    private let fetch: () async throws -> ProcessingServiceStatus
    private let now: () -> Date
    private var pollTask: Task<Void, Never>?
    private var expiryTask: Task<Void, Never>?
    private var refreshing = false
    private var generation = 0

    init(fetch: @escaping () async throws -> ProcessingServiceStatus, now: @escaping () -> Date = Date.init) {
        self.fetch = fetch
        self.now = now
    }
    func state(for lane: ProcessingServiceLane) -> ProcessingServiceState { status.state(for: lane, now: now()) }
    func notice(lane: ProcessingServiceLane = .main, context: AvailabilityContext) -> ProcessingAvailabilityNotice? {
        availabilityNotice(state(for: lane), context: context)
    }
    var clipLane: ProcessingServiceLane { status.clipLane }

    func matchNotice(matchStatus: String, jobKind: String?, jobStatus: String?, lane: String? = nil, videoSaved: Bool = true) -> ProcessingAvailabilityNotice? {
        guard matchStatus != "ready", matchStatus != "failed" else { return nil }
        let active = jobStatus == "queued" || jobStatus == "processing"
        // Terminal feedback cannot turn an idle or finished video into a queue.
        let context = active ? processingContext(kind: jobKind, videoSaved: videoSaved)
            : matchStatus == "processing" && jobStatus == nil ? .queuedWork : .savedIdle
        let routedLane = active ? (lane.flatMap(ProcessingServiceLane.init(rawValue:)) ?? processingServiceLane(kind: jobKind, clipLane: clipLane)) : .main
        return notice(lane: routedLane, context: context)
    }

    func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        let requestGeneration = generation
        expiryTask?.cancel()
        expiryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(30))
            guard !Task.isCancelled, let self, self.generation == requestGeneration else { return }
            self.status = .unknown
            self.generation += 1
        }
        defer { refreshing = false }
        do {
            let result = try await fetch()
            guard !Task.isCancelled, generation == requestGeneration else { return }
            status = result
        } catch {
            if generation == requestGeneration { status = .unknown }
        }
        // Keep expiry armed: even a hung subsequent read cannot retain a notice.
    }
    func start() {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(15))
            }
        }
    }
    func stop() {
        generation += 1
        pollTask?.cancel()
        pollTask = nil
        expiryTask?.cancel()
        expiryTask = nil
        status = .unknown
    }
}
