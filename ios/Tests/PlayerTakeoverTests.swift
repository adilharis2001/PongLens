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
    check(!source.contains("highlightSpans"), "highlight playback has no remote tape spans")
}
