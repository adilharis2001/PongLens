import Foundation

// Port-parity checks for Core/HandCut.swift against the web's own output.
//
// fixtures/handcut-parity.json is written by scripts/handcut-fixture.ts,
// which drives the REAL src/app/match/[id]/handCut.ts through scripted
// marking sessions and records the whole state after every step. This
// replays every step here and demands the same marks, undo stack, selection
// and awaited point after each one, the same refusal, and the same answer
// from every query. Same arrangement as the serve and rally-end parity
// checks: the port is measured against the original's OUTPUT, never against
// a second reading of the spec.
//
// Numbers are compared exactly. The fixture's floating-point edges (10.1 -
// 9.4 falling just short of 0.7, a lead of 0.8999999999999999) are there on
// purpose: Swift's Double does the same IEEE arithmetic, so any difference
// is a real one.

func runHandCutParityChecks() {
    print("\nhand cut rules (parity with handCut.ts)")
    let url = URL(fileURLWithPath: "fixtures/handcut-parity.json")
    guard let data = try? Data(contentsOf: url),
          let fx = try? JSONDecoder().decode(HandCutJSON.self, from: data)
    else {
        check(false, "hand cut fixture loads")
        return
    }

    // Constants, the lead, and every sentence the player can be shown.
    if let k = fx["constants"] {
        eq(k["MIN_POINT_S"], .number(HandCut.MIN_POINT_S), "MIN_POINT_S")
        eq(k["MAX_POINT_S"], .number(HandCut.MAX_POINT_S), "MAX_POINT_S")
        eq(k["LONGEST_POINT_S"], .number(HandCut.LONGEST_POINT_S), "LONGEST_POINT_S")
        eq(k["PAST_END_ALLOWANCE_S"], .number(HandCut.PAST_END_ALLOWANCE_S), "PAST_END_ALLOWANCE_S")
        eq(k["MAX_MARKS"], .number(Double(HandCut.MAX_MARKS)), "MAX_MARKS")
        eq(k["SPLIT_LEAD_S"], .number(HandCut.SPLIT_LEAD_S), "SPLIT_LEAD_S")
        eq(k["LEAD_MIN_S"], .number(HandCut.LEAD_MIN_S), "LEAD_MIN_S")
        eq(k["LEAD_MAX_S"], .number(HandCut.LEAD_MAX_S), "LEAD_MAX_S")
        eq(k["GAP_WORTH_MARKING_S"], .number(HandCut.GAP_WORTH_MARKING_S), "GAP_WORTH_MARKING_S")
        eq(k["TAIL_S"], .number(HandCut.TAIL_S), "TAIL_S")
    } else {
        check(false, "fixture has constants")
    }
    if case .array(let leads)? = fx["leadFor"] {
        for row in leads {
            guard case .number(let rate)? = row["rate"] else { continue }
            eq(HandCutJSON.number(HandCut.leadFor(rate)), row["lead"] ?? .null, "leadFor(\(rate))")
        }
    }
    if case .object(let refusals)? = fx["refusals"] {
        eq(refusals.count, HandCutRefusal.allCases.count, "every refusal is ported")
        for r in HandCutRefusal.allCases {
            eq(refusals[r.rawValue], .string(r.text), "refusal \(r.rawValue) word for word")
        }
    }
    if case .object(let invalid)? = fx["invalid"] {
        eq(invalid.count, HandCutInvalid.allCases.count, "every validate reason is ported")
        for r in HandCutInvalid.allCases {
            eq(invalid[r.rawValue], .string(r.text), "invalid \(r.rawValue) word for word")
        }
    }

    guard case .array(let cases)? = fx["cases"] else {
        check(false, "fixture has cases")
        return
    }
    var stepCount = 0
    for c in cases { stepCount += runHandCutCase(c) }
    var checkCount = 0
    if case .array(let fnChecks)? = fx["checks"] {
        for ch in fnChecks {
            runHandCutCheck(ch)
            checkCount += 1
        }
    }
    print("  replayed \(cases.count) cases, \(stepCount) steps, \(checkCount) checks")
    check(cases.count == 35 && stepCount == 401 && checkCount == 46,
          "the whole fixture was replayed (35 cases, 401 steps, 46 checks)")

    runHandCutPortChecks()
    runHandCutGateChecks()
}

