#if DEBUG && targetEnvironment(simulator)
import SwiftUI
import Supabase

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
        case "healthy", "recovered": break
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
    @State private var app = ProcessingAvailabilityFixture.makeAppState()
    @State private var library = LibraryStore()
    @State private var router = Router()
    @State private var scores = ScoresStore()
    @State private var journal = JournalStore()
    @State private var notifications = NotificationsStore()
    @State private var coaching = CoachingStore()
    @State private var ready = false
    @State private var exportOpen = false
    private var context: AvailabilityContext { ProcessingAvailabilityFixture.context }
    private var lane: ProcessingServiceLane {
        switch context { case .hand: .hand; case .fast: ProcessingAvailabilityFixture.status.clipLane; default: .main }
    }
    var body: some View {
        Group {
            if let screen = ProcessingAvailabilityFixture.argument("--qa-availability-screen") {
                if ready {
                    Group {
                        switch screen {
                        case "home", "matches": MainTabView()
                        case "match": NavigationStack { MatchDetailScreen(match: AvailabilityQAData.match()) }
                        case "upload": UploadScreen()
                        case "export":
                            MainTabView()
                                .sheet(isPresented: $exportOpen) {
                                    ExportSheet(match: AvailabilityQAData.match(ready: true), starredCount: 3)
                                        .presentationDetents([.medium, .large])
                                        .presentationBackground(PL.surface)
                                        .presentationDragIndicator(.visible)
                                }
                        case "import-status":
                            ZStack {
                                ArenaBackground()
                                ImportedVideoStatusView(jobID: AvailabilityQAData.importID)
                                    .padding(20).plCard().padding(20)
                            }
                        default: componentPreview
                        }
                    }
                } else {
                    ZStack { ArenaBackground(); ProgressView() }
                }
            } else {
                componentPreview
            }
        }
        .environment(app).environment(library).environment(router)
        .environment(scores).environment(journal)
        .environment(notifications).environment(coaching)
        .task {
            // The SDK owns its normal session checks, seeded only in memory.
            precondition(supa.auth.currentUser?.id == AvailabilityQAData.ownerID)
            await ProcessingServiceStore.shared.refresh()
            await library.load()
            router.tab = ProcessingAvailabilityFixture.argument("--qa-availability-screen") == "home" ? .home : .matches
            journal.loaded = true
            ready = true
            exportOpen = ProcessingAvailabilityFixture.argument("--qa-availability-screen") == "export"
            ProcessingServiceStore.shared.start()
        }
        .onDisappear { ProcessingServiceStore.shared.stop() }
    }

    private var componentPreview: some View {
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
    }
}

extension ProcessingAvailabilityFixture {
    static func makeAppState() -> AppState {
        let app = AppState()
        app.phase = .signedIn(AvailabilityQAData.session)
        return app
    }
}
#endif
