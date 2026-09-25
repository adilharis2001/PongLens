import Foundation

// Port of src/app/match/[id]/handCut.ts: marking a match by hand, the whole
// rule, with no views and no clocks of its own.
//
// The player watches their own upload and taps three times per rally: Begin
// Point as the serve goes up, End Point when it finishes, then who won it.
// This file owns what each tap MEANS. It holds no video, reads no time and
// touches no network, so the rhythm can be tested by replaying taps.
//
// It is a line-for-line port, and it is held to the web by OUTPUT rather
// than by a second reading of the same sentences:
// ios/Tests/fixtures/handcut-parity.json is written by
// scripts/handcut-fixture.ts, which drives the real handCut.ts through
// scripted sessions and records the whole state after every step.
// HandCutTests.swift replays those steps here and demands the same state
// each time. Change the rule on the web first, regenerate, then port.
//
// WHAT THIS FILE DELIBERATELY DOES NOT KNOW: cut_t0, cut segments, and which
// seconds the cut keeps. The worker computes those once, through the same
// functions the automatic pipeline uses. A mark is in SOURCE seconds.
//
// Score and server are never computed here either. `handCutScore` and
// `handCutNextServer` hand `asPoints` to the product's own ports of the game
// walk and the ITTF rotation (GameScore.swift, Serving.swift).

/// A rally the player has marked. `t1` nil means it is still open.
///
/// The list is always ordered by `t0`. At most one mark is open, usually the
/// last, but a point removed from the middle ("Mark again") is marked again
/// in the gap it left, so the open rally can sit between two closed ones.
struct HandCutMark: Equatable {
    /// Stable within the session; the worker assigns the real row ids.
    var id: String
    /// Source seconds. Already carries the backward lead (`leadFor`).
    var t0: Double
    var t1: Double?
    var winner: Winner?
    var isLet: Bool
    var starred: Bool
    /// The raw playhead at the start tap, before the lead, and the rate it
    /// was tapped at.
    var tap: Double
    var rate: Double
}

/// The three answer buttons. Closing a point is End Point, a separate tap.
enum HandCutOutcome: String {
    case user, opponent
    case `let`
}

enum HandCutUndo: Equatable {
    case start(id: String)
    case startOver(id: String, prevId: String, prevT1: Double?)
    case end(id: String, t1: Double?, winner: Winner?, isLet: Bool)
    case outcome(id: String, winner: Winner?, isLet: Bool)
    case star(id: String, starred: Bool)
    case move(id: String, t0: Double, t1: Double?)
    case remove(index: Int, mark: HandCutMark)
}

struct HandCutState: Equatable {
    var marks: [HandCutMark] = []
    var undo: [HandCutUndo] = []
    /// A closed chip the player tapped, so the answers retarget it.
    var selectedId: String?
    /// The point just closed by End Point and not yet answered.
    var awaitingId: String?

    static let empty = HandCutState()
}

/// Refusals the player sees, inline, for a beat. Never a dialog. The raw
/// value is the web's key (`REFUSE.<key>`), the text is word for word.
enum HandCutRefusal: String, CaseIterable {
    case short, noneOpen, noneEnded, inside, past, insideAnother, intoNext

    var text: String {
        switch self {
        case .short: "Too short to be a point."
        case .noneOpen: "No point open."
        case .noneEnded: "End the point first."
        case .inside: "That's inside the last point."
        case .past: "That's before the last point ended."
        case .insideAnother: "That's inside another point."
        case .intoNext: "That runs into the next point."
        }
    }
}

/// Why `validate` refuses a submission, word for word (`INVALID.<key>`).
enum HandCutInvalid: String, CaseIterable {
    case empty, tooMany, noLength, short, tooLong, overlap, pastEnd, letAndWin

    var text: String {
        switch self {
        case .empty: "Nothing marked yet."
        case .tooMany: "That is more than 400 points."
        case .noLength: "A point has no length."
        case .short: HandCutRefusal.short.text
        case .tooLong: "A point is over three minutes long."
        case .overlap: "Two points overlap."
        case .pastEnd: "A point runs past the end of the video."
        case .letAndWin: "A point is both a let and a win."
        }
    }
}

struct HandCutApplied {
    var state: HandCutState
    /// Set when the tap changed nothing and the player must be told why.
    var refused: HandCutRefusal?
}

struct HandCutGap: Equatable {
    /// Source seconds a new point may occupy, exclusive of its neighbours.
    let lo: Double
    let hi: Double
}

/// Cutting only, or cutting and scoring.
enum HandCutMode: String, Codable {
    case cut, score
}

