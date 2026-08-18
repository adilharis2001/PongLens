import SwiftUI

@Observable
final class Router {
    var tab: MainTab = .home

    #if DEBUG
    /// Headless-verification hooks: open a match (and optionally the player)
    /// straight from launch arguments so simctl screenshots can reach deep
    /// screens without tap automation.
    var devOpenMatchId: UUID?
    var devOpenPlayer = false
    var devOpenPoint: Int?
    #endif

    init() {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "--dev-tab"), args.indices.contains(i + 1),
           let requested = MainTab(rawValue: args[i + 1].capitalized) {
            tab = requested
        }
        if let i = args.firstIndex(of: "--dev-open-match"), args.indices.contains(i + 1) {
            devOpenMatchId = UUID(uuidString: args[i + 1])
        }
        devOpenPlayer = args.contains("--dev-open-player")
        if let i = args.firstIndex(of: "--dev-open-point"), args.indices.contains(i + 1) {
            devOpenPoint = Int(args[i + 1])
        }
        #endif
    }
}