// MARK: - The gate and playback that runs on (post-rollout audit A)

/// Every gate's way in, and the follow rule that keeps the selection on the
/// point the picture is showing.
private func runHandCutGateChecks() {
    func mark(_ id: String, _ t0: Double, _ t1: Double?, _ winner: Winner? = nil, isLet: Bool = false) -> HandCutMark {
        HandCutMark(id: id, t0: t0, t1: t1, winner: winner, isLet: isLet, starred: false, tap: t0, rate: 1)
    }
    // a called, b and c still to call, d called.
    let marks = [mark("a", 10, 20, .user), mark("b", 40, 50), mark("c", 60, 70), mark("d", 90, 100, .opponent)]
    let called = [mark("a", 10, 20, .user), mark("b", 40, 50, isLet: true), mark("c", 60, 70, .opponent)]

    // The four gates.
    eq(HandCut.gateStart(.fresh, marks: []), .play, "fresh: Begin Cutting plays on")
    eq(HandCut.gateStart(.scoring, marks: marks), .playMark(id: "b"),
       "scoring: Keep marking shows the first point without a winner")
    eq(HandCut.gateStart(.scoring, marks: marks, reviewPoints: true), .playMark(id: "b"),
       "scoring has one way in, whichever button")
    eq(HandCut.gateStart(.scoring, marks: called), .resumeMarking,
       "scoring with nothing left to call carries on marking")
    eq(HandCut.gateStart(.review, marks: called), .playMark(id: "a"), "review: Begin review shows the first point")
    eq(HandCut.gateStart(.review, marks: []), .play, "review with nothing closed plays on")
    eq(HandCut.gateStart(.choice, marks: called), .resumeMarking,
       "choice: Keep marking goes back to where the marking got to")
    eq(HandCut.gateStart(.choice, marks: called, reviewPoints: true), .playMark(id: "a"),
       "choice: Review the points shows the first point")
    // The gate each draft opens as, end to end.
    eq(HandCut.gateStart(HandCut.openAs(marks, durationS: 600), marks: marks), .playMark(id: "b"),
       "a draft with points still to call opens on the first of them")
    eq(HandCut.gateStart(HandCut.openAs(called, durationS: 600), marks: called), .resumeMarking,
       "a called draft with match left carries on from the last point")
    eq(HandCut.gateStart(HandCut.openAs(called, durationS: 100), marks: called), .playMark(id: "a"),
       "a called draft that reaches the end is reviewed")

    // Following playback: b selected, its clip padded 1.2 before and 1.3 after.
    let pre = 1.2, post = 1.3
    var s = HandCutState(marks: marks, selectedId: "b")
    check(HandCut.follow(s, at: 45, adjusting: false, pre: pre, post: post) == nil,
          "inside the selected point nothing moves")
    check(HandCut.follow(s, at: 51, adjusting: false, pre: pre, post: post) == nil,
          "in the gap before the next point's window nothing moves")
    let intoC = HandCut.follow(s, at: 58.9, adjusting: false, pre: pre, post: post)
    eq(intoC?.id, "c", "crossing into the next point's padded window selects it")
    near(intoC?.stopAt, 71.3, "and stops at its padded end")
    eq(HandCut.follow(s, at: 95, adjusting: false, pre: pre, post: post)?.id, "d",
       "a jump past a whole point lands on the one the picture is in")
    check(HandCut.follow(s, at: 101.4, adjusting: false, pre: pre, post: post) == nil,
          "past the last point's window there is nothing to follow")
    check(HandCut.follow(s, at: 58.9, adjusting: true, pre: pre, post: post) == nil,
          "never while an edge is being adjusted")
    s.awaitingId = "b"
    check(HandCut.follow(s, at: 58.9, adjusting: false, pre: pre, post: post) == nil,
          "never while a point waits for its answer")
    s.awaitingId = nil
    check(HandCut.follow(HandCutState(marks: marks), at: 58.9, adjusting: false, pre: pre, post: post) == nil,
          "never with nothing selected")
    let open = marks + [mark("e", 120, nil)]
    check(HandCut.follow(HandCutState(marks: open, selectedId: "b"), at: 58.9, adjusting: false,
                         pre: pre, post: post) == nil,
          "never while a rally is being marked")
    // Windows that overlap: the next point's pad starts inside the selected
    // point's tail. The picture must leave the rally first.
    let close = [mark("x", 10, 20), mark("y", 21, 30)]
    let tight = HandCutState(marks: close, selectedId: "x")
    check(HandCut.follow(tight, at: 19.9, adjusting: false, pre: pre, post: post) == nil,
          "an overlapping pad does not take the selection mid-rally")
    eq(HandCut.follow(tight, at: 20.2, adjusting: false, pre: pre, post: post)?.id, "y",
       "past the rally's end, the next point's pad takes it")
}