/// What the pad is on the way in.
enum HandCutOpenAs: String {
    /// Nothing marked: the cutting gate.
    case fresh
    /// Points still without a winner: the scoring pass, from the first one.
    case scoring
    /// Every point called and the tape ends with them: a review.
    case review
    /// Every point called but the match runs on: ask which they came for.
    case choice
}

struct HandCutSummary: Equatable {
    var total = 0
    var unscored = 0
    var open = false
    var long = 0
    var starred = 0
}

/// One row of what goes to `claim_hand_cut`: closed marks only, terse.
struct HandCutSubmission: Equatable, Encodable {
    let t0: Double
    let t1: Double
    let w: Winner?
    let isLet: Bool
    let star: Bool
    let tap: Double
    let rate: Double

    enum CodingKeys: String, CodingKey {
        case t0, t1, w, star, tap, rate
        case isLet = "let"
    }

    /// `w` is always present, null when uncalled, exactly as the web's
    /// JSON has it. The synthesized encoder would drop the key.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(t0, forKey: .t0)
        try c.encode(t1, forKey: .t1)
        if let w { try c.encode(w, forKey: .w) } else { try c.encodeNil(forKey: .w) }
        try c.encode(isLet, forKey: .isLet)
        try c.encode(star, forKey: .star)
        try c.encode(tap, forKey: .tap)
        try c.encode(rate, forKey: .rate)
    }
}

/// Marks as the fields the game walk and the rotation read.
struct HandCutPoint: Equatable {
    let id: String
    let confirmedWinner: Winner?
    let isLet: Bool
    let serverOverride: Winner? = nil
    let gameEndOverride: GameEndOverride? = nil
    let gameWinnerOverride: Winner? = nil
}

/// A JSON value with JavaScript's distinctions intact: a boolean is never a
/// number, and a key that is present with null is not a key that is absent.
/// `normalizeMarks` turns on both, and Foundation's `JSONSerialization`
/// erases the first (true and 1 both come back as NSNumber).
indirect enum HandCutJSON: Equatable, Codable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([HandCutJSON])
    case object([String: HandCutJSON])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        // Swift's JSONDecoder will not read a number as a Bool or a Bool
        // as a number, so this order keeps them apart.
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let n = try? c.decode(Double.self) { self = .number(n); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let a = try? c.decode([HandCutJSON].self) { self = .array(a); return }
        if let o = try? c.decode([String: HandCutJSON].self) { self = .object(o); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "not JSON")
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }

    subscript(key: String) -> HandCutJSON? {
        if case .object(let o) = self { return o[key] }
        return nil
    }
}

extension HandCutMark: Codable {
    enum CodingKeys: String, CodingKey {
        case id, t0, t1, winner, isLet, starred, tap, rate
    }

    /// Every key, nulls included. The web's reader DROPS an entry whose
    /// `t1` is missing rather than null, so an omitted key would lose the
    /// open rally on the other platform.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(t0, forKey: .t0)
        if let t1 { try c.encode(t1, forKey: .t1) } else { try c.encodeNil(forKey: .t1) }
        if let winner { try c.encode(winner, forKey: .winner) } else { try c.encodeNil(forKey: .winner) }
        try c.encode(isLet, forKey: .isLet)
        try c.encode(starred, forKey: .starred)
        try c.encode(tap, forKey: .tap)
        try c.encode(rate, forKey: .rate)
    }

    /// Stored drafts are read through `HandCut.normalizeMarks`, never this.
    /// It exists for the phone's own mirror, which only ever holds marks
    /// this file wrote.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        t0 = try c.decode(Double.self, forKey: .t0)
        t1 = try c.decodeIfPresent(Double.self, forKey: .t1)
        winner = try c.decodeIfPresent(Winner.self, forKey: .winner)
        isLet = try c.decode(Bool.self, forKey: .isLet)
        starred = try c.decode(Bool.self, forKey: .starred)
        tap = try c.decode(Double.self, forKey: .tap)
        rate = try c.decode(Double.self, forKey: .rate)
    }
}

enum HandCut {
    /// A rally shorter than this is a mis-tap, not a point. The client and
    /// the database apply the same floor.
    static let MIN_POINT_S = 0.7
    /// An allowance, not a refusal: counted as `long` in the review sheet.
    static let MAX_POINT_S = 120.0
    /// The bounds `claim_hand_cut` refuses a whole submission over.
    static let MAX_MARKS = 400
    static let LONGEST_POINT_S = 180.0
    static let PAST_END_ALLOWANCE_S = 1.0
    /// The start tap's backward lead, the same numbers as Playhead.swift's
    /// split lead: clamp(0.6 × rate, 0.6, 1.2). The END tap gets none.
    static let SPLIT_LEAD_S = 0.6
    static let LEAD_MIN_S = 0.6
    static let LEAD_MAX_S = 1.2
    /// A hole in the strip wide enough to offer a new point in.
    static let GAP_WORTH_MARKING_S = 4.0
    /// Tape left after the last point that still counts as marked to the end.
    static let TAIL_S = 45.0

