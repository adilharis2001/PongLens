import Foundation

// The listening state machine, driven the way the microphone drives it:
// windows open, volatile text forms, windows settle. Every scenario here
// is a bug that reached a real phone, or the behaviour that fixes it —
// this layer had no tests, and it is where every field failure lived
// while the parser's 400-odd checks stayed green.

private func board(_ c: ScoreCapture) -> String {
    c.scores.map { row in
        guard let you = row.you, let them = row.them else { return "\(row.game):??" }
        return "\(row.game):\(you)-\(them)"
    }.joined(separator: " ")
}

func runScoreCaptureChecks() {
    print("\n— score capture —")

    // A phrase forms word by word, captures once, and the final settles
    // it without a second event.
    do {
        var c = ScoreCapture()
        c.beginSession()
        c.windowOpened()
        check(c.heard("game one") == nil, "half a trigger is no event")
        check(c.heard("game one score eleven") == nil, "one number is no event")
        check(c.heard("game one score eleven five") == .captured, "the full phrase captures")
        check(c.settled("game one score eleven five") == nil, "the final repeating it is silent")
        check(board(c) == "1:11-5", "board holds 11-5, got \(board(c))")
    }

    // The stale-board bug: a new session starts clean.
    do {
        var c = ScoreCapture()
        c.beginSession()
        c.windowOpened()
        _ = c.heard("game one score eleven five")
        _ = c.settled(nil)
        c.beginSession()
        check(c.scores.isEmpty, "a new session wipes the board")
        check(c.heardLog.isEmpty, "and the debug log")
    }

    // The 7-11 requirement: the phrase was heard, the numbers were not.
    // The window MUST leave a mark — a ?? row and a logged line — never
    // silence.
    do {
        var c = ScoreCapture()
        c.beginSession()
        c.windowOpened()
        check(c.heard("game four score seven together") == nil,
              "unreadable numbers never capture")
        check(c.settled("game four score seven together") == .missed,
              "settling files the miss")
        check(board(c) == "4:??", "the board shows ??, got \(board(c))")
        check(c.missedGame == 4, "the transient message names game 4")
        check(c.heardLog.count == 1, "the heard text is kept for debugging")
    }

    // The fallback settle: the recogniser never delivered a final, so the
    // window settles from its own volatiles. Same guarantee.
    do {
        var c = ScoreCapture()
        c.beginSession()
        c.windowOpened()
        _ = c.heard("game two score eleven mumble")
        check(c.settled(nil) == .missed, "settling on volatiles still verdicts")
        check(board(c) == "2:??", "?? row from the fallback, got \(board(c))")
    }

    // Correction across approaches: say it again, it replaces.
    do {
        var c = ScoreCapture()
        c.beginSession()
        c.windowOpened()
        _ = c.heard("game one score eleven five")
        _ = c.settled(nil)
        c.windowOpened()
        check(c.heard("game one score eleven three") == .captured,
              "a fresh window corrects the score")
        check(board(c) == "1:11-3", "board holds the correction, got \(board(c))")
    }

    // A capture replaces its own ?? row.
    do {
        var c = ScoreCapture()
        c.beginSession()
        c.windowOpened()
        _ = c.settled("game three score garbage here")
        check(board(c) == "3:??", "the miss is on the board")
        c.windowOpened()
        _ = c.heard("game three score eleven eight")
        check(board(c) == "3:11-8", "saying it again fills the ??, got \(board(c))")
        check(c.missedGame == nil, "the capture clears the message")
    }

    // A miss never downgrades a known score. The message shows; the
    // number survives.
    do {
        var c = ScoreCapture()
        c.beginSession()
        c.windowOpened()
        _ = c.heard("game one score eleven five")
        _ = c.settled(nil)
        c.windowOpened()
        _ = c.settled("game one score total mush")
        check(board(c) == "1:11-5", "11-5 survives a later miss, got \(board(c))")
        check(c.missedGame == 1, "but the message still asks again")
    }

    // The swap-revert bug: a manual tap outranks the stream. The same
    // window's stale text must not undo it; the next approach may.
    do {
        var c = ScoreCapture()
        c.beginSession()
        c.windowOpened()
        _ = c.heard("game one score eleven five")
        c.swap(game: 1)
        check(board(c) == "1:5-11", "the tap swaps, got \(board(c))")
        check(c.heard("game one score eleven five") == nil,
              "stale text cannot undo the tap")
        _ = c.settled("game one score eleven five")
        check(board(c) == "1:5-11", "settling stale text cannot either, got \(board(c))")
        c.windowOpened()
        check(c.heard("game one score eleven five") == .captured,
              "a fresh approach may restate it")
        check(board(c) == "1:11-5", "and it applies, got \(board(c))")
    }

    // A final that renders WORSE than its own volatiles cannot file a
    // miss for a game the same breath captured.
    do {
        var c = ScoreCapture()
        c.beginSession()
        c.windowOpened()
        _ = c.heard("game two score eleven seven")
        check(c.settled("game two score eleven several") == nil,
              "a worse final is ignored")
        check(board(c) == "2:11-7", "the capture stands, got \(board(c))")
    }

    // Room noise that opened the gate and parsed to nothing: no event,
    // no row, but a line in the log so a misheard trigger is findable.
    do {
        var c = ScoreCapture()
        c.beginSession()
        c.windowOpened()
        check(c.settled("nice rally, well played") == nil, "chat is no event")
        check(c.scores.isEmpty, "and writes nothing")
        check(c.heardLog.count == 1, "but is logged for debugging")
    }

    // Games arrive out of order. Two captured, three never heard, four
    // captured — and three said later must land and sort into place.
    // This is the exact sequence from the field report; the core always
    // handled it, and this pins that down so the next plumbing rewrite
    // cannot lose it.
    do {
        var c = ScoreCapture()
        c.beginSession()
        c.windowOpened()
        _ = c.heard("game two score eleven five")
        _ = c.settled(nil)
        c.windowOpened()
        _ = c.heard("game four score eleven seven")
        _ = c.settled(nil)
        c.windowOpened()
        check(c.heard("game three score eleven nine") == .captured,
              "a skipped game lands late")
        check(board(c) == "2:11-5 3:11-9 4:11-7",
              "and sorts into place, got \(board(c))")
    }

    // Same shape through the ?? path: three was heard but not scored,
    // four captured over the top of it, three typed... said again later.
    do {
        var c = ScoreCapture()
        c.beginSession()
        c.windowOpened()
        _ = c.settled("game three score mumble mumble")
        c.windowOpened()
        _ = c.heard("game four score eleven seven")
        _ = c.settled(nil)
        c.windowOpened()
        check(c.heard("game three score eleven nine") == .captured,
              "a ?? game fills in late")
        check(board(c) == "3:11-9 4:11-7",
              "and keeps its place, got \(board(c))")
    }

    // Haptic discipline: the same forming phrase is one event, not one
    // per word.
    do {
        var c = ScoreCapture()
        c.beginSession()
        c.windowOpened()
        var events = 0
        if c.heard("game one score eleven five") != nil { events += 1 }
        if c.heard("game one score eleven five") != nil { events += 1 }
        if c.heard("game one score eleven five okay") != nil { events += 1 }
        check(events == 1, "one capture event for one phrase, got \(events)")
    }
}