// MARK: - Replaying a case

private func runHandCutCase(_ c: HandCutJSON) -> Int {
    let name = c["name"].flatMap(stringValue) ?? "?"

    var state = HandCutState()
    if let start = c["start"] {
        state.marks = strictMarks(start["marks"])
        state.selectedId = start["selectedId"].flatMap(stringValue)
        state.awaitingId = start["awaitingId"].flatMap(stringValue)
        eq(stateJSON(state), start, "\(name): start state reads back")
    }

    guard case .array(let steps)? = c["steps"] else { return 0 }
    for (n, step) in steps.enumerated() {
        let op = step["op"].flatMap(stringValue) ?? "?"
        let args = step["args"] ?? .object([:])
        let label = "\(name) · step \(n + 1) \(op)"
        var applied: HandCutApplied?
        var result: HandCutJSON?

        switch op {
        case "start":
            applied = HandCut.startMark(
                state,
                now: numberValue(step["now"]) ?? .nan,
                rate: numberValue(step["rate"]) ?? 1,
                id: args["id"].flatMap(stringValue) ?? ""
            )
        case "end":
            applied = HandCut.endMark(state, now: numberValue(step["now"]) ?? .nan)
        case "outcome":
            let o = args["outcome"].flatMap(stringValue).flatMap(HandCutOutcome.init(rawValue:))
            applied = HandCut.setOutcome(state, o ?? .user)
        case "star":
            applied = HandCut.toggleStar(state, id: args["id"].flatMap(stringValue) ?? "")
        case "clearAwaiting":
            state = HandCut.clearAwaiting(state)
        case "select":
            state = HandCut.selectMark(state, id: args["id"].flatMap(stringValue))
        case "moveEdge":
            applied = HandCut.moveEdge(
                state,
                id: args["id"].flatMap(stringValue) ?? "",
                edge: args["edge"].flatMap(stringValue).flatMap(HandCutEdge.init(rawValue:)) ?? .t0,
                delta: numberValue(args["delta"]) ?? 0
            )
        case "setEdges":
            applied = HandCut.setEdges(
                state,
                id: args["id"].flatMap(stringValue) ?? "",
                t0: numberValue(args["t0"]) ?? .nan,
                t1: numberValue(args["t1"]) ?? .nan
            )
        case "insert":
            applied = HandCut.insertMark(
                state,
                t0: numberValue(args["t0"]) ?? .nan,
                t1: numberValue(args["t1"]) ?? .nan,
                id: args["id"].flatMap(stringValue) ?? ""
            )
        case "remove":
            applied = HandCut.removeMark(state, id: args["id"].flatMap(stringValue) ?? "")
        case "reset":
            let r = HandCut.resetOpen(state)
            state = r.state
            result = .object(["backTo": .number(r.backTo)])
        case "undo":
            state = HandCut.undoLast(state)
        case "load":
            state = HandCutState(marks: HandCut.normalizeMarks(args["raw"]))

        case "openMark":
            result = HandCut.openMark(state.marks).map { .string($0.id) } ?? .null
        case "lastClosedEnd":
            result = HandCut.lastClosedEnd(state.marks).map { .number($0) } ?? .null
        case "firstUnscored":
            result = HandCut.firstUnscored(
                state.marks, afterId: args["afterId"].flatMap(stringValue)
            ).map { .string($0.id) } ?? .null
        case "allCalled":
            result = .bool(HandCut.allCalled(state.marks))
        case "gapsAround":
            let g = HandCut.gapsAround(
                state.marks, id: args["id"].flatMap(stringValue),
                durationS: numberValue(args["durationS"])
            )
            result = gapsJSON(g)
        case "draftMode":
            let recorded = args["recorded"].flatMap(stringValue).flatMap(HandCutMode.init(rawValue:))
            result = .string(HandCut.draftMode(state.marks, recorded: recorded).rawValue)
        case "openAs":
            let mode = args["mode"].flatMap(stringValue).flatMap(HandCutMode.init(rawValue:)) ?? .score
            result = .string(HandCut.openAs(
                state.marks, durationS: numberValue(args["durationS"]), mode: mode
            ).rawValue)
        case "summarize":
            result = summaryJSON(HandCut.summarize(state.marks))
        case "submittable":
            result = .array(HandCut.submittable(state.marks).map(submissionJSON))
        case "validate":
            result = validationJSON(HandCut.validate(state.marks, durationS: numberValue(args["durationS"])))
        case "asPoints":
            result = .array(HandCut.asPoints(state.marks).map(pointJSON))
        case "score":
            result = scoreJSON(handCutScore(state.marks))
        case "nextServer":
            let first = args["firstServer"].flatMap(stringValue).flatMap(Winner.init(rawValue:))
            result = winnerJSON(handCutNextServer(state.marks, firstServer: first))
        default:
            check(false, "\(label): unknown op")
            continue
        }

        if let applied { state = applied.state }
        let refusedKey: HandCutJSON = applied?.refused.map { .string($0.rawValue) } ?? .null
        eq(refusedKey, step["refused"] ?? .null, "\(label): refusal")
        if let wanted = step["result"] {
            eq(result ?? .null, wanted, "\(label): result")
        } else {
            check(result == nil, "\(label): no result expected")
        }
        eq(stateJSON(state), step["expect"] ?? .null, "\(label): state")
    }
    return steps.count
}

