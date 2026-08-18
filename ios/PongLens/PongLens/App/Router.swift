import SwiftUI

@Observable
final class Router {
    var tab: MainTab = .home

    init() {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "--dev-tab"), args.indices.contains(i + 1),
           let requested = MainTab(rawValue: args[i + 1].capitalized) {
            tab = requested
        }
        #endif
    }
}
