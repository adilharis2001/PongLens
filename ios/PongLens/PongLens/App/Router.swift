import SwiftUI

@Observable
final class Router {
    var tab: MainTab = .home
    var uploadOpen = false
    var recordOpen = false
    /// The chooser in front of both of those. Nothing opens the camera or
    /// the library directly any more except the chooser itself.
    var newMatchOpen = false

    #if DEBUG
    /// Headless-verification hooks: open a match (and optionally the player)
    /// straight from launch arguments so simctl screenshots can reach deep
    /// screens without tap automation.
    var devOpenMatchId: UUID?
    var devOpenPlayer = false
    var devOpenPoint: Int?
    var devOpenAccount = false
    var devOpenStarred = false
    var devOpenScore = false
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
        devOpenAccount = args.contains("--dev-open-account")
        devOpenStarred = args.contains("--dev-open-starred")
        if args.contains("--dev-open-upload") { uploadOpen = true }
        // Straight into the recorder. The landing video needs a shot of
        // it, and the route there is two taps through a sheet — which a
        // capture script cannot rely on, because the app restores
        // whatever screen it was last on and the taps land elsewhere.
        if args.contains("--dev-open-record") { recordOpen = true }
        devOpenScore = args.contains("--dev-open-score")
        #endif
    }
}