private func runHandCutCheck(_ ch: HandCutJSON) {
    let fn = ch["fn"].flatMap(stringValue) ?? "?"
    let args = ch["args"] ?? .object([:])
    let marks = strictMarks(args["marks"])
    let wanted = ch["result"] ?? .null
    let got: HandCutJSON
    switch fn {
    case "openAs":
        let mode = args["mode"].flatMap(stringValue).flatMap(HandCutMode.init(rawValue:)) ?? .score
        got = .string(HandCut.openAs(marks, durationS: numberValue(args["durationS"]), mode: mode).rawValue)
    case "draftMode":
        let recorded = args["recorded"].flatMap(stringValue).flatMap(HandCutMode.init(rawValue:))
        got = .string(HandCut.draftMode(marks, recorded: recorded).rawValue)
    case "validate":
        got = validationJSON(HandCut.validate(marks, durationS: numberValue(args["durationS"])))
    case "normalizeMarks":
        got = .array(HandCut.normalizeMarks(args["raw"]).map(markJSON))
    case "firstUnscored":
        got = HandCut.firstUnscored(marks, afterId: args["afterId"].flatMap(stringValue))
            .map { .string($0.id) } ?? .null
    case "allCalled":
        got = .bool(HandCut.allCalled(marks))
    case "lastClosedEnd":
        got = HandCut.lastClosedEnd(marks).map { .number($0) } ?? .null
    default:
        check(false, "check \(fn): unknown function")
        return
    }
    eq(got, wanted, "check \(fn)(\(compact(args)))")
}