    static func leadFor(_ rate: Double) -> Double {
        let r = rate.isFinite && rate > 0 ? rate : 1
        return min(LEAD_MAX_S, max(LEAD_MIN_S, SPLIT_LEAD_S * r))
    }

    /// JavaScript's `Math.round(n * 100) / 100`: halves round toward
    /// positive infinity, which `Foundation.round` does not do for
    /// negatives. Every stored time goes through this.
    static func round2(_ n: Double) -> Double {
        (n * 100 + 0.5).rounded(.down) / 100
    }

    /// Two lists of marks that mean the same thing: start and end to the
    /// centisecond, the answer and the skip, in start order. Ids, stars,
    /// taps and rates do not count. The database's `_marks_signature`
    /// (20260925133555), which decides when a prefilled draft stops being
    /// one; the phone asks the same question before its save lands.
    static func sameMarks(_ a: [HandCutMark], _ b: [HandCutMark]) -> Bool {
        struct Sig: Equatable {
            let t0: Double
            let t1: Double?
            let winner: Winner?
            let isLet: Bool
        }
        func cents(_ n: Double) -> Double { (n * 100).rounded() / 100 }
        func signature(_ marks: [HandCutMark]) -> [Sig] {
            marks.enumerated()
                .map { (ord: $0.offset, sig: Sig(
                    t0: cents($0.element.t0), t1: $0.element.t1.map(cents),
                    winner: $0.element.winner, isLet: $0.element.isLet)) }
                .sorted { $0.sig.t0 != $1.sig.t0 ? $0.sig.t0 < $1.sig.t0 : $0.ord < $1.ord }
                .map(\.sig)
        }
        return signature(a) == signature(b)
    }

    // MARK: - Readers

    /// The rally in progress, wherever it sits in the list.
    static func openMark(_ marks: [HandCutMark]) -> HandCutMark? {
        marks.first { $0.t1 == nil }
    }

    private static func openIndex(_ marks: [HandCutMark]) -> Int? {
        marks.firstIndex { $0.t1 == nil }
    }

    /// The index of the first closed mark at or after index `from`.
    private static func nextClosed(_ marks: [HandCutMark], _ from: Int) -> Int? {
        var i = max(0, from)
        while i < marks.count {
            if marks[i].t1 != nil { return i }
            i += 1
        }
        return nil
    }

    /// The index of the last closed mark before index `before`.
    private static func prevClosed(_ marks: [HandCutMark], _ before: Int) -> Int? {
        var i = min(before, marks.count) - 1
        while i >= 0 {
            if marks[i].t1 != nil { return i }
            i -= 1
        }
        return nil
    }

    /// The index of the closed mark `t` falls inside. The start is inside,
    /// the end is not, so a start exactly where a point ended sits beside it.
    private static func closedAt(_ marks: [HandCutMark], _ t: Double) -> Int? {
        marks.firstIndex { m in
            guard let t1 = m.t1 else { return false }
            return m.t0 <= t && t < t1
        }
    }

    /// Where a mark starting at `t0` goes: after every mark starting no later.
    private static func insertionIndex(_ marks: [HandCutMark], _ t0: Double) -> Int {
        var i = marks.count
        while i > 0 && marks[i - 1].t0 > t0 { i -= 1 }
        return i
    }

    /// JavaScript's `Array.prototype.sort((a, b) => a.t0 - b.t0)`, which is
    /// stable. Swift's `sort` is not documented as stable, so ties keep
    /// their order explicitly.
    private static func sortedByStart(_ marks: [HandCutMark]) -> [HandCutMark] {
        marks.enumerated()
            .sorted { a, b in
                a.element.t0 != b.element.t0 ? a.element.t0 < b.element.t0 : a.offset < b.offset
            }
            .map(\.element)
    }

    /// The first closed point still waiting for a winner, scanning after
    /// `afterId` when given. A let counts as answered.
    static func firstUnscored(_ marks: [HandCutMark], afterId: String? = nil) -> HandCutMark? {
        var past = afterId == nil
        for m in marks {
            if !past {
                if m.id == afterId { past = true }
                continue
            }
            if m.t1 != nil && !m.isLet && m.winner == nil { return m }
        }
        return nil
    }

