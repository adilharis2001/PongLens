import Foundation

/// Persistence outlives a takeover, but its completion must not restart a
/// closed player or replace a later navigation in the same session.
final class ScorerSessionEffects {
    struct Owner {
        let session: Int
        let navigation: Int
    }
    private var session = 0
    private var navigation = 0
    private var active = false

    func open() { session += 1; active = true }
    func close() { active = false }
    func navigate() { navigation += 1 }
    /// Deliberate interaction pauses supersede any delayed replay. Retire
    /// ownership before transport callbacks can observe the pause.
    func pauseForInteraction(_ pause: () -> Void) {
        navigate()
        pause()
    }
    func capture() -> Owner { Owner(session: session, navigation: navigation) }
    func sameSession(_ owner: Owner) -> Bool { active && session == owner.session }
    func owns(_ owner: Owner) -> Bool {
        sameSession(owner) && navigation == owner.navigation
    }
}

/// The three fields one scoring action owns. An answer and the observation
/// of where that answer was made move together, but they are not the same
/// fact: correcting the answer must not move the end of the rally.
struct ScorerState: Equatable, Sendable {
    var winner: Winner?
    var isLet: Bool
    var scoredAt: Double?

    init(winner: Winner?, isLet: Bool, scoredAt: Double?) {
        self.isLet = isLet
        self.winner = isLet ? nil : winner
        if !isLet, winner != nil, let scoredAt, scoredAt.isFinite {
            self.scoredAt = scoredAt
        } else {
            self.scoredAt = nil
        }
    }

    init(_ point: MatchPoint) {
        self.init(
            winner: point.confirmedWinner,
            isLet: point.isLet,
            scoredAt: point.scoredAtCutS
        )
    }

    func settingWinner(_ next: Winner?, observation: Double? = nil) -> ScorerState {
        guard let next else {
            return ScorerState(winner: nil, isLet: isLet, scoredAt: nil)
        }
        let correcting = winner != nil || isLet
        let eligible = observation.flatMap { $0.isFinite ? $0 : nil }
        return ScorerState(
            winner: next,
            isLet: false,
            scoredAt: isLet ? nil : (correcting ? scoredAt : eligible)
        )
    }

    func settingSkipped(_ next: Bool) -> ScorerState {
        if next {
            return ScorerState(winner: nil, isLet: true, scoredAt: nil)
        }
        return isLet
            ? ScorerState(winner: nil, isLet: false, scoredAt: nil)
            : self
    }
}

struct ScorePlaybackEvent: Equatable, Sendable {
    let pointId: UUID
    let start: Double
    let end: Double
    let time: Double
    let playing: Bool
    let ready: Bool
    let foreground: Bool
    let sourceKey: String

    func with(
        pointId: UUID? = nil,
        start: Double? = nil,
        end: Double? = nil,
        time: Double? = nil,
        playing: Bool? = nil,
        ready: Bool? = nil,
        foreground: Bool? = nil,
        sourceKey: String? = nil
    ) -> ScorePlaybackEvent {
        ScorePlaybackEvent(
            pointId: pointId ?? self.pointId,
            start: start ?? self.start,
            end: end ?? self.end,
            time: time ?? self.time,
            playing: playing ?? self.playing,
            ready: ready ?? self.ready,
            foreground: foreground ?? self.foreground,
            sourceKey: sourceKey ?? self.sourceKey
        )
    }
}

/// Captures the AVPlayer transition at the KVO callback boundary. Delivery
/// may happen later on the main actor, after the player's live status has
/// changed again, so it must not re-read that mutable status.
struct ScorePlaybackTransportChange: Equatable, Sendable {
    let isPlaying: Bool
    let isWaiting: Bool

    init(isPlaying: Bool, isWaiting: Bool = false) {
        self.isPlaying = isPlaying
        self.isWaiting = isWaiting
    }

    func apply(
        onPlaying: () -> Void,
        onWaiting: () -> Void = {},
        onInterrupted: () -> Void
    ) {
        if isPlaying {
            onPlaying()
        } else if isWaiting {
            onWaiting()
        } else {
            onInterrupted()
        }
    }
}

