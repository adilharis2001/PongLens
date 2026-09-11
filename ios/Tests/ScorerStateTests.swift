import Foundation

@MainActor
private final class ScorerHarness {
    struct Write {
        let pointId: UUID
        let state: ScorerState
        let gate: AsyncGate<Bool>
    }

    var local: [UUID: ScorerCommandPoint]
    var remote: [UUID: ScorerCommandPoint]
    var writes: [Write] = []
    lazy var commands = ScorerCommands(
        read: { [weak self] id in self?.local[id] },
        apply: { [weak self] id, state in
            guard let point = self?.local[id] else { return }
            self?.local[id] = point.withState(state)
        },
        persist: { [weak self] id, state in
            guard let self else { return false }
            let gate = AsyncGate<Bool>()
            writes.append(Write(pointId: id, state: state, gate: gate))
            let saved = await gate.wait()
            if saved, let point = remote[id] {
                remote[id] = point.withState(state)
            }
            return saved
        }
    )

    init(_ points: [ScorerCommandPoint]) {
        local = Dictionary(uniqueKeysWithValues: points.map { ($0.id, $0) })
        remote = local
    }
}

private actor AsyncGate<Value> {
    private var buffered: Value?
    private var continuation: CheckedContinuation<Value, Never>?

    func wait() async -> Value {
        if let buffered {
            self.buffered = nil
            return buffered
        }
        return await withCheckedContinuation { continuation = $0 }
    }

    func resolve(_ value: Value) {
        if let continuation {
            self.continuation = nil
            continuation.resume(returning: value)
        } else {
            buffered = value
        }
    }
}

private func scorerPoint(
    _ n: Int,
    winner: Winner? = nil,
    isLet: Bool = false,
    scoredAt: Double? = nil,
    cutT0: Double? = 50,
    t0: Double? = 100,
    t1: Double? = 109,
    edited: Bool = false,
    tightStart: Bool = false,
    tightEnd: Bool = false
) -> ScorerCommandPoint {
    ScorerCommandPoint(
        id: uuid(n),
        state: ScorerState(winner: winner, isLet: isLet, scoredAt: scoredAt),
        timing: ScorerTimingGuard(
            cutT0: cutT0, t0: t0, t1: t1, edited: edited,
            tightStart: tightStart, tightEnd: tightEnd
        )
    )
}

private func settle() async {
    try? await Task.sleep(nanoseconds: 10_000_000)
}

