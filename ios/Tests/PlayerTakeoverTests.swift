import Foundation

func runHighlightPlayerSourceChecks() {
    print("\n— continuous highlight player contract —")
    let path = "../PongLens/PongLens/Screens/PlayerTakeover.swift"
    guard let source = try? String(contentsOfFile: path, encoding: .utf8) else {
        check(false, "PlayerTakeover source is readable")
        return
    }
    check(source.contains("highlightManifest"), "highlight mode consumes the output manifest")
    check(source.contains("outputStart(for:"), "previous, next and replay use output time")
    check(!source.contains("addBoundaryTimeObserver"), "highlight playback installs no boundary seek observer")
    // The one boundary observer, a hand-cut match's tape, lives beside the
    // player and is gated on the cut, which the highlights tape is not.
    if let tape = try? String(contentsOfFile: "../PongLens/PongLens/Screens/PlayerTakeoverTape.swift", encoding: .utf8) {
        check(tape.contains("guard isCut, mode == .watch"), "the hand-cut tape exists only on the cut, in watch mode")
        check(tape.contains("guard tapeActive, detourId == nil"), "its boundary is installed only while the tape is active")
        check(source.contains("var isCut: Bool { source == .cut && !isHighlights }"), "the cut is never the highlights tape")
    } else {
        check(false, "PlayerTakeoverTape source is readable")
    }
    check(!source.contains("highlightSpans"), "highlight playback has no remote tape spans")
}