/// Evidence for one uninterrupted pass through one point on the real cut.
/// A pause, seek, background transition, buffer or source change retires it;
/// a later mid-rally resume cannot arm a fresh run.
final class ScorePlaybackRun {
    private struct Run {
        let pointId: UUID
        let start: Double
        let end: Double
        let sourceKey: String
        var lastTime: Double
    }

    private var run: Run?
    private var successfulSeek: Run?
    private let startEpsilon = 0.05

    func invalidate() {
        run = nil
        successfulSeek = nil
    }

    /// Waiting before the first playable frame may follow a completed seek.
    /// It retires any active run, but the seek's exact opening proof remains
    /// pending until the first eligible sample or an explicit interruption.
    func waitForPlayback() {
        run = nil
    }

    func observe(_ event: ScorePlaybackEvent) {
        guard eligible(event) else {
            run = nil
            if let successfulSeek,
               (!sameRun(successfulSeek, event)
                || event.foreground == false
                || event.sourceKey != "cut"
                || event.time + startEpsilon < event.start
                || event.time - event.start > maxStartCrossingStep) {
                self.successfulSeek = nil
            }
            return
        }
        if let successfulSeek {
            self.successfulSeek = nil
            guard sameRun(successfulSeek, event), event.time + startEpsilon >= event.start,
                  event.time <= event.end,
                  event.time - event.start <= maxStartCrossingStep
            else { return }
            run = Run(
                pointId: event.pointId,
                start: event.start,
                end: event.end,
                sourceKey: event.sourceKey,
                lastTime: event.time
            )
            return
        }
        if let currentRun = run, sameRun(currentRun, event) {
            if event.time + startEpsilon < currentRun.lastTime {
                invalidate()
                armAtStart(event)
            } else {
                run!.lastTime = event.time
            }
            return
        }
        let previousRun = run
        invalidate()
        armAtStart(event, after: previousRun)
    }

    /// A zero-tolerance seek completion is positive evidence that playback
    /// crossed this point's opening even when the player advanced before the
    /// main actor received the completion. The live event still has to prove
    /// the current point, source and transport state, and the completion may
    /// bridge no more than one supported observer step.
    func observeAfterSuccessfulSeek(_ event: ScorePlaybackEvent, target: Double) {
        invalidate()
        guard event.sourceKey == "cut", event.foreground,
              event.start.isFinite, event.end.isFinite, event.time.isFinite,
              event.end >= event.start,
              abs(target - event.start) <= startEpsilon,
              event.time + startEpsilon >= event.start,
              event.time <= event.end,
              event.time - event.start <= maxStartCrossingStep
        else { return }
        successfulSeek = Run(
            pointId: event.pointId,
            start: event.start,
            end: event.end,
            sourceKey: event.sourceKey,
            lastTime: event.time
        )
        if eligible(event) { observe(event) }
    }

    func observation(_ event: ScorePlaybackEvent) -> Double? {
        guard eligible(event), let run else { return nil }
        guard run.pointId == event.pointId, run.start == event.start,
              run.end == event.end, run.sourceKey == event.sourceKey,
              event.time >= event.start, event.time <= event.end
        else { return nil }
        return event.time
    }

    private func armAtStart(_ event: ScorePlaybackEvent, after previousRun: Run? = nil) {
        let crossedStartContinuously = previousRun.map {
            $0.pointId != event.pointId && $0.sourceKey == event.sourceKey
                && $0.lastTime <= event.start && event.time >= event.start
                && event.time - $0.lastTime <= maxStartCrossingStep
        } ?? false
        guard event.time <= event.start + startEpsilon || crossedStartContinuously else {
            return
        }
        run = Run(
            pointId: event.pointId,
            start: event.start,
            end: event.end,
            sourceKey: event.sourceKey,
            lastTime: event.time
        )
    }

    /// One 200 ms periodic observer tick at the supported 2x ceiling, with
    /// enough room to match the web timeupdate cadence.
    private let maxStartCrossingStep = 0.5