    /// Every point closed and called. An empty list is unstarted, not done.
    static func allCalled(_ marks: [HandCutMark]) -> Bool {
        !marks.isEmpty && marks.allSatisfy { $0.t1 != nil && ($0.isLet || $0.winner != nil) }
    }

    static func lastClosedEnd(_ marks: [HandCutMark]) -> Double? {
        for m in marks.reversed() {
            if let t1 = m.t1 { return t1 }
        }
        return nil
    }

    /// Where a rally could be added on either side of the point stood on.
    /// Before the first point the window opens at zero; after the last it
    /// runs to the end of the video, and with no duration there is no
    /// offer. No gap runs across a rally still open.
    static func gapsAround(
        _ marks: [HandCutMark], id: String?, durationS: Double?
    ) -> (before: HandCutGap?, after: HandCutGap?) {
        guard let id, let i = marks.firstIndex(where: { $0.id == id }) else { return (nil, nil) }
        let m = marks[i]
        guard let mT1 = m.t1 else { return (nil, nil) }
        func wide(_ lo: Double, _ hi: Double) -> HandCutGap? {
            hi - lo >= GAP_WORTH_MARKING_S ? HandCutGap(lo: lo, hi: hi) : nil
        }
        let prev = i > 0 ? marks[i - 1] : nil
        let next = i + 1 < marks.count ? marks[i + 1] : nil
        let before: HandCutGap?
        if let prev {
            before = prev.t1.flatMap { wide($0, m.t0) }
        } else {
            before = wide(0, m.t0)
        }
        let nextStart: Double?
        if let next {
            nextStart = next.t0
        } else if let durationS, durationS > 0 {
            nextStart = durationS
        } else {
            nextStart = nil
        }
        return (before, nextStart.flatMap { wide(mT1, $0) })
    }

    /// Which pass a draft is. A draft saved before the choice was recorded
    /// is read from whether anything was ever called.
    static func draftMode(_ marks: [HandCutMark], recorded: HandCutMode?) -> HandCutMode {
        if let recorded { return recorded }
        return marks.contains { $0.isLet || $0.winner != nil } ? .score : .cut
    }

    /// Where the Score switch starts. Practice and drills cannot be scored,
    /// so theirs is always off. Otherwise the player's own choice on the
    /// match page wins; else a draft keeps the mode it recorded (or, one
    /// saved before that was recorded, what its marks show), and a fresh
    /// match starts with Score on.
    static func openingMode(
        _ marks: [HandCutMark], recorded: HandCutMode?, tracksServe: Bool,
        chosen: HandCutMode? = nil
    ) -> HandCutMode {
        guard tracksServe else { return .cut }
        if let chosen { return chosen }
        if marks.isEmpty { return recorded ?? .score }
        return draftMode(marks, recorded: recorded)
    }

    /// Which of the four a reopened draft is. Called is not finished: what
    /// separates them is how much tape is left after the last point.
    static func openAs(
        _ marks: [HandCutMark], durationS: Double?, mode: HandCutMode = .score
    ) -> HandCutOpenAs {
        if marks.isEmpty { return .fresh }
        // A cut-only pass has nothing to answer, so it is never a scoring
        // pass however few of its points carry a winner.
        if mode == .score && !allCalled(marks) { return .scoring }
        guard let durationS, durationS > 0 else { return .choice }
        let end = lastClosedEnd(marks) ?? 0
        return durationS - end <= TAIL_S ? .review : .choice
    }

    // MARK: - Taps

    /// Point starts. With one already open this is a forgotten end: the open
    /// point closes AT THE NEW MARK, unscored, and a new one opens there.
    /// With nothing open, a start is allowed anywhere not inside a closed
    /// point, including a gap between two, which is what lets Mark again
    /// work on any point.
    static func startMark(
        _ state: HandCutState, now: Double, rate: Double, id: String
    ) -> HandCutApplied {
        let t0 = round2(max(0, now - leadFor(rate)))
        let fresh = HandCutMark(
            id: id, t0: t0, t1: nil, winner: nil, isLet: false, starred: false,
            tap: round2(now), rate: rate
        )

        if let i = openIndex(state.marks) {
            let open = state.marks[i]
            if t0 - open.t0 < MIN_POINT_S { return HandCutApplied(state: state, refused: .short) }
            if let a = nextClosed(state.marks, i + 1), state.marks[a].t0 - t0 < MIN_POINT_S {
                return HandCutApplied(state: state, refused: .intoNext)
            }
            var marks = state.marks
            marks[i].t1 = t0
            marks.insert(fresh, at: i + 1)
            return HandCutApplied(state: HandCutState(
                marks: marks,
                undo: state.undo + [.startOver(id: id, prevId: open.id, prevT1: open.t1)],
                selectedId: nil,
                awaitingId: nil
            ))
        }

        if let hit = closedAt(state.marks, t0) {
            let last = prevClosed(state.marks, state.marks.count)
            return HandCutApplied(state: state, refused: hit == last ? .past : .insideAnother)
        }
        let at = insertionIndex(state.marks, t0)
        if let a = nextClosed(state.marks, at), state.marks[a].t0 - t0 < MIN_POINT_S {
            return HandCutApplied(state: state, refused: .intoNext)
        }
        var marks = state.marks
        marks.insert(fresh, at: at)
        return HandCutApplied(state: HandCutState(
            marks: marks,
            undo: state.undo + [.start(id: id)],
            selectedId: nil,
            awaitingId: nil
        ))
    }