@MainActor
func runScorerStateChecks() async {
    print("\n— scorer state —")

    suite("outcome transitions keep endings separate") {
        let before = ScorerState(winner: .user, isLet: false, scoredAt: 60)
        let corrected = before.settingWinner(.opponent, observation: 51)
        eq(corrected, ScorerState(winner: .opponent, isLet: false, scoredAt: 60),
           "correcting the winner preserves the existing ending")
        eq(before.settingWinner(nil), ScorerState(winner: nil, isLet: false, scoredAt: nil),
           "clearing the winner clears the ending")
        eq(before.settingSkipped(true), ScorerState(winner: nil, isLet: true, scoredAt: nil),
           "Skip clears winner and ending together")
        eq(
            before.settingSkipped(true).settingSkipped(false),
            ScorerState(winner: nil, isLet: false, scoredAt: nil),
            "clearing Skip leaves all three scorer fields inactive"
        )
    }

    suite("only active first answers can create endings") {
        let unanswered = ScorerState(winner: nil, isLet: false, scoredAt: nil)
        eq(
            unanswered.settingWinner(.user, observation: 50.4),
            ScorerState(winner: .user, isLet: false, scoredAt: 50.4),
            "a finite first-answer observation becomes the ending"
        )
        eq(
            unanswered.settingWinner(.user, observation: .nan),
            ScorerState(winner: .user, isLet: false, scoredAt: nil),
            "a NaN observation is rejected without blocking the score"
        )
        eq(
            ScorerState(winner: nil, isLet: false, scoredAt: 60)
                .settingWinner(.user),
            ScorerState(winner: .user, isLet: false, scoredAt: nil),
            "an unanswered orphan tap cannot reactivate"
        )
        eq(
            ScorerState(winner: nil, isLet: true, scoredAt: 60)
                .settingWinner(.opponent, observation: 61),
            ScorerState(winner: .opponent, isLet: false, scoredAt: nil),
            "a skipped row cannot reactivate an orphan tap"
        )
    }

    suite("full-card reading preserves a corrected ending") {
        var point = mkPoint(22, winner: .user, cutT0: 50, t0: 100, t1: 109,
                            scoredAtCutS: 60)
        let corrected = ScorerState(point).settingWinner(.opponent, observation: 51)
        point.confirmedWinner = corrected.winner
        point.scoredAtCutS = corrected.scoredAt
        let pad = ClipPad(pre: 1, post: 1)
        let ends = EndOptions(tapEnd: true, keepScoreFullCard: true)
        near(effectiveEnd(point, pad, scorekeeperEnds(ends)), 61,
             "Keep score plays the corrected card through its full ending")
        near(effectiveEnd(point, pad, scorekeeperEnds(EndOptions(tapEnd: true))), 60.5,
             "turning off full-card restores the original tap ending")
        near(effectiveEnd(point, pad, ends), 60.5,
             "ordinary Watch still reads the saved tap ending")
        near(point.scoredAtCutS, 60, "the toggle never changes the saved observation")
    }

    let event = ScorePlaybackEvent(
        pointId: uuid(1), start: 50, end: 65, time: 50,
        playing: true, ready: true, foreground: true, sourceKey: "cut"
    )

    suite("playback observations require one continuous real-cut run") {
        let run = ScorePlaybackRun()
        run.observe(event)
        near(run.observation(event.with(time: 60)), 60,
             "ordinary continuous playback records the current cut time")

        let previous = ScorePlaybackEvent(
            pointId: uuid(101), start: 0, end: 9, time: 0,
            playing: true, ready: true, foreground: true, sourceKey: "cut"
        )
        run.observe(previous)
        run.observe(previous.with(time: 8.7))
        let accelerated = ScorePlaybackEvent(
            pointId: uuid(102), start: 9, end: 12, time: 9.1,
            playing: true, ready: true, foreground: true, sourceKey: "cut"
        )
        run.observe(accelerated)
        near(run.observation(accelerated.with(time: 9.5)), 9.5,
             "a continuous accelerated step across the start arms the next point")

        let stalePoint = accelerated.with(
            pointId: uuid(103), start: 80, end: 90, time: 83
        )
        run.observe(stalePoint)
        check(run.observation(stalePoint.with(time: 84)) == nil,
              "a multi-second jump to another point cannot masquerade as continuity")

        run.invalidate()
        run.observe(event.with(time: 59))
        check(run.observation(event.with(time: 60)) == nil,
              "a scrubbed mid-rally run cannot create an ending")

        run.observe(event)
        run.observe(event.with(time: 55, playing: false))
        run.observe(event.with(time: 55, playing: true))
        check(run.observation(event.with(time: 56)) == nil,
              "manual pause and mid-rally resume retire the run")

        run.observe(event)
        run.observe(event.with(time: 60, playing: false))
        check(run.observation(event.with(time: 60)) == nil,
              "the automatic end pause cannot become its own evidence")

        run.observe(event)
        run.observe(event.with(time: 54, ready: false))
        run.observe(event.with(time: 54, ready: true))
        check(run.observation(event.with(time: 55)) == nil,
              "buffering and recovery mid-rally retire the run")

        run.observe(event)
        run.observe(event.with(time: 53, foreground: false))
        run.observe(event.with(time: 53, foreground: true))
        check(run.observation(event.with(time: 54)) == nil,
              "backgrounding and returning mid-rally retire the run")

        run.observe(event)
        let delayedWaiting = ScorePlaybackTransportChange(isPlaying: false)
        let recoveredBeforeDelivery = ScorePlaybackTransportChange(isPlaying: true)
        delayedWaiting.apply(
            onPlaying: { run.observe(event.with(time: 55)) },
            onInterrupted: { run.invalidate() }
        )
        recoveredBeforeDelivery.apply(
            onPlaying: { run.observe(event.with(time: 55)) },
            onInterrupted: { run.invalidate() }
        )
        check(run.observation(event.with(time: 56)) == nil,
              "a delayed waiting callback still retires the run after recovery")
    }

    suite("playback observations stay on their original target and source") {
        let run = ScorePlaybackRun()
        run.observe(event)
        check(run.observation(event.with(pointId: uuid(2), time: 55)) == nil,
              "a different point cannot consume the run")
        check(run.observation(event.with(time: 55, sourceKey: "point:1")) == nil,
              "a point-clip clock cannot consume a cut run")
        check(run.observation(event.with(end: 64, time: 55)) == nil,
              "a changed timing window cannot consume the run")

        let short = event.with(end: 50.12)
        run.observe(short)
        near(run.observation(short.with(time: 50.1)), 50.1,
             "a sub-second rally has no duration minimum")

        check(scorePlaybackSourceKey(actualCut: true, requiresOwnClip: true) == nil,
              "a known own-clip candidate cannot use cut fallback as evidence")
        check(
            scorePlaybackSourceKey(
                actualCut: true, requiresOwnClip: false, latestSeekSettled: false
            ) == nil,
            "an in-flight seek cannot re-arm from an old periodic callback"
        )
        eq(scorePlaybackSourceKey(actualCut: true, requiresOwnClip: false), "cut",
           "proven cut playback names the cut source")
    }

    print("\n— scorer commands —")

    for interaction in ["sheet stays open", "sheet dismissed", "ordinary Undo"] {
        let h = ScorerHarness([scorerPoint(302, winner: .user, scoredAt: 60)])
        let effects = ScorerSessionEffects()
        effects.open()
        let clear = h.commands.beginWinner(uuid(302), side: .user)
        let owner = effects.capture()
        let restore = h.commands.beginRestore(uuid(302), after: clear)
        var replays = 0
        let completion = Task { @MainActor in
            _ = await restore.value
            if effects.owns(owner) { replays += 1 }
        }
        var sheetOpen = false
        var pauses = 0
        if interaction != "ordinary Undo" {
            effects.pauseForInteraction {
                check(!effects.owns(owner),
                      "sheet pause retires Undo ownership before the transport callback")
                pauses += 1
            }
            sheetOpen = true
        }
        // SwiftUI dismissal only clears presentation state. It must not
        // re-arm the old completion, even if the sheet has already gone.
        if interaction == "sheet dismissed" { sheetOpen = false }
        await settle()
        await h.writes[0].gate.resolve(true)
        await settle()
        await h.writes[1].gate.resolve(true)
        await completion.value
        eq(h.remote[uuid(302)]!.state,
           ScorerState(winner: .user, isLet: false, scoredAt: 60),
           "Undo restores all scorer fields when \(interaction)")
        eq(replays, interaction == "ordinary Undo" ? 1 : 0,
           "delayed replay respects the deliberate pause when \(interaction)")
        eq(pauses, interaction == "ordinary Undo" ? 0 : 1,
           "one deliberate interaction invokes one transport pause")
        eq(sheetOpen, interaction == "sheet stays open",
           "completion leaves the user's presentation state alone")
    }

    for action in ["close", "reopen", "navigate", "unchanged"] {
        let h = ScorerHarness([scorerPoint(301, winner: .user, scoredAt: 60)])
        let effects = ScorerSessionEffects()
        effects.open()
        let clear = h.commands.beginWinner(uuid(301), side: .user)
        let owner = effects.capture()
        let restore = h.commands.beginRestore(uuid(301), after: clear)
        var replays = 0
        let completion = Task { @MainActor in
            _ = await restore.value
            if effects.owns(owner) { replays += 1 }
        }
        if action == "close" || action == "reopen" { effects.close() }
        if action == "reopen" { effects.open() }
        if action == "navigate" { effects.navigate() }
        await settle()
        await h.writes[0].gate.resolve(true)
        await settle()
        await h.writes[1].gate.resolve(true)
        await completion.value
        eq(h.remote[uuid(301)]!.state.scoredAt, 60,
           "delayed Undo still restores persistence after \(action)")
        eq(replays, action == "unchanged" ? 1 : 0,
           "delayed Undo respects \(action) playback ownership")
    }

    do {
        let h = ScorerHarness([scorerPoint(10, winner: .user, scoredAt: 60)])
        let command = Task { await h.commands.winner(uuid(10), side: .opponent, observation: 51) }
        await settle()
        eq(h.writes.count, 1, "a correction emits one coupled write")
        eq(h.writes[0].state, ScorerState(winner: .opponent, isLet: false, scoredAt: 60),
           "a queued correction preserves the original ending")
        await h.writes[0].gate.resolve(true)
        let receipt = await command.value
        check(receipt != nil, "a successful correction returns a receipt")
    }

    do {
        let h = ScorerHarness([scorerPoint(11, winner: .user, scoredAt: 60)])
        let command = Task { await h.commands.winner(uuid(11), side: .user) }
        await settle()
        eq(h.writes[0].state, ScorerState(winner: nil, isLet: false, scoredAt: nil),
           "clear writes all three scorer fields")
        var changed = h.local[uuid(11)]!
        changed.timing.t1 = 110
        h.local[uuid(11)] = changed
        await h.writes[0].gate.resolve(false)
        check(await command.value == nil, "a failed clear returns no receipt")
        eq(h.local[uuid(11)]!.state,
           ScorerState(winner: .user, isLet: false, scoredAt: nil),
           "failed rollback restores the outcome but not a tap from an old window")
        eq(h.local[uuid(11)]!.timing.t1, 110,
           "failed rollback preserves the newer timing window")
    }

    do {
        let h = ScorerHarness([scorerPoint(12, winner: .user, scoredAt: 60)])
        let command = Task { await h.commands.skip(uuid(12), next: true) }
        await settle()
        eq(h.writes[0].state, ScorerState(winner: nil, isLet: true, scoredAt: nil),
           "Skip persists winner, Skip, and ending atomically")
        await h.writes[0].gate.resolve(false)
        check(await command.value == nil, "a failed Skip returns no receipt")
        eq(h.local[uuid(12)]!.state,
           ScorerState(winner: .user, isLet: false, scoredAt: 60),
           "a failed Skip restores the complete prior scorer state")
    }

    do {
        let h = ScorerHarness([scorerPoint(121, winner: .user, scoredAt: 60)])
        let clear = Task { await h.commands.winner(uuid(121), side: .user) }
        await settle()
        await h.writes[0].gate.resolve(true)
        let receipt = await clear.value!
        let undo = Task { await h.commands.restore(receipt) }
        await settle()
        eq(h.writes[1].state, ScorerState(winner: .user, isLet: false, scoredAt: 60),
           "clear Undo restores winner and ending together")
        await h.writes[1].gate.resolve(true)
        check(await undo.value != nil, "clear Undo completes successfully")
    }

    do {
        let h = ScorerHarness([scorerPoint(122, winner: .opponent, scoredAt: 61)])
        let skip = Task { await h.commands.skip(uuid(122), next: true) }
        await settle()
        await h.writes[0].gate.resolve(true)
        let receipt = await skip.value!
        let undo = Task { await h.commands.restore(receipt) }
        await settle()
        eq(h.writes[1].state,
           ScorerState(winner: .opponent, isLet: false, scoredAt: 61),
           "Skip Undo restores winner, Skip, and ending together")
        await h.writes[1].gate.resolve(true)
        check(await undo.value != nil, "Skip Undo completes successfully")
    }

    do {
        let h = ScorerHarness([scorerPoint(13)])
        let command = Task { await h.commands.winner(uuid(13), side: .user, observation: 60) }
        let undo = Task {
            guard let receipt = await command.value else { return nil as ScorerCommandReceipt? }
            return await h.commands.restore(receipt)
        }
        await settle()
        eq(h.writes.count, 1, "immediate Undo waits while its score is pending")
        await h.writes[0].gate.resolve(true)
        await settle()
        eq(h.writes.count, 2, "immediate Undo writes only after the score receipt")
        eq(h.writes[1].state, ScorerState(winner: nil, isLet: false, scoredAt: nil),
           "immediate Undo restores the complete before state")
        await h.writes[1].gate.resolve(true)
        check(await undo.value != nil, "the completed immediate Undo returns a receipt")
    }

    do {
        let h = ScorerHarness([scorerPoint(14)])
        let first = Task { await h.commands.winner(uuid(14), side: .user, observation: 60) }
        let correction = Task { await h.commands.winner(uuid(14), side: .opponent, observation: 51) }
        await settle()
        eq(h.writes.count, 1, "same-point scores serialize while the first is pending")
        await h.writes[0].gate.resolve(true)
        _ = await first.value
        await settle()
        eq(h.writes.count, 2, "the correction starts after the first score settles")
        eq(h.writes[1].state, ScorerState(winner: .opponent, isLet: false, scoredAt: 60),
           "the pending correction keeps the first score's ending")
        await h.writes[1].gate.resolve(true)
        check(await correction.value != nil, "the serialized correction succeeds")
    }

    do {
        let h = ScorerHarness([scorerPoint(141, winner: .user, scoredAt: 60)])
        let clear = h.commands.beginWinner(uuid(141), side: .user)
        await settle()
        eq(h.writes.count, 1, "the pending Clear owns the first queue position")

        let undo = h.commands.beginRestore(uuid(141), after: clear)
        let opponent = h.commands.beginWinner(uuid(141), side: .opponent)
        await h.writes[0].gate.resolve(true)
        await settle()
        eq(h.writes.count, 2, "Undo reserves the next queue position before its receipt")
        eq(h.writes[1].state,
           ScorerState(winner: .user, isLet: false, scoredAt: 60),
           "reserved Undo restores the cleared winner and ending")

        await h.writes[1].gate.resolve(true)
        check(await undo.value != nil, "reserved Undo succeeds")
        await settle()
        eq(h.writes.count, 3, "the later opponent score waits behind Undo")
        eq(h.writes[2].state,
           ScorerState(winner: .opponent, isLet: false, scoredAt: 60),
           "the later correction reads restored state and preserves tap 60")
        await h.writes[2].gate.resolve(true)
        check(await opponent.value != nil, "the later correction succeeds")
    }

    do {
        let initial = scorerPoint(15, isLet: true)
        let h = ScorerHarness([initial])
        let unskip = Task { await h.commands.skip(uuid(15), next: false) }
        let score = Task {
            await h.commands.winner(
                uuid(15), side: .opponent, observation: 51,
                observationTiming: initial.timing
            )
        }
        await settle()
        var retimed = h.local[uuid(15)]!
        retimed.timing.t1 = 110
        h.local[uuid(15)] = retimed
        await h.writes[0].gate.resolve(true)
        _ = await unskip.value
        await settle()
        eq(h.writes[1].state, ScorerState(winner: .opponent, isLet: false, scoredAt: nil),
           "a queued capture cannot carry evidence into a changed timing window")
        await h.writes[1].gate.resolve(true)
        check(await score.value != nil, "the retimed point still accepts its score")
    }

    do {
        let h = ScorerHarness([scorerPoint(16, edited: true)])
        let command = Task { await h.commands.winner(uuid(16), side: .user, observation: 60) }
        await settle()
        eq(h.writes[0].state, ScorerState(winner: .user, isLet: false, scoredAt: nil),
           "a currently edited point cannot create a tap")
        await h.writes[0].gate.resolve(true)
        _ = await command.value
    }

    do {
        let h = ScorerHarness([scorerPoint(17, winner: .opponent, scoredAt: 60)])
        let noOp = await h.commands.winner(uuid(17), side: .opponent, force: true)
        check(noOp == nil, "Why on an unchanged winner creates no receipt")
        check(h.writes.isEmpty, "Why on an unchanged winner creates no write")
    }

    do {
        let h = ScorerHarness([scorerPoint(18)])
        let command = Task { await h.commands.winner(uuid(18), side: .user, observation: 60) }
        await settle()
        await h.writes[0].gate.resolve(true)
        let receipt = await command.value!
        let undo = Task { await h.commands.restore(receipt) }
        await settle()
        await h.writes[1].gate.resolve(false)
        check(await undo.value == nil, "a failed Undo returns no receipt for retry")
        eq(h.local[uuid(18)]!.state,
           ScorerState(winner: .user, isLet: false, scoredAt: 60),
           "a failed Undo keeps the committed scorer state")
    }

    do {
        let h = ScorerHarness([scorerPoint(19, winner: .user, scoredAt: 60)])
        let command = Task { await h.commands.winner(uuid(19), side: .user) }
        await settle()
        var newer = h.local[uuid(19)]!
        newer.state = ScorerState(winner: .opponent, isLet: false, scoredAt: 61)
        h.local[uuid(19)] = newer
        await h.writes[0].gate.resolve(false)
        _ = await command.value
        eq(h.local[uuid(19)]!.state,
           ScorerState(winner: .opponent, isLet: false, scoredAt: 61),
           "a failed request cannot roll back a newer owner of the outcome")
    }

    do {
        let h = ScorerHarness([scorerPoint(20), scorerPoint(21, cutT0: 70)])
        let a = Task { await h.commands.winner(uuid(20), side: .user, observation: 60) }
        let b = Task { await h.commands.winner(uuid(21), side: .opponent, observation: 75) }
        await settle()
        eq(h.writes.count, 2, "different points may persist concurrently")
        let ai = h.writes.firstIndex { $0.pointId == uuid(20) }!
        let bi = h.writes.firstIndex { $0.pointId == uuid(21) }!
        await h.writes[bi].gate.resolve(true)
        check(await b.value != nil, "the second point can finish first")
        check(h.remote[uuid(20)]!.state.winner == nil,
              "finishing another point does not settle the first")
        await h.writes[ai].gate.resolve(true)
        check(await a.value != nil, "the first point can finish later")
    }
}