// MARK: - Swift-only checks: the score, the encoders, the round trip

private func runHandCutPortChecks() {
    // Where the Score switch starts: on for a fresh match, off for practice
    // and drills (always, whatever a draft recorded), and a draft's own
    // recorded mode otherwise.
    let called = [HandCutMark(id: "w", t0: 1, t1: 3, winner: .user, isLet: false, starred: false, tap: 1.6, rate: 1)]
    let uncalled = [HandCutMark(id: "u", t0: 1, t1: 3, winner: nil, isLet: false, starred: false, tap: 1.6, rate: 1)]
    eq(HandCut.openingMode([], recorded: nil, tracksServe: true), .score, "a fresh match opens with Score on")
    eq(HandCut.openingMode([], recorded: nil, tracksServe: false), .cut, "fresh practice opens with Score off")
    eq(HandCut.openingMode(called, recorded: .score, tracksServe: false), .cut, "practice never scores, even a scored draft")
    eq(HandCut.openingMode(uncalled, recorded: .cut, tracksServe: true), .cut, "a cut-only draft stays cut only")
    eq(HandCut.openingMode(uncalled, recorded: .score, tracksServe: true), .score, "a scoring draft keeps scoring")
    eq(HandCut.openingMode(uncalled, recorded: nil, tracksServe: true), .cut, "an old draft with nothing called was cut only")
    eq(HandCut.openingMode(called, recorded: nil, tracksServe: true), .score, "an old draft with winners was scoring")
    eq(HandCut.openingMode([], recorded: .cut, tracksServe: true), .cut, "an emptied draft keeps the switch where it was left")
    eq(HandCut.openingMode(called, recorded: .score, tracksServe: true, chosen: .cut), .cut,
       "the switch on the match page wins over the draft")
    eq(HandCut.openingMode([], recorded: nil, tracksServe: true, chosen: .cut), .cut, "and over the default")
    eq(HandCut.openingMode([], recorded: nil, tracksServe: false, chosen: .score), .cut,
       "but practice cannot be scored whatever is asked")
    eq(MatchTitle.tracksServe("practice") || MatchTitle.tracksServe("drills"), false, "practice and drills do not track serve")
    eq(MatchTitle.tracksServe(nil) && MatchTitle.tracksServe("match") && MatchTitle.tracksServe("tournament"), true,
       "matches, tournaments and an unset type do")

    // The ticker's score and next server come from the product's own walk
    // and rotation, over asPoints: a (user), b (opponent), c (let).
    var s = HandCutState()
    for (id, start, end, outcome) in [
        ("a", 10.0, 24.0, HandCutOutcome.user),
        ("b", 40.0, 55.0, .opponent),
        ("c", 70.0, 78.0, .let),
    ] {
        s = HandCut.startMark(s, now: start, rate: 1, id: id).state
        s = HandCut.endMark(s, now: end).state
        s = HandCut.setOutcome(s, outcome).state
    }
    let score = handCutScore(s.marks)
    eq(score.current.you, 1, "hand cut score: you")
    eq(score.current.them, 1, "hand cut score: them")
    // Me serves 1 and 2, Them serves 3, and a let is served again.
    eq(handCutNextServer(s.marks, firstServer: .user), .opponent, "next server after a let")
    eq(handCutNextServer([], firstServer: .opponent), .opponent, "no points: the first server")
    eq(handCutNextServer(s.marks, firstServer: nil), nil, "no first server: no rotation")
    // An open rally is not a point yet, so it does not move the rotation.
    let opened = HandCut.startMark(s, now: 90, rate: 1, id: "d").state
    eq(handCutNextServer(opened.marks, firstServer: .user), .opponent, "an open rally serves nothing")

    // Eleven straight: a game, then the first server changes ends.
    var g = HandCutState()
    for i in 0..<11 {
        let t = Double(i) * 20 + 5
        g = HandCut.startMark(g, now: t, rate: 1, id: "g\(i)").state
        g = HandCut.endMark(g, now: t + 10).state
        g = HandCut.setOutcome(g, .user).state
    }
    let gs = handCutScore(g.marks)
    eq(gs.gamesYou, 1, "eleven straight is a game")
    eq(gs.current.you + gs.current.them, 0, "a new game starts at 0-0")
    eq(handCutNextServer(g.marks, firstServer: .user), .opponent, "the other player opens game two")

    // The draft is written with every key, nulls included: the web DROPS
    // an entry whose t1 is missing rather than null.
    let enc = JSONEncoder()
    enc.outputFormatting = .sortedKeys
    let open = HandCutMark(id: "o", t0: 1.5, t1: nil, winner: nil, isLet: false,
                           starred: false, tap: 2.1, rate: 1)
    if let data = try? enc.encode(open), let text = String(data: data, encoding: .utf8) {
        eq(text, #"{"id":"o","isLet":false,"rate":1,"starred":false,"t0":1.5,"t1":null,"tap":2.1,"winner":null}"#,
           "an open mark encodes t1 and winner as null")
    } else {
        check(false, "an open mark encodes")
    }
    let sub = HandCut.submittable([HandCutMark(id: "x", t0: 1, t1: 3, winner: nil, isLet: true,
                                               starred: true, tap: 1.6, rate: 2)])
    if let data = try? enc.encode(sub), let text = String(data: data, encoding: .utf8) {
        eq(text, #"[{"let":true,"rate":2,"star":true,"t0":1,"t1":3,"tap":1.6,"w":null}]"#,
           "claim_hand_cut rows are the web's short form")
    } else {
        check(false, "a submission encodes")
    }

    // A match marked again: the owner's game corrections are written only
    // where they are set, in the draft and in the claim, and read back.
    let pinned = HandCutMark(id: "p", t0: 4, t1: 6, winner: nil, isLet: false, starred: false,
                             tap: 4, rate: 1, gameEnd: .end, gameWinner: .opponent)
    if let data = try? enc.encode(pinned), let text = String(data: data, encoding: .utf8) {
        eq(text, #"{"gameEnd":"end","gameWinner":"opponent","id":"p","isLet":false,"rate":1,"starred":false,"t0":4,"t1":6,"tap":4,"winner":null}"#,
           "a mark carries its game end and winner")
    } else {
        check(false, "a pinned mark encodes")
    }
    if let data = try? enc.encode(HandCut.submittable([pinned])), let text = String(data: data, encoding: .utf8) {
        eq(text, #"[{"gameEnd":"end","gameWinner":"opponent","let":false,"rate":1,"star":false,"t0":4,"t1":6,"tap":4,"w":null}]"#,
           "and so does its claim row, under the same names")
    } else {
        check(false, "a pinned submission encodes")
    }
    if let data = try? JSONEncoder().encode(HandCut.submittable([pinned])),
       let back = try? JSONDecoder().decode(HandCutJSON.self, from: data) {
        let read = HandCut.normalizeMarks(back)
        eq(read.first?.gameEnd, .end, "a claim row reads back its game end")
        eq(read.first?.gameWinner, .opponent, "and its game winner")
    } else {
        check(false, "a pinned submission round-trips")
    }
    if let data = try? JSONEncoder().encode([pinned]),
       let back = try? JSONDecoder().decode([HandCutMark].self, from: data) {
        eq(back, [pinned], "the phone's own copy keeps them")
    } else {
        check(false, "the phone's copy round-trips")
    }

    // What the phone writes, the web reads back unchanged, and so does this.
    if let data = try? JSONEncoder().encode(s.marks + [open]),
       let back = try? JSONDecoder().decode(HandCutJSON.self, from: data) {
        let read = HandCut.normalizeMarks(back)
        eq(read, (s.marks + [open]).sorted { $0.t0 < $1.t0 }, "a saved draft reads back as the same marks")
    } else {
        check(false, "a saved draft round-trips")
    }
}

