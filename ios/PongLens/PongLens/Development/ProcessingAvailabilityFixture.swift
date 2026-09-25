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
    @State private var uploadDetailsOpen = false
    @State private var uploadDraft = RecordingMetadata(opponent: "Alex", venue: "QA Club")
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
                        case "upload-details":
                            UploadScreen().sheet(isPresented: $uploadDetailsOpen) {
                                MatchDetailsSheet(sessionId: AvailabilityUploadQA.sessionID,
                                    draft: $uploadDraft, recentOpponents: ["Alex"], recentVenues: ["QA Club"],
                                    processOn: false, placementOn: false)
                            }
                        case "export":
                            MainTabView()
                                .sheet(isPresented: $exportOpen) {
                                    ExportSheet(match: AvailabilityQAData.match(ready: true), starredCount: 3)
                                        .presentationDetents([.medium, .large])
                                        .presentationBackground(PL.surface)
                                        .presentationDragIndicator(.visible)
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
            if ProcessingAvailabilityFixture.argument("--qa-availability-screen") == "upload-details" {
                RecordingQueue.shared.items = [AvailabilityUploadQA.item(finishing: false)]
                uploadDetailsOpen = true
            }
            if let phase = ProcessingAvailabilityFixture.argument("--qa-upload-recovery") {
                if phase == "pending" || phase == "lookup-pending" || phase == "registration-missing" {
                    var item = AvailabilityUploadQA.item(finishing: true)
                    if phase == "registration-missing" { item.attempts = 7 }
                    RecordingQueue.shared.items = [item]
                    RecordingQueue.shared.releaseCompletion(sessionId: AvailabilityUploadQA.sessionID)
                } else {
                    let item = RecordingQueue.shared.items.first!
                    precondition(item.processingRequest?.isPending == true)
                    print("Upload intent QA restored \(item.processingRequest!.id)")
                    RecordingQueue.shared.resumeProcessingRequests()
                }
            }
            ready = true
            exportOpen = ProcessingAvailabilityFixture.argument("--qa-availability-screen") == "export"
            ProcessingServiceStore.shared.start()
        }
        .onDisappear { ProcessingServiceStore.shared.stop() }
        .onChange(of: RecordingQueue.shared.items) { _, items in
            guard let item = items.first else { return }
            print("Upload intent QA state=\(item.state) process=\(item.processOn) type=\(item.metadata.matchType ?? "unset") pending=\(item.processingRequest?.isPending == true) accepted=\(item.processingRequest?.jobID != nil)")
            if ProcessingAvailabilityFixture.argument("--qa-upload-recovery") == "lookup-pending", item.attempts > 0 {
                AvailabilityUploadConnection.shared.restore()
            }
        }
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
                        MatchProcessingCard(notice: notice, stageLabel: context == .hand ? "Cutting the video" : "Finding the ball", warning: warning, progress: 38, sendsReadyEmail: true)
                    } else if let notice {
                        ProcessingAvailabilityNoticeView(notice: notice).plCard()
                    }
                }
                .padding(20)
            }
        }
    }
}

enum AvailabilityUploadQA {
    static let sessionID = UUID(uuidString: "77777777-7777-4777-8777-777777777777")!
    static func item(finishing: Bool) -> QueuedRecording {
        var item = QueuedRecording(id: UUID(uuidString: "88888888-8888-4888-8888-888888888888")!,
            fileName: "no-real-media.mov", state: .uploading, durationS: 1065,
            capturedAtMs: 1_789_286_400_000, totalBytes: 100_000_000,
            uploadedBytes: finishing ? 100_000_000 : 37_000_000, sessionId: sessionID)
        item.metadata = RecordingMetadata(opponent: "Alex", venue: "QA Club")
        item.processOn = finishing
        if finishing {
            item.key = AvailabilityQAData.ownerID.uuidString.lowercased() + "/qa-upload-intent.mov"
            item.uploadId = "qa-no-real-upload"
            item.partCount = 1; item.etags = [1: "qa-etag"]
            item.trimStartS = 12; item.trimEndS = 100
        }
        return item
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
