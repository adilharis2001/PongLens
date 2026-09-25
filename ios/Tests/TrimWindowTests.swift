import Foundation

// Core/TrimWindow.swift: the trim with its preview, shared by the
// unprocessed page, More options and the upload sheet. Where a handle goes,
// what "Start here" and "End here" set, which moment the picture shows while
// a handle moves, the clock, and the seek discipline that keeps a drag from
// getting the app killed.

func runTrimWindowChecks() {
    print("\n— trim preview: handles, stamps, seeks, clock —")
    runTrimHandleChecks()
    runTrimStampChecks()
    runTrimSeekTargetChecks()
    runTrimSeekQueueChecks()
    runTrimClockChecks()
}

private func runTrimHandleChecks() {
    eq(TrimWindow.minWindow, 5, "the web's MIN_TRIM_S")
    eq(TrimWindow.grab(10, start: 0, end: 600), .start, "a touch near the start takes the start")
    eq(TrimWindow.grab(590, start: 0, end: 600), .end, "a touch near the end takes the end")
    eq(TrimWindow.grab(300, start: 0, end: 600), .start, "a tie goes to the start")
    eq(TrimWindow.seconds(x: 50, width: 200, duration: 600), 150, "a quarter of the track")
    eq(TrimWindow.seconds(x: -20, width: 200, duration: 600), 0, "off the left end reads 0")
    eq(TrimWindow.seconds(x: 260, width: 200, duration: 600), 600, "off the right end reads the length")
    eq(TrimWindow.seconds(x: 10, width: 0, duration: 600), 0, "no track, no time")

    let s = TrimWindow.move(.start, to: 42, start: 0, end: 600, duration: 600)
    eq(s.start, 42, "the start follows the finger")
    eq(s.end, 600, "and leaves the end alone")
    let pushed = TrimWindow.move(.start, to: 599, start: 0, end: 300, duration: 600)
    eq(pushed.start, 295, "the start stops five seconds short of the end")
    eq(pushed.end, 300, "it never pushes the end")
    eq(TrimWindow.move(.start, to: -3, start: 20, end: 300, duration: 600).start, 0,
       "never before the video")
    let e = TrimWindow.move(.end, to: 3, start: 100, end: 600, duration: 600)
    eq(e.end, 105, "the end stops five seconds after the start")
    eq(e.start, 100, "and never pushes the start")
    eq(TrimWindow.move(.end, to: 700, start: 0, end: 300, duration: 600).end, 600,
       "never past the video")
}

private func runTrimStampChecks() {
    eq(TrimWindow.stampStart(playhead: 83.4, start: 0, end: 600, duration: 600), 83.4,
       "Start here puts the start on the picture")
    eq(TrimWindow.stampEnd(playhead: 512, start: 83.4, end: 600, duration: 600), 512,
       "End here puts the end on the picture")
    eq(TrimWindow.stampStart(playhead: 598, start: 0, end: 600, duration: 600), 595,
       "Start here near the end keeps the five-second window")
    eq(TrimWindow.stampEnd(playhead: 10, start: 100, end: 600, duration: 600), 105,
       "End here before the start keeps the five-second window")
}

/// Dragging a handle shows that handle's own frame: the one processing
/// starts or ends on.
private func runTrimSeekTargetChecks() {
    let startDrag = TrimWindow.move(.start, to: 61.5, start: 0, end: 600, duration: 600)
    eq(TrimWindow.seekTarget(.start, start: startDrag.start, end: startDrag.end), 61.5,
       "dragging the start shows the start's frame")
    let endDrag = TrimWindow.move(.end, to: 480.25, start: 61.5, end: 600, duration: 600)
    eq(TrimWindow.seekTarget(.end, start: endDrag.start, end: endDrag.end), 480.25,
       "dragging the end shows the end's frame")
    let clamped = TrimWindow.move(.end, to: 20, start: 61.5, end: 600, duration: 600)
    eq(TrimWindow.seekTarget(.end, start: clamped.start, end: clamped.end), 66.5,
       "a handle held at its limit shows the limit, not the finger")
}

/// At most one seek in flight, the newest waiting request wins, loose while
/// the finger is down, exactly one exact seek when it lifts.
private func runTrimSeekQueueChecks() {
    var q = TrimSeekQueue()
    var issued: [TrimSeek] = []
    // A 30-tick drag while the first seek is still on its way.
    for tick in 0..<30 {
        if let s = q.request(Double(tick), dragging: true) { issued.append(s) }
    }
    eq(issued, [TrimSeek(seconds: 0, tolerance: 0.15)], "one loose seek, the rest wait")
    eq(q.pending, 29, "only the newest waits")
    // The finger lifts on the last position; then the first seek lands.
    if let s = q.request(29, dragging: false) { issued.append(s) }
    if let s = q.finished(dragging: false) { issued.append(s) }
    eq(issued.last, TrimSeek(seconds: 29, tolerance: 0), "the exact frame, once, after the lift")
    eq(issued.count, 2, "two seeks for a whole drag")
    eq(q.finished(dragging: false), nil, "nothing left waiting")
    eq(issued.filter { $0.tolerance == 0 }.count, 1, "exactly one exact seek")

    // A drag whose seeks keep up: each lands before the next tick.
    var fast = TrimSeekQueue()
    var loose = 0, exact = 0
    for tick in 0..<10 {
        if let s = fast.request(Double(tick), dragging: true) {
            s.tolerance == 0 ? (exact += 1) : (loose += 1)
        }
        _ = fast.finished(dragging: true)
    }
    if let s = fast.request(9, dragging: false) { s.tolerance == 0 ? (exact += 1) : (loose += 1) }
    eq(loose, 10, "every tick seeks loosely while the player keeps up")
    eq(exact, 1, "and the lift asks for the exact frame once")

    // A waiting request that is let go while the finger is still down
    // stays loose.
    var held = TrimSeekQueue()
    _ = held.request(1, dragging: true)
    _ = held.request(2, dragging: true)
    eq(held.finished(dragging: true), TrimSeek(seconds: 2, tolerance: 0.15),
       "the waiting seek stays loose while the finger is down")
    eq(held.request(.nan, dragging: false), nil, "a time that is not a number is never asked for")
    eq(held.request(-2, dragging: false), nil, "queued behind the running one")
    eq(held.finished(dragging: false), TrimSeek(seconds: 0, tolerance: 0), "and never before the video")
}

private func runTrimClockChecks() {
    eq(TrimWindow.clock(728.99), "12:08", "rounded down, as the player writes it")
    eq(TrimWindow.clock(59.9), "0:59", "never rounds up to the next second")
    eq(TrimWindow.clock(3725), "1:02:05", "hours when there are hours")
    eq(TrimWindow.clock(0), "0:00", "zero")
    eq(TrimWindow.clock(-4), "0:00", "never negative")
    eq(TrimWindow.clock(.nan), "0:00", "not a number reads zero")
}