    private func sameRun(_ run: Run, _ event: ScorePlaybackEvent) -> Bool {
        run.pointId == event.pointId && run.start == event.start
            && run.end == event.end && run.sourceKey == event.sourceKey
    }

    private func eligible(_ event: ScorePlaybackEvent) -> Bool {
        event.sourceKey == "cut" && event.playing && event.ready
            && event.foreground && event.start.isFinite && event.end.isFinite
            && event.time.isFinite && event.end >= event.start
    }
}

/// A known own-clip card has a virtual cut position, even when signing or
/// loading its actual clip fails and the player happens to leave the cut on
/// screen. That fallback is not proof that this rally exists at that clock.
func scorePlaybackSourceKey(
    actualCut: Bool,
    requiresOwnClip: Bool,
    latestSeekSettled: Bool = true
) -> String? {
    actualCut && !requiresOwnClip && latestSeekSettled ? "cut" : nil
}

struct ScorerTimingGuard: Equatable, Sendable {
    var cutT0: Double?
    var t0: Double?
    var t1: Double?
    var edited: Bool
    var tightStart: Bool
    var tightEnd: Bool

    init(
        cutT0: Double?, t0: Double?, t1: Double?, edited: Bool,
        tightStart: Bool, tightEnd: Bool
    ) {
        self.cutT0 = cutT0
        self.t0 = t0
        self.t1 = t1
        self.edited = edited
        self.tightStart = tightStart
        self.tightEnd = tightEnd
    }

    init(_ point: MatchPoint) {
        self.init(
            cutT0: point.cutT0,
            t0: point.t0,
            t1: point.t1,
            edited: point.edited,
            tightStart: point.tightStart,
            tightEnd: point.tightEnd
        )
    }
}

struct ScorerCommandPoint: Equatable, Sendable {
    let id: UUID
    var state: ScorerState
    var timing: ScorerTimingGuard

    init(id: UUID, state: ScorerState, timing: ScorerTimingGuard) {
        self.id = id
        self.state = state
        self.timing = timing
    }

    init(_ point: MatchPoint) {
        self.init(
            id: point.id,
            state: ScorerState(point),
            timing: ScorerTimingGuard(point)
        )
    }

    func withState(_ state: ScorerState) -> ScorerCommandPoint {
        var copy = self
        copy.state = state
        return copy
    }
}

struct ScorerCommandReceipt: Equatable, Sendable {
    let pointId: UUID
    let before: ScorerState
    let after: ScorerState
    let timing: ScorerTimingGuard
}

/// Per-point command tails preserve invocation order without making writes
/// to different points wait for one another. Reads happen when a command
/// reaches the head of its point's queue, never from a stale tap snapshot.
@MainActor
final class ScorerCommands {
    typealias Read = @MainActor (UUID) -> ScorerCommandPoint?
    typealias Apply = @MainActor (UUID, ScorerState) -> Void
    typealias Persist = @MainActor (UUID, ScorerState) async -> Bool

    private struct Tail {
        let token: Int
        let task: Task<Void, Never>
    }

    private let read: Read
    private let apply: Apply
    private let persist: Persist
    private var tails: [UUID: Tail] = [:]
    private var nextToken = 0

    init(read: @escaping Read, apply: @escaping Apply, persist: @escaping Persist) {
        self.read = read
        self.apply = apply
        self.persist = persist
    }

    func winner(
        _ pointId: UUID,
        side: Winner,
        observation: Double? = nil,
        observationTiming: ScorerTimingGuard? = nil,
        force: Bool = false
    ) async -> ScorerCommandReceipt? {
        await beginWinner(
            pointId, side: side, observation: observation,
            observationTiming: observationTiming, force: force
        ).value
    }