    /// Reset: the Begin tap was too early. Throws the open rally away and
    /// hands back where the point before it ended, so the caller can rewind
    /// there and let the run-up play again.
    static func resetOpen(_ state: HandCutState) -> (state: HandCutState, backTo: Double) {
        guard let i = openIndex(state.marks) else {
            return (state, lastClosedEnd(state.marks) ?? 0)
        }
        let open = state.marks[i]
        let backTo = prevClosed(state.marks, i).flatMap { state.marks[$0].t1 } ?? 0
        var marks = state.marks
        marks.remove(at: i)
        // A "remove" entry: undo must put the open rally back as it was.
        return (
            HandCutState(
                marks: marks,
                undo: state.undo + [.remove(index: i, mark: open)],
                selectedId: state.selectedId == open.id ? nil : state.selectedId,
                awaitingId: state.awaitingId == open.id ? nil : state.awaitingId
            ),
            backTo
        )
    }

    /// End Point. Closes the rally and hands the pad to the answer row. A
    /// rally marked into a gap must end by the time the next point starts.
    static func endMark(_ state: HandCutState, now: Double) -> HandCutApplied {
        guard let i = openIndex(state.marks) else {
            return HandCutApplied(state: state, refused: .noneOpen)
        }
        let open = state.marks[i]
        let t1 = round2(now)
        if t1 - open.t0 < MIN_POINT_S { return HandCutApplied(state: state, refused: .short) }
        if let a = nextClosed(state.marks, i + 1), t1 > state.marks[a].t0 {
            return HandCutApplied(state: state, refused: .intoNext)
        }
        var marks = state.marks
        marks[i].t1 = t1
        return HandCutApplied(state: HandCutState(
            marks: marks,
            undo: state.undo + [.end(id: open.id, t1: open.t1, winner: open.winner, isLet: open.isLet)],
            selectedId: nil,
            awaitingId: open.id
        ))
    }

    /// Me / Them / Let. Answers the point just ended, or a selected chip;
    /// never a rally still in progress. The answer a point already carries
    /// clears it.
    static func setOutcome(_ state: HandCutState, _ outcome: HandCutOutcome) -> HandCutApplied {
        guard let id = state.awaitingId ?? state.selectedId,
              let i = state.marks.firstIndex(where: { $0.id == id })
        else { return HandCutApplied(state: state, refused: .noneEnded) }
        let m = state.marks[i]
        guard m.t1 != nil else { return HandCutApplied(state: state, refused: .noneEnded) }
        let wanted: Winner? = switch outcome {
        case .user: .user
        case .opponent: .opponent
        case .let: nil
        }
        let sameWinner = wanted != nil && m.winner == wanted && !m.isLet
        let sameLet = outcome == .let && m.isLet
        var marks = state.marks
        marks[i].winner = sameWinner ? nil : wanted
        marks[i].isLet = sameLet ? false : outcome == .let
        return HandCutApplied(state: HandCutState(
            marks: marks,
            undo: state.undo + [.outcome(id: m.id, winner: m.winner, isLet: m.isLet)],
            selectedId: state.selectedId,
            awaitingId: nil
        ))
    }

    static func toggleStar(_ state: HandCutState, id: String) -> HandCutApplied {
        guard let i = state.marks.firstIndex(where: { $0.id == id }) else {
            return HandCutApplied(state: state)
        }
        var marks = state.marks
        marks[i].starred.toggle()
        return HandCutApplied(state: HandCutState(
            marks: marks,
            undo: state.undo + [.star(id: id, starred: state.marks[i].starred)],
            selectedId: state.selectedId,
            awaitingId: state.awaitingId
        ))
    }

    /// Stop asking who won, without answering.
    static func clearAwaiting(_ state: HandCutState) -> HandCutState {
        guard state.awaitingId != nil else { return state }
        var next = state
        next.awaitingId = nil
        return next
    }