// MARK: - JSON helpers

private func stringValue(_ v: HandCutJSON) -> String? {
    if case .string(let s) = v { return s }
    return nil
}

private func numberValue(_ v: HandCutJSON?) -> Double? {
    if case .number(let n)? = v { return n }
    return nil
}

private func winnerJSON(_ w: Winner?) -> HandCutJSON {
    w.map { .string($0.rawValue) } ?? .null
}

private func optNumber(_ n: Double?) -> HandCutJSON {
    n.map { .number($0) } ?? .null
}

private func markJSON(_ m: HandCutMark) -> HandCutJSON {
    var o: [String: HandCutJSON] = [
        "id": .string(m.id), "t0": .number(m.t0), "t1": optNumber(m.t1),
        "winner": winnerJSON(m.winner), "isLet": .bool(m.isLet),
        "starred": .bool(m.starred), "tap": .number(m.tap), "rate": .number(m.rate),
    ]
    // Absent unless set, as the web writes them.
    if let g = m.gameEnd { o["gameEnd"] = .string(g.rawValue) }
    if let w = m.gameWinner { o["gameWinner"] = .string(w.rawValue) }
    return .object(o)
}

private func undoJSON(_ u: HandCutUndo) -> HandCutJSON {
    switch u {
    case .start(let id):
        return .object(["type": .string("start"), "id": .string(id)])
    case .startOver(let id, let prevId, let prevT1):
        return .object([
            "type": .string("start-over"), "id": .string(id),
            "prevId": .string(prevId), "prevT1": optNumber(prevT1),
        ])
    case .end(let id, let t1, let winner, let isLet):
        return .object([
            "type": .string("end"), "id": .string(id), "t1": optNumber(t1),
            "winner": winnerJSON(winner), "isLet": .bool(isLet),
        ])
    case .outcome(let id, let winner, let isLet):
        return .object([
            "type": .string("outcome"), "id": .string(id),
            "winner": winnerJSON(winner), "isLet": .bool(isLet),
        ])
    case .star(let id, let starred):
        return .object(["type": .string("star"), "id": .string(id), "starred": .bool(starred)])
    case .move(let id, let t0, let t1):
        return .object([
            "type": .string("move"), "id": .string(id), "t0": .number(t0), "t1": optNumber(t1),
        ])
    case .remove(let index, let mark):
        return .object([
            "type": .string("remove"), "index": .number(Double(index)), "mark": markJSON(mark),
        ])
    }
}

