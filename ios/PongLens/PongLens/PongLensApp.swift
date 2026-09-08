import SwiftUI
import UIKit

/// Catches the system's wake-up when background uploads finish while the
/// app is dead, and hands the completion to the queue.
final class AppDelegate: NSObject, UIApplicationDelegate {
    /// The orientations the app will accept right now. The record screen
    /// narrows this to landscape while it is open and hands it back on
    /// the way out.
    ///
    /// Asking the scene to rotate is only a request: the system grants it
    /// and auto-rotation puts the interface straight back to match the
    /// phone. Answering here is what makes it stick — and it is the half
    /// that matters, because with rotation lock on there is no
    /// auto-rotation to reach the recorder's landscape in the first
    /// place, which left the record screen a dead end.
    nonisolated(unsafe) static var allowedOrientations: UIInterfaceOrientationMask = .all

    func application(
        _ application: UIApplication,
        supportedInterfaceOrientationsFor window: UIWindow?
    ) -> UIInterfaceOrientationMask {
        Self.allowedOrientations
    }

    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        if identifier == LessonVideoQueue.sessionIdentifier {
            LessonVideoQueue.shared.handleBackgroundSessionEvents(completionHandler: completionHandler)
            return
        }
        guard identifier == RecordingQueue.sessionIdentifier else {
            completionHandler()
            return
        }
        RecordingQueue.shared.handleBackgroundSessionEvents(completionHandler: completionHandler)
    }
}

@main
struct PongLensApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        // Wake the queue at launch: it reattaches to in-flight background
        // uploads and resumes anything the last run left unfinished.
        _ = RecordingQueue.shared
        _ = LessonVideoQueue.shared
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
                .tint(PL.cyan)
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await LessonVideoQueue.shared.resume() } }
                }
        }
    }
}
