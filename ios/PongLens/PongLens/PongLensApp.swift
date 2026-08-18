import SwiftUI

@main
struct PongLensApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
                .tint(PL.cyan)
        }
    }
}