private func stateJSON(_ s: HandCutState) -> HandCutJSON {
    .object([
        "marks": .array(s.marks.map(markJSON)),
        "undo": .array(s.undo.map(undoJSON)),
        "selectedId": s.selectedId.map { .string($0) } ?? .null,
        "awaitingId": s.awaitingId.map { .string($0) } ?? .null,
    ])
}

private func gapsJSON(_ g: (before: HandCutGap?, after: HandCutGap?)) -> HandCutJSON {
    func one(_ gap: HandCutGap?) -> HandCutJSON {
        gap.map { .object(["lo": .number($0.lo), "hi": .number($0.hi)]) } ?? .null
    }
    return .object(["before": one(g.before), "after": one(g.after)])
}

private func summaryJSON(_ s: HandCutSummary) -> HandCutJSON {
    .object([
        "total": .number(Double(s.total)), "unscored": .number(Double(s.unscored)),
        "open": .bool(s.open), "long": .number(Double(s.long)),
        "starred": .number(Double(s.starred)),
    ])
}

private func submissionJSON(_ r: HandCutSubmission) -> HandCutJSON {
    var o: [String: HandCutJSON] = [
        "t0": .number(r.t0), "t1": .number(r.t1), "w": winnerJSON(r.w),
        "let": .bool(r.isLet), "star": .bool(r.star), "tap": .number(r.tap),
        "rate": .number(r.rate),
    ]
    if let g = r.gameEnd { o["gameEnd"] = .string(g.rawValue) }
    if let w = r.gameWinner { o["gameWinner"] = .string(w.rawValue) }
    return .object(o)
}