    /// Selecting the chip already selected deselects it; nil deselects.
    static func selectMark(_ state: HandCutState, id: String?) -> HandCutState {
        var next = state
        next.selectedId = state.selectedId == id ? nil : id
        return next
    }

    /// Would a closed mark starting at `t0` cross the mark before it? An
    /// open neighbour still needs room to be ended.
    private static func crossesPrev(_ prev: HandCutMark?, _ t0: Double) -> Bool {
        guard let prev else { return false }
        if let t1 = prev.t1 { return t0 < t1 }
        return t0 - prev.t0 < MIN_POINT_S
    }

    /// Nudge one edge of a closed mark. Refuses rather than clamping.
    static func moveEdge(
        _ state: HandCutState, id: String, edge: HandCutEdge, delta: Double
    ) -> HandCutApplied {
        guard let i = state.marks.firstIndex(where: { $0.id == id }) else {
            return HandCutApplied(state: state)
        }
        let m = state.marks[i]
        guard let mT1 = m.t1 else { return HandCutApplied(state: state) }
        let t0 = edge == .t0 ? round2(max(0, m.t0 + delta)) : m.t0
        let t1 = edge == .t1 ? round2(mT1 + delta) : mT1
        if t1 - t0 < MIN_POINT_S { return HandCutApplied(state: state, refused: .short) }
        let prev = i > 0 ? state.marks[i - 1] : nil
        let nextM = i + 1 < state.marks.count ? state.marks[i + 1] : nil
        if crossesPrev(prev, t0) { return HandCutApplied(state: state, refused: .inside) }
        if let nextM, t1 > nextM.t0 { return HandCutApplied(state: state, refused: .inside) }
        var marks = state.marks
        marks[i].t0 = t0
        marks[i].t1 = t1
        return HandCutApplied(state: HandCutState(
            marks: marks,
            undo: state.undo + [.move(id: id, t0: m.t0, t1: m.t1)],
            selectedId: state.selectedId,
            awaitingId: state.awaitingId
        ))
    }

    /// Both edges of a closed mark at once, from the Adjust bar. The same
    /// guards as `moveEdge`.
    static func setEdges(
        _ state: HandCutState, id: String, t0: Double, t1: Double
    ) -> HandCutApplied {
        guard let i = state.marks.firstIndex(where: { $0.id == id }) else {
            return HandCutApplied(state: state)
        }
        let m = state.marks[i]
        guard m.t1 != nil else { return HandCutApplied(state: state) }
        let a = round2(max(0, t0))
        let b = round2(t1)
        if b - a < MIN_POINT_S { return HandCutApplied(state: state, refused: .short) }
        let prev = i > 0 ? state.marks[i - 1] : nil
        let next = i + 1 < state.marks.count ? state.marks[i + 1] : nil
        if crossesPrev(prev, a) { return HandCutApplied(state: state, refused: .inside) }
        if let next, b > next.t0 { return HandCutApplied(state: state, refused: .inside) }
        var marks = state.marks
        marks[i].t0 = a
        marks[i].t1 = b
        return HandCutApplied(state: HandCutState(
            marks: marks,
            undo: state.undo + [.move(id: id, t0: m.t0, t1: m.t1)],
            selectedId: state.selectedId,
            awaitingId: state.awaitingId
        ))
    }

    static func removeMark(_ state: HandCutState, id: String) -> HandCutApplied {
        guard let i = state.marks.firstIndex(where: { $0.id == id }) else {
            return HandCutApplied(state: state)
        }
        var marks = state.marks
        let gone = marks.remove(at: i)
        return HandCutApplied(state: HandCutState(
            marks: marks,
            undo: state.undo + [.remove(index: i, mark: gone)],
            selectedId: state.selectedId == id ? nil : state.selectedId,
            awaitingId: state.awaitingId == id ? nil : state.awaitingId
        ))
    }

    /// A rally the first pass went past, put back in its place.
    static func insertMark(
        _ state: HandCutState, t0: Double, t1: Double, id: String
    ) -> HandCutApplied {
        if !(t1 - t0 >= MIN_POINT_S) { return HandCutApplied(state: state, refused: .short) }
        let clash = state.marks.contains { m in
            guard let mT1 = m.t1 else { return false }
            return t0 < mT1 && m.t0 < t1
        }
        if clash { return HandCutApplied(state: state, refused: .inside) }
        // The open rally owns everything from its start to the next closed
        // point, because nobody knows yet where it ends.
        if let o = openIndex(state.marks) {
            let owned = nextClosed(state.marks, o + 1).map { state.marks[$0].t0 } ?? .infinity
            if t1 > state.marks[o].t0 && t0 < owned {
                return HandCutApplied(state: state, refused: .inside)
            }
        }
        let mark = HandCutMark(
            id: id, t0: t0, t1: t1, winner: nil, isLet: false, starred: false,
            tap: t0, rate: 1
        )
        return HandCutApplied(state: HandCutState(
            marks: sortedByStart(state.marks + [mark]),
            undo: state.undo + [.start(id: id)],
            selectedId: id,
            awaitingId: nil
        ))
    }