    /// Reserves this action's place synchronously on the main actor. The
    /// returned task may still be pending, but a following Undo or score can
    /// no longer overtake it in this point's queue.
    func beginWinner(
        _ pointId: UUID,
        side: Winner,
        observation: Double? = nil,
        observationTiming: ScorerTimingGuard? = nil,
        force: Bool = false
    ) -> Task<ScorerCommandReceipt?, Never> {
        reserve(pointId) { [self] in
            guard let point = read(pointId) else { return nil }
            let before = point.state
            let next: Winner? = force
                ? side
                : (before.winner == side && !before.isLet ? nil : side)
            let staleObservation = observationTiming.map { $0 != point.timing } ?? false
            let after = before.settingWinner(
                next,
                observation: point.timing.edited || staleObservation ? nil : observation
            )
            guard after != before else { return nil }
            return await persistTransition(
                pointId: pointId, before: before, after: after, timing: point.timing
            )
        }
    }

    func skip(_ pointId: UUID, next: Bool? = nil) async -> ScorerCommandReceipt? {
        await beginSkip(pointId, next: next).value
    }

    func beginSkip(
        _ pointId: UUID, next: Bool? = nil
    ) -> Task<ScorerCommandReceipt?, Never> {
        reserve(pointId) { [self] in
            guard let point = read(pointId) else { return nil }
            let before = point.state
            let after = before.settingSkipped(next ?? !before.isLet)
            guard after != before else { return nil }
            return await persistTransition(
                pointId: pointId, before: before, after: after, timing: point.timing
            )
        }
    }

    /// Undo does not have a receipt until the original write finishes, but
    /// it already knows the point. Reserve its point-queue position now and
    /// consume the receipt only when this work reaches the head.
    func beginRestore(
        _ pointId: UUID,
        after pending: Task<ScorerCommandReceipt?, Never>
    ) -> Task<ScorerCommandReceipt?, Never> {
        reserve(pointId) { [self] in
            guard let receipt = await pending.value, receipt.pointId == pointId else {
                return nil
            }
            return await restoreAtHead(receipt)
        }
    }

    func restore(_ receipt: ScorerCommandReceipt) async -> ScorerCommandReceipt? {
        await enqueue(receipt.pointId) { [self] in
            await restoreAtHead(receipt)
        }
    }

    private func restoreAtHead(
        _ receipt: ScorerCommandReceipt
    ) async -> ScorerCommandReceipt? {
        guard let point = read(receipt.pointId), point.state == receipt.after,
              point.timing == receipt.timing
        else { return nil }
        return await persistTransition(
            pointId: receipt.pointId,
            before: receipt.after,
            after: receipt.before,
            timing: receipt.timing
        )
    }

    private func persistTransition(
        pointId: UUID,
        before: ScorerState,
        after: ScorerState,
        timing: ScorerTimingGuard
    ) async -> ScorerCommandReceipt? {
        apply(pointId, after)
        let saved = await persist(pointId, after)
        guard saved else {
            if let current = read(pointId),
               current.state.winner == after.winner,
               current.state.isLet == after.isLet {
                let ownsObservation = current.state.scoredAt == after.scoredAt
                    && current.timing == timing
                apply(
                    pointId,
                    ScorerState(
                        winner: before.winner,
                        isLet: before.isLet,
                        scoredAt: ownsObservation ? before.scoredAt : current.state.scoredAt
                    )
                )
            }
            return nil
        }
        return ScorerCommandReceipt(
            pointId: pointId, before: before, after: after, timing: timing
        )
    }

    private func enqueue<T>(
        _ pointId: UUID,
        work: @escaping @MainActor () async -> T
    ) async -> T {
        await reserve(pointId, work: work).value
    }

    private func reserve<T>(
        _ pointId: UUID,
        work: @escaping @MainActor () async -> T
    ) -> Task<T, Never> {
        let previous = tails[pointId]?.task
        nextToken += 1
        let token = nextToken
        let result = Task { @MainActor in
            if let previous { await previous.value }
            return await work()
        }
        let tail = Task { @MainActor [weak self] in
            _ = await result.value
            guard self?.tails[pointId]?.token == token else { return }
            self?.tails.removeValue(forKey: pointId)
        }
        tails[pointId] = Tail(token: token, task: tail)
        return result
    }
}