/// handCutScore as the fixture's plain numbers (scripts/handcut-fixture.ts
/// scoreResult): the running game, every closed game with the winner it
/// resolves to, and the games tally.
private func scoreJSON(_ s: MatchScore) -> HandCutJSON {
    .object([
        "current": .array([.number(Double(s.current.you)), .number(Double(s.current.them))]),
        "games": .array(s.games.map {
            .array([.number(Double($0.you)), .number(Double($0.them)), winnerJSON(resolvedGameWinner($0))])
        }),
        "gamesYou": .number(Double(s.gamesYou)),
        "gamesThem": .number(Double(s.gamesThem)),
    ])
}

private func validationJSON(_ v: HandCutInvalid?) -> HandCutJSON {
    guard let v else { return .object(["ok": .bool(true)]) }
    return .object([
        "ok": .bool(false), "reason": .string(v.text), "reasonKey": .string(v.rawValue),
    ])
}

private func pointJSON(_ p: HandCutPoint) -> HandCutJSON {
    .object([
        "id": .string(p.id), "confirmed_winner": winnerJSON(p.confirmedWinner),
        "is_let": .bool(p.isLet), "server_override": winnerJSON(p.serverOverride),
        "game_end_override": p.gameEndOverride.map { .string($0.rawValue) } ?? .null,
        "game_winner_override": winnerJSON(p.gameWinnerOverride),
    ])
}

/// Marks exactly as the generator built them, read field by field. Never
/// through normalizeMarks, which would quietly repair the very thing a
/// case might be about.
private func strictMarks(_ v: HandCutJSON?) -> [HandCutMark] {
    guard case .array(let rows)? = v else { return [] }
    return rows.compactMap { r in
        guard case .string(let id)? = r["id"], case .number(let t0)? = r["t0"],
              case .bool(let isLet)? = r["isLet"], case .bool(let starred)? = r["starred"],
              case .number(let tap)? = r["tap"], case .number(let rate)? = r["rate"]
        else {
            check(false, "fixture mark is well formed: \(compact(r))")
            return nil
        }
        let t1 = numberValue(r["t1"])
        let winner = r["winner"].flatMap(stringValue).flatMap(Winner.init(rawValue:))
        let gameEnd = r["gameEnd"].flatMap(stringValue).flatMap(GameEndOverride.init(rawValue:))
        let gameWinner = r["gameWinner"].flatMap(stringValue).flatMap(Winner.init(rawValue:))
        return HandCutMark(id: id, t0: t0, t1: t1, winner: winner, isLet: isLet,
                           starred: starred, tap: tap, rate: rate,
                           gameEnd: gameEnd, gameWinner: gameWinner)
    }
}

private func compact(_ v: HandCutJSON) -> String {
    let enc = JSONEncoder()
    enc.outputFormatting = .sortedKeys
    guard let data = try? enc.encode(v), let s = String(data: data, encoding: .utf8) else { return "?" }
    return s.count > 160 ? String(s.prefix(160)) + "…" : s
}
