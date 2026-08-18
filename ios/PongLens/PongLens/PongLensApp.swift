import SwiftUI
import UIKit

/// Catches the system's wake-up when background uploads finish while the
/// app is dead, and hands the completion to the queue.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        guard identifier == RecordingQueue.sessionIdentifier else {
            completionHandler()
            return
        }
        RecordingQueue.shared.handleBackgroundSessionEvents(completionHandler: completionHandler)
    }
}

@main
struct PongLensApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        // Wake the queue at launch: it reattaches to in-flight background
        // uploads and resumes anything the last run left unfinished.
        _ = RecordingQueue.shared
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
                .tint(PL.cyan)
        }
    }
}
