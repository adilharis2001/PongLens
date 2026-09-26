import Foundation
import Observation

/// One serial poller for all signed-in surfaces. A failed or suspended read
/// becomes unknown; old per-match feedback cannot prolong a service outage.
@MainActor @Observable
final class ProcessingServiceStore {
    private(set) var status = ProcessingServiceStatus.unknown
    private let fetch: () async throws -> ProcessingServiceStatus
    private let now: () -> Date
    private let waitForExpiry: () async throws -> Void
    private var pollTask: Task<Void, Never>?
    private var expiryTask: Task<Void, Never>?
    private var requestTask: Task<Void, Never>?
    private var requestCompletion: CheckedContinuation<Void, Never>?
    private var activeRequest: Int?
    private var generation = 0

    init(fetch: @escaping () async throws -> ProcessingServiceStatus, now: @escaping () -> Date = Date.init,
         waitForExpiry: @escaping () async throws -> Void = { try await Task.sleep(for: .seconds(30)) }) {
        self.fetch = fetch
        self.now = now
        self.waitForExpiry = waitForExpiry
    }
    func state(for lane: ProcessingServiceLane) -> ProcessingServiceState { status.state(for: lane, now: now()) }
    func notice(lane: ProcessingServiceLane = .main, context: AvailabilityContext) -> ProcessingAvailabilityNotice? {
        availabilityNotice(state(for: lane), context: context)
    }
    var clipLane: ProcessingServiceLane { status.clipLane }

    func matchNotice(matchStatus: String, jobKind: String?, jobStatus: String?, lane: String? = nil, videoSaved: Bool = true, onDevice: Bool = false, manualCut: Bool = false) -> ProcessingAvailabilityNotice? {
        guard matchStatus != "ready", matchStatus != "failed" else { return nil }
        let active = jobStatus == "queued" || jobStatus == "processing"
        // A hand cut the owner's iPhone is cutting: no Mac lane is involved
        // until the phone hands it over, so no lane's outage applies.
        if active && onDevice { return nil }
        // Terminal feedback cannot turn an idle or finished video into a queue.
        let context = active ? processingContext(kind: jobKind, videoSaved: videoSaved)
            : matchStatus == "processing" && jobStatus == nil ? .queuedWork : .savedIdle
        let routedLane = active ? processingNoticeLane(kind: jobKind, reported: lane.flatMap(ProcessingServiceLane.init(rawValue:)), clipLane: clipLane, manualCut: manualCut) : .main
        return notice(lane: routedLane, context: context)
    }

    func refresh() async {
        guard activeRequest == nil else { return }
        generation += 1
        let requestGeneration = generation
        activeRequest = requestGeneration
        expiryTask?.cancel()
        await withCheckedContinuation { completion in
            requestCompletion = completion
            requestTask = Task { [weak self, fetch] in
                let result: ProcessingServiceStatus
                do { result = try await fetch() }
                catch { result = .unknown }
                guard let self, self.generation == requestGeneration, self.activeRequest == requestGeneration else { return }
                self.status = result
                self.finishRequest()
            }
            expiryTask = Task { [weak self, waitForExpiry] in
                do { try await waitForExpiry() } catch { return }
                guard !Task.isCancelled, let self, self.generation == requestGeneration else { return }
                // Retire before cancellation: even a transport that ignores
                // cancellation cannot block the next request or publish late.
                self.generation += 1
                self.status = .unknown
                self.requestTask?.cancel()
                self.finishRequest()
            }
        }
        // Keep expiry armed: even a hung subsequent read cannot retain a notice.
    }

    private func finishRequest() {
        activeRequest = nil
        requestTask = nil
        let completion = requestCompletion
        requestCompletion = nil
        completion?.resume()
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
        requestTask?.cancel()
        finishRequest()
        status = .unknown
    }
}
