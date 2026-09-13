#if DEBUG && targetEnvironment(simulator)
import SwiftUI

/// A network-free harness for the actual processing card and inline notice.
/// Launch: --qa-processing-availability main-down --qa-availability-context saved_match
enum ProcessingAvailabilityFixture {
    static var isEnabled: Bool { ProcessInfo.processInfo.arguments.contains("--qa-processing-availability") }
    static func argument(_ name: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: name), args.indices.contains(i + 1) else { return nil }
        return args[i + 1]
    }
    static var status: ProcessingServiceStatus {
        var result = ProcessingServiceStatus()
        result.observedAt = Date()
        result.main = .available; result.fast = .available; result.hand = .available
        result.clipLane = argument("--qa-clip-lane") == "main" ? .main : .fast
        switch argument("--qa-processing-availability") {
        case "fast-down": result.fast = .unavailable
        case "both-down": result.main = .unavailable; result.fast = .unavailable
        case "hand-down": result.hand = .unavailable
        case "maintenance": result.main = .maintenance; result.fast = .maintenance; result.hand = .maintenance
        case "unknown", "failed-refresh": result = .unknown
        case "recovered": break
        default: result.main = .unavailable
        }
        return result
    }
    static var context: AvailabilityContext {
        switch argument("--qa-availability-context") {
        case "saved_video": .savedVideo
        case "saved_idle": .savedIdle
        case "hand": .hand
        case "queued_work": .queuedWork
        case "import": .importRequest
        case "uploading": .uploading
        case "before_upload": .beforeUpload
        case "before_import": .beforeImport
        case "fast": .fast
        case "export": .export
        default: .savedMatch
        }
    }
}

struct ProcessingAvailabilityFixtureView: View {
    private var context: AvailabilityContext { ProcessingAvailabilityFixture.context }
    private var lane: ProcessingServiceLane {
        switch context { case .hand: .hand; case .fast: ProcessingAvailabilityFixture.status.clipLane; default: .main }
    }
    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text(context == .export ? "Export" : context == .beforeUpload || context == .uploading ? "Upload" : "Match")
                        .font(.plPageTitle).foregroundStyle(PL.textBody)
                    let notice = ProcessingServiceStore.shared.notice(lane: lane, context: context)
                    if let work = ProcessingAvailabilityFixture.argument("--qa-home-work") {
                        let jobs = work == "orphan" ? [ProcessingWork(kind: "youtube_import", status: "queued", videoSaved: false)] : [
                            ProcessingWork(kind: "deadspace_cut", status: "queued", videoSaved: true),
                            ProcessingWork(kind: "hand_cut", status: "processing", videoSaved: true, stageLabel: "Preparing clips")
                        ]
                        HomeProcessingStatusView(summary: summarizeProcessingWork(ProcessingServiceStore.shared.status, work: jobs)).plCard()
                    } else if context == .savedMatch || context == .hand {
                        let warning = ProcessInfo.processInfo.arguments.contains("--qa-camera-warning") ? "The camera view changes during this recording. Try trimming to a section with a fixed view of the same table." : nil
                        MatchProcessingCard(notice: notice, stageLabel: "Finding the ball", warning: warning, progress: 38, sendsReadyEmail: context == .savedMatch)
                    } else if let notice {
                        ProcessingAvailabilityNoticeView(notice: notice).plCard()
                    }
                }
                .padding(20)
            }
        }
        .task { ProcessingServiceStore.shared.start() }
        .onDisappear { ProcessingServiceStore.shared.stop() }
    }
}
#endif
