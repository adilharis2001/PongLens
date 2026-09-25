import Foundation

// Core/UploadProcessingRequest.swift: Break it into points on the upload
// sheet, which replaced the "Process when the upload finishes" switch
// (owner-approved mockup, 2026-09-25). Later is always the default, each
// answer maps onto exactly what the switch used to send, and an explicit
// answer survives Type changes (upload-intent contract, 2026-09-13).

func runUploadCutChoiceChecks() {
    print("\n— upload sheet: Break it into points —")

    // Later by default, for every kind of upload, whatever came before.
    let fresh = UploadProcessingChoice(placement: true)
    eq(fresh.way, .later, "the sheet opens on Later")
    check(!fresh.process, "Later sends no processing request, like the switch off")
    for tracksServe in [true, false] {
        var typed = UploadProcessingChoice(placement: true)
        typed.selectType(tracksServe: tracksServe)
        eq(typed.way, .later, "Type never moves the default off Later (tracksServe \(tracksServe))")
    }

    // Each answer onto the old switch.
    check(!UploadCutWay.later.processes, "Later is the switch off")
    check(UploadCutWay.automatic.processes, "Automatically is the switch on")
    check(!UploadCutWay.byHand.processes, "Mark the points yourself processes nothing automatically")
    check(!UploadCutWay.later.opensMarker && !UploadCutWay.automatic.opensMarker,
          "only Mark the points yourself opens the marker")
    check(UploadCutWay.byHand.opensMarker, "Mark the points yourself opens the marker")
    var automatic = UploadProcessingChoice(placement: true)
    automatic.choose(.automatic)
    check(automatic.process && automatic.placement,
          "Automatically sends processing with the placement the switch sent")
    var byHand = UploadProcessingChoice(placement: true)
    byHand.choose(.byHand)
    check(!byHand.process, "Mark the points yourself sends no processing request")

    // An explicit answer survives Type, both ways, for all three.
    for way in UploadCutWay.allCases {
        var choice = UploadProcessingChoice(placement: false)
        choice.choose(way)
        choice.selectType(tracksServe: false)
        choice.selectType(tracksServe: true)
        choice.selectType(tracksServe: false)
        eq(choice.way, way, "\(way) survives Match to Practice and back")
    }
    // Placement still follows Type until it is chosen.
    var placement = UploadProcessingChoice(placement: true)
    placement.selectType(tracksServe: false)
    check(!placement.placement, "practice drops the placement default")
    placement.selectType(tracksServe: true)
    check(placement.placement, "match brings the placement default back")

    // A sheet reopened on a running upload shows what the session carries.
    eq(UploadProcessingChoice(way: .automatic, placement: true).way, .automatic,
       "a reopened sheet keeps Automatically")
    eq(UploadProcessingChoice(way: .byHand, placement: true).way, .byHand,
       "a reopened sheet keeps Mark the points yourself")

    // The rows offered, in order.
    eq(UploadCutWay.offered(marking: true), [.later, .automatic, .byHand],
       "hand-cut accounts see all three, Later first")
    eq(UploadCutWay.offered(marking: false), [.later, .automatic],
       "Mark the points yourself only for accounts that can mark by hand")
    var lost = UploadProcessingChoice(placement: true)
    lost.choose(.byHand)
    lost.markingUnavailable()
    eq(lost.way, .later, "a hidden Mark the points yourself falls back to Later")
    var kept = UploadProcessingChoice(placement: true)
    kept.choose(.automatic)
    kept.markingUnavailable()
    eq(kept.way, .automatic, "losing the marking row leaves Automatically alone")

    // "{N} min" is the sum the switch quoted: per file, trim included,
    // at least a minute each.
    eq(UploadCutWay.minutes([]), 0, "nothing queued yet quotes nothing")
    eq(UploadCutWay.minutes([(durationS: 30, trimStartS: nil, trimEndS: nil)]), 1,
       "a short file is still a minute")
    eq(UploadCutWay.minutes([(durationS: 2701, trimStartS: nil, trimEndS: nil)]), 46,
       "a whole file rounds up")
    eq(UploadCutWay.minutes([(durationS: 2700, trimStartS: 300, trimEndS: 2400)]), 35,
       "a trimmed file is charged its window")
    eq(UploadCutWay.minutes([
        (durationS: 2700, trimStartS: nil, trimEndS: nil),
        (durationS: 600, trimStartS: nil, trimEndS: nil),
    ]), 55, "a roll sums its files")

    // The marker opens the session's first match, once it exists.
    let first = UUID(), second = UUID()
    eq(UploadCutWay.markerMatch([]), nil, "no files, no match yet")
    eq(UploadCutWay.markerMatch([(capturedAtMs: 10, matchId: nil)]), nil,
       "waits while the file has not registered")
    eq(UploadCutWay.markerMatch([
        (capturedAtMs: 20, matchId: second),
        (capturedAtMs: 10, matchId: first),
    ]), first, "a roll opens its earliest file's match")
    eq(UploadCutWay.markerMatch([
        (capturedAtMs: 20, matchId: second),
        (capturedAtMs: 10, matchId: nil),
    ]), nil, "a later part landing first does not open in its place")
}