    /// One step back, across every action type.
    static func undoLast(_ state: HandCutState) -> HandCutState {
        guard let entry = state.undo.last else { return state }
        var marks = state.marks
        func at(_ id: String) -> Int? { marks.firstIndex { $0.id == id } }

        switch entry {
        case .start(let id):
            if let i = at(id) { marks.remove(at: i) }
        case .startOver(let id, let prevId, let prevT1):
            if let i = at(id) { marks.remove(at: i) }
            if let p = at(prevId) { marks[p].t1 = prevT1 }
        case .end(let id, let t1, let winner, let isLet):
            if let i = at(id) {
                marks[i].t1 = t1
                marks[i].winner = winner
                marks[i].isLet = isLet
            }
        case .outcome(let id, let winner, let isLet):
            if let i = at(id) {
                marks[i].winner = winner
                marks[i].isLet = isLet
            }
        case .star(let id, let starred):
            if let i = at(id) { marks[i].starred = starred }
        case .move(let id, let t0, let t1):
            if let i = at(id) {
                marks[i].t0 = t0
                marks[i].t1 = t1
            }
        case .remove(let index, let mark):
            // splice past the end appends, as it does in JavaScript.
            marks.insert(mark, at: min(max(0, index), marks.count))
        }
        // A selection is always a closed point: one left on a point that is
        // gone or open again would aim the answers at nothing.
        let selectedId = state.selectedId.flatMap { sel in
            marks.contains { $0.id == sel && $0.t1 != nil } ? sel : nil
        }
        return HandCutState(
            marks: marks,
            undo: Array(state.undo.dropLast()),
            selectedId: selectedId,
            awaitingId: nil
        )
    }

    // MARK: - Summaries and submission

    static func summarize(_ marks: [HandCutMark]) -> HandCutSummary {
        var s = HandCutSummary()
        for m in marks {
            guard let t1 = m.t1 else { continue }
            s.total += 1
            if !m.isLet && m.winner == nil { s.unscored += 1 }
            if t1 - m.t0 > MAX_POINT_S { s.long += 1 }
            if m.starred { s.starred += 1 }
        }
        s.open = openMark(marks) != nil
        return s
    }

    /// What goes to `claim_hand_cut`: closed marks only, ordered, terse.
    static func submittable(_ marks: [HandCutMark]) -> [HandCutSubmission] {
        sortedByStart(marks.filter { $0.t1 != nil }).map { m in
            HandCutSubmission(
                t0: m.t0, t1: m.t1!, w: m.winner, isLet: m.isLet,
                star: m.starred, tap: m.tap, rate: m.rate
            )
        }
    }

    /// The same bounds `claim_hand_cut` applies, with the server's numbers.
    /// Nil means valid.
    static func validate(_ marks: [HandCutMark], durationS: Double?) -> HandCutInvalid? {
        let rows = submittable(marks)
        if rows.isEmpty { return .empty }
        if rows.count > MAX_MARKS { return .tooMany }
        var prev = -Double.infinity
        for r in rows {
            if !(r.t0 >= 0) || !(r.t1 > r.t0) { return .noLength }
            if r.t1 - r.t0 < MIN_POINT_S { return .short }
            if r.t1 - r.t0 > LONGEST_POINT_S { return .tooLong }
            if r.t0 < prev { return .overlap }
            if let durationS, r.t1 > durationS + PAST_END_ALLOWANCE_S { return .pastEnd }
            if r.w != nil && r.isLet { return .letAndWin }
            prev = r.t1
        }
        return nil
    }

    // MARK: - Stored drafts

    /// A stored draft, read back as marks.
    ///
    /// `hand_cut_drafts.marks` holds two shapes: full marks, saved while
    /// marking, and the short `submittable` form handed back after a failed
    /// cut (`{t0, t1, w, let, star, tap, rate}`, no id). Both are read. An
    /// entry that is not an object, or whose times are not numbers, is
    /// dropped; a winner other than user or opponent reads as uncalled.
    /// Marks come back ordered by start with at most one still open (the
    /// latest), which carries no answer. A missing or repeated id becomes
    /// `d1`, `d2` and so on in order.
    static func normalizeMarks(_ raw: HandCutJSON?) -> [HandCutMark] {
        guard case .array(let entries)? = raw else { return [] }
        var read: [(id: String?, mark: HandCutMark)] = []
        for entry in entries {
            if let m = readMark(entry) { read.append(m) }
        }
        read = read.enumerated()
            .sorted { a, b in
                a.element.mark.t0 != b.element.mark.t0
                    ? a.element.mark.t0 < b.element.mark.t0 : a.offset < b.offset
            }
            .map(\.element)

        var keepOpen = -1
        for i in stride(from: read.count - 1, through: 0, by: -1) where read[i].mark.t1 == nil {
            keepOpen = i
            break
        }
        let kept = read.enumerated()
            .filter { $0.element.mark.t1 != nil || $0.offset == keepOpen }
            .map(\.element)

        let given = Set(kept.compactMap(\.id))
        var used = Set<String>()
        var n = 0
        return kept.map { entry in
            var id = entry.id
            if id == nil || used.contains(id!) {
                repeat {
                    n += 1
                    id = "d\(n)"
                } while given.contains(id!) || used.contains(id!)
            }
            used.insert(id!)
            var mark = entry.mark
            mark.id = id!
            return mark
        }
    }

    private static func readMark(_ entry: HandCutJSON) -> (id: String?, mark: HandCutMark)? {
        guard case .object(let r) = entry else { return nil }
        func finite(_ v: HandCutJSON?) -> Double? {
            if case .number(let n)? = v, n.isFinite { return n }
            return nil
        }
        guard let t0 = finite(r["t0"]) else { return nil }
        let t1: Double?
        if case .null? = r["t1"] {
            t1 = nil
        } else if let v = finite(r["t1"]) {
            t1 = v
        } else {
            return nil
        }
        // `r.winner !== undefined ? r.winner : r.w`: a key present with
        // null does not fall through to the short form's key.
        let w = r["winner"] ?? r["w"]
        let isLet = r["isLet"] ?? r["let"]
        let starred = r["starred"] ?? r["star"]
        // A rally still open has not been answered, whatever the row says.
        let answered = t1 != nil
        var winner: Winner?
        if answered, case .string(let s)? = w, s == "user" || s == "opponent" {
            winner = Winner(rawValue: s)
        }
        var id: String?
        if case .string(let s)? = r["id"], !s.isEmpty { id = s }
        let rate = finite(r["rate"]).flatMap { $0 > 0 ? $0 : nil } ?? 1
        return (id, HandCutMark(
            id: id ?? "",
            t0: t0,
            t1: t1,
            winner: winner,
            isLet: answered && isLet == .bool(true),
            starred: starred == .bool(true),
            tap: finite(r["tap"]) ?? t0,
            rate: rate
        ))
    }

    // MARK: - Score, through the product's own rules

    /// Marks as the shape the game walk and the rotation read.
    static func asPoints(_ marks: [HandCutMark]) -> [HandCutPoint] {
        marks.filter { $0.t1 != nil }.map {
            HandCutPoint(id: $0.id, confirmedWinner: $0.winner, isLet: $0.isLet)
        }
    }
}

enum HandCutEdge: String {
    case t0, t1
}

/// The running score of a marking pass: `computeMatchScore` over
/// `asPoints`, never a walk of its own.
func handCutScore(_ marks: [HandCutMark]) -> MatchScore {
    let matchId = UUID(uuid: (0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))
    let rows = HandCut.asPoints(marks).enumerated().map { i, p in
        PointRow(
            id: UUID(), matchId: matchId, idx: i, t0: nil,
            confirmedWinner: p.confirmedWinner, isLet: p.isLet, deleted: false,
            gameEndOverride: p.gameEndOverride, gameWinnerOverride: p.gameWinnerOverride,
            serverOverride: p.serverOverride
        )
    }
    return computeMatchScore(rows)
}

/// Who serves the NEXT rally: the rotation asked about a stand-in point
/// appended after every closed mark, exactly as the web asks it
/// (`__next__`). The rule is never restated here.
func handCutNextServer(_ marks: [HandCutMark], firstServer: Winner?) -> Winner? {
    let points = HandCut.asPoints(marks)
    guard !points.isEmpty else { return firstServer }
    let ghost = UUID()
    var inputs = points.map {
        ServeInput(
            id: UUID(), serverOverride: $0.serverOverride, isLet: $0.isLet,
            confirmedWinner: $0.confirmedWinner, gameEndOverride: $0.gameEndOverride
        )
    }
    inputs.append(ServeInput(
        id: ghost, serverOverride: nil, isLet: false,
        confirmedWinner: nil, gameEndOverride: nil
    ))
    return computeServingInputs(inputs, firstServer: firstServer)[ghost]?.server
}
