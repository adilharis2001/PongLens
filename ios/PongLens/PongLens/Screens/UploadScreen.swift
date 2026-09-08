import AVFoundation
import PhotosUI
import Supabase
import SwiftUI
import UniformTypeIdentifiers

/// Upload rides the same pipeline as recording: pick a video, watch it
/// copy out of the photo library with a real percentage, and the moment
/// the copy lands the background queue owns the upload. The shared match
/// details sheet opens on top with the processing decision inside it.
struct UploadScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(LibraryStore.self) private var library
    @Environment(Router.self) private var router
    @State private var pickerOpen = false
    @State private var importing: ImportStage = .idle
    @State private var exportProgress: Progress?
    @State private var exportFraction: Double = 0
    @State private var loadError: String?
    @State private var sessionId = UUID()
    @State private var draft = RecordingMetadata()
    @State private var detailsOpen = false
    @State private var minutesBalance: Int?
    @State private var storageUsed: Int64?
    @State private var storageLimit: Int64?
    @State private var cameraSheetOpen = false
    @State private var feedbackOpen = false
    /// What "Placement maps" in Record settings said at the moment this
    /// upload started. Read once, then handed to BOTH the queue and the
    /// details sheet, so the toggle the owner sees is the value that will
    /// actually be sent. This screen used to pass a literal false to each
    /// of them, which quietly overrode the setting for every library
    /// upload while the Record tab honoured it — so turning placement on
    /// did nothing here and nobody could see why.
    @State private var placementOn = false
    @State private var youtubeURL = ""
    @State private var youtubeState: YouTubeState = .idle
    @State private var youtubeJobID: UUID?
    private var youtubeStorageBlocked: Bool {
        if case .failed(let message) = youtubeState { return AllowanceLimit.isStorage(message) }
        return false
    }

    enum ImportStage: Equatable {
        case idle
        case exporting // Photos is handing the file over
        case probing // reading duration, checking the caps
    }

    enum YouTubeState: Equatable {
        case idle, sending, queued
        case failed(String)
    }

    private var queue: RecordingQueue { RecordingQueue.shared }

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack {
                        Text("Upload")
                            .font(.plPageTitle)
                            .tracking(-0.6)
                            .foregroundStyle(PL.textBody)
                        Spacer()
                        Button {
                            cameraSheetOpen = true
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "video")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(PL.cyan)
                                Text("How to record")
                                    .font(.plCaption)
                                    .underline()
                                    .foregroundStyle(PL.text400)
                            }
                        }
                        .buttonStyle(.plain)
                        Button {
                            dismiss()
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(PL.text300)
                                .frame(width: 34, height: 34)
                                .background(PL.surface2, in: Circle())
                                .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }

                    if !queue.active.isEmpty {
                        uploadsShelf
                    }

                    pickCard
                    // YouTube import stays web-only. Apps that pull video
                    // off YouTube run against YouTube's terms whoever owns
                    // the footage, and App Review has a long history of
                    // rejecting for it (5.2.3) — not an argument to invite
                    // on a first submission. The card and its plumbing are
                    // kept below, unrendered, for if that call changes.
                    balanceCard
                    reportRow
                }
                .padding(20)
                .padding(.bottom, 60)
            }
        }
        .plKeyboardDismiss()
        .task { await loadBalances() }
        .onDisappear {
            // The screen going away must never leave a completion hold
            // behind; releasing twice is harmless, leaking once is not.
            queue.releaseCompletion(sessionId: sessionId)
        }
        .sheet(isPresented: $pickerOpen) {
            VideoPicker { provider in
                pickerOpen = false
                if let provider {
                    beginImport(provider)
                }
            }
            .ignoresSafeArea()
        }
        .sheet(isPresented: $detailsOpen) {
            MatchDetailsSheet(
                sessionId: sessionId,
                draft: $draft,
                recentOpponents: library.recentValues(\.opponentName),
                recentVenues: library.recentValues(\.venue),
                processOn: true,
                placementOn: placementOn
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .onAppear { queue.holdCompletion(sessionId: sessionId) }
            .onDisappear {
                queue.releaseCompletion(sessionId: sessionId)
                // The details sheet closing on a live upload is the end of
                // this errand: land in the library, where the upload row
                // and then the new match card carry the story. A discarded
                // session has no rows and stays here.
                if queue.items.contains(where: { $0.sessionId == sessionId }) {
                    router.tab = .matches
                    router.uploadOpen = false
                }
            }
        }
        .sheet(isPresented: $cameraSheetOpen) {
            CameraPlacementSheet()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $feedbackOpen) {
            NavigationStack {
                ZStack {
                    ArenaBackground()
                    FeedbackScreen()
                }
            }
        }
    }

    // MARK: - Uploads in flight (same rows as Matches and Record)

    private var uploadsShelf: some View {
        VStack(spacing: 8) {
            ForEach(queue.active) { item in
                if item.state == .failed && AllowanceLimit.isStorage(item.errorMessage) {
                    RecordingUploadRow(item: item)
                } else {
                Button {
                    if item.sessionId == sessionId || openableSession(item.sessionId) {
                        sessionId = item.sessionId
                        draft = item.metadata
                        detailsOpen = true
                    }
                } label: {
                    RecordingUploadRow(item: item)
                }
                .buttonStyle(.plain)
                }
            }
        }
    }

    /// Any active session can reopen its details sheet from the shelf.
    private func openableSession(_ id: UUID) -> Bool {
        queue.items.contains { $0.sessionId == id && $0.state != .done }
    }

    // MARK: - Pick

    private var pickCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Upload a match")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Text("MP4 or MOV, up to 45 minutes.")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
            }

            VStack(spacing: 14) {
                if let loadError {
                    Text(loadError)
                        .font(.plCaption)
                        .foregroundStyle(PL.warningText)
                        .multilineTextAlignment(.center)
                }
                switch importing {
                case .idle:
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 26, weight: .medium))
                        .foregroundStyle(PL.text500)
                    Button {
                        loadError = nil
                        pickerOpen = true
                    } label: {
                        Text("Choose a video")
                            .font(.plButton)
                            .foregroundStyle(PL.ink)
                            .padding(.horizontal, 22)
                            .padding(.vertical, 12)
                            .background(PL.cyan, in: Capsule())
                            .shadow(color: PL.cyan.opacity(0.5), radius: 14)
                    }
                    .buttonStyle(.plain)
                case .exporting:
                    VStack(spacing: 10) {
                        HStack(spacing: 10) {
                            Text("\(Int(exportFraction * 100))%")
                                .font(.system(size: 24, weight: .bold))
                                .monospacedDigit()
                                .foregroundStyle(PL.text100)
                            Text("Getting the video from Photos")
                                .font(.plBody)
                                .foregroundStyle(PL.text400)
                        }
                        ProgressView(value: exportFraction)
                            .tint(PL.cyan)
                        Button("Cancel") { cancelImport() }
                            .buttonStyle(PLSecondaryButtonStyle())
                    }
                    .padding(.horizontal, 8)
                case .probing:
                    HStack(spacing: 10) {
                        ProgressView().tint(PL.cyan)
                        Text("Reading the video")
                            .font(.plBody)
                            .foregroundStyle(PL.text400)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 26)
            .padding(.horizontal, 14)
            .overlay(
                RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                    .strokeBorder(PL.edge, style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 18)
    }

    // MARK: - Import from Photos

    private func beginImport(_ provider: NSItemProvider) {
        importing = .exporting
        exportFraction = 0
        loadError = nil
        let suggested = provider.suggestedName
        let progress = provider.loadFileRepresentation(
            forTypeIdentifier: UTType.movie.identifier
        ) { url, _ in
            // The system deletes its URL when this closure returns, so the
            // copy happens right here, on its background queue.
            var copied: URL?
            if let url {
                let ext = url.pathExtension.isEmpty ? "mov" : url.pathExtension
                let destination = FileManager.default.temporaryDirectory
                    .appendingPathComponent("upload-\(UUID().uuidString).\(ext)")
                if (try? FileManager.default.copyItem(at: url, to: destination)) != nil {
                    copied = destination
                }
            }
            let picked = copied
            Task { @MainActor in
                await finishImport(url: picked, suggestedName: suggested)
            }
        }
        exportProgress = progress
        Task { @MainActor in
            while importing == .exporting {
                exportFraction = progress.fractionCompleted
                try? await Task.sleep(for: .milliseconds(200))
            }
        }
    }

    private func cancelImport() {
        exportProgress?.cancel()
        exportProgress = nil
        importing = .idle
    }

    @MainActor
    private func finishImport(url: URL?, suggestedName: String?) async {
        guard importing == .exporting else {
            // Canceled while Photos was still copying; drop the file.
            if let url { try? FileManager.default.removeItem(at: url) }
            return
        }
        guard let url else {
            importing = .idle
            loadError = "Couldn't read that video from your library."
            return
        }
        importing = .probing
        defer { importing = .idle }

        let bytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64)
            .flatMap { $0 } ?? 0
        if bytes > 6 * 1024 * 1024 * 1024 {
            try? FileManager.default.removeItem(at: url)
            loadError = "That file is over 6 GB. Trim it on your phone first, or upload it in two halves."
            return
        }
        let asset = AVURLAsset(url: url)
        guard let duration = try? await asset.load(.duration).seconds,
              duration.isFinite, duration > 0 else {
            try? FileManager.default.removeItem(at: url)
            loadError = "That's not a video PongLens can read. MP4 and MOV work."
            return
        }
        if duration > 45 * 60 {
            try? FileManager.default.removeItem(at: url)
            let mins = Int(duration / 60)
            loadError = "That video is \(mins) minutes. The limit is 45 minutes, so trim it first or upload it in two halves."
            return
        }

        // From here the background queue owns it: the upload starts now
        // and survives the app closing. The sheet rides on top. Completion
        // holds BEFORE the first byte moves — a small file can finish
        // uploading faster than a sheet can appear, and registering with
        // untouched defaults is exactly the bug that ordering caused.
        sessionId = UUID()
        draft = RecordingMetadata()
        queue.holdCompletion(sessionId: sessionId)
        let ext = url.pathExtension.lowercased()
        // Read at the moment of upload rather than held in state: the
        // owner may have changed it in Record settings since this screen
        // appeared, and load() reads UserDefaults fresh every call.
        placementOn = RecordSettings.load().placementMaps
        queue.enqueue(
            fileURL: url, durationS: duration, sessionId: sessionId,
            metadata: draft, processOn: true, placementOn: placementOn,
            originalName: suggestedName.map { "\($0).\(ext)" } ?? url.lastPathComponent
        )
        // Presenting a sheet while the picker's dismissal is still
        // animating gets the new sheet torn down by the old transaction.
        // Give the transition a beat to finish before the details ride up.
        try? await Task.sleep(for: .milliseconds(700))
        detailsOpen = true
    }

    // MARK: - YouTube import

    private var youtubeCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Import from YouTube")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
            Text("Public or unlisted videos, up to 45 minutes. It must be your footage or footage you have the rights to.")
                .font(.plBody)
                .foregroundStyle(PL.text400)

            switch youtubeState {
            case .queued:
                if let youtubeJobID {
                    ImportedVideoStatusView(jobID: youtubeJobID)
                } else {
                Text("Queued. It shows up in your library once the download finishes.")
                    .font(.plBody)
                    .foregroundStyle(PL.successText)
                }
                Button("Import another") {
                    youtubeURL = ""
                    youtubeJobID = nil
                    youtubeState = .idle
                }
                .buttonStyle(PLSecondaryButtonStyle())
            default:
                HStack(spacing: 8) {
                    TextField("Paste a YouTube link", text: $youtubeURL)
                        .plField()
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    Button("Paste") {
                        if let s = UIPasteboard.general.string {
                            youtubeURL = s.trimmingCharacters(in: .whitespacesAndNewlines)
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                }
                if case .failed(let message) = youtubeState {
                    Text(AllowanceLimit.isStorage(message) ? "There isn't enough storage to import this video. Your link is still here." : message)
                        .font(.plCaption)
                        .foregroundStyle(PL.dangerText)
                    if AllowanceLimit.isStorage(message) {
                        AllowanceRecoveryView(resource: "storage", retryLabel: "Try import again") {
                            await importFromYouTube()
                        }
                    }
                }
                if !youtubeStorageBlocked {
                Button(youtubeState == .sending ? "Importing…" : "Import") {
                    Task { await importFromYouTube() }
                }
                .buttonStyle(PLCyanGhostButtonStyle())
                .frame(maxWidth: .infinity)
                .disabled(
                    youtubeState == .sending
                        || youtubeURL.trimmingCharacters(in: .whitespaces).isEmpty
                )
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 18)
    }

    private func importFromYouTube() async {
        youtubeState = .sending
        struct Req: Encodable {
            let url: String
            let points: Bool
            let placement: Bool
        }
        struct Res: Decodable { let ok: Bool?; let jobId: UUID? }
        do {
            let result: Res = try await API.post("api/import-url", Req(
                url: youtubeURL.trimmingCharacters(in: .whitespacesAndNewlines),
                points: true,
                placement: false
            ))
            youtubeJobID = result.jobId
            youtubeState = .queued
        } catch {
            youtubeState = .failed(
                (error as? APIError).map { $0.errorDescription ?? "" }
                    .flatMap { $0.isEmpty ? nil : $0 }
                    ?? "Couldn't queue that link. Check it and try again."
            )
        }
    }

    // MARK: - Balance / report

    private var balanceCard: some View {
        HStack(alignment: .top, spacing: 24) {
            VStack(alignment: .leading, spacing: 2) {
                Text(minutesBalance.map(String.init) ?? "—")
                    .font(.system(size: 22, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(PL.text100)
                Text("processing minutes")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            VStack(alignment: .leading, spacing: 2) {
                (Text(storageUsed.map { gbString($0) } ?? "—")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(PL.text100)
                    + Text(storageLimit.map { "  of \(gbString($0))" } ?? "")
                    .font(.system(size: 13))
                    .foregroundColor(PL.text500))
                    .monospacedDigit()
                Text("storage used")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 18)
    }

    private var reportRow: some View {
        Button {
            feedbackOpen = true
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "flag")
                    .font(.system(size: 11))
                Text("Something not looking right? Report an issue")
                    .underline()
            }
            .font(.plCaption)
            .foregroundStyle(PL.text500)
        }
        .buttonStyle(.plain)
    }

    private func loadBalances() async {
        struct ProcessingRow: Decodable {
            let minutesBalance: Double?
            enum CodingKeys: String, CodingKey { case minutesBalance = "minutes_balance" }
        }
        struct StorageRow: Decodable {
            let storageLimitBytes: Int64?
            let usedBytes: Int64?
            enum CodingKeys: String, CodingKey {
                case storageLimitBytes = "storage_limit_bytes"
                case usedBytes = "used_bytes"
            }
        }
        async let processingQ: [ProcessingRow]? = try? supa
            .rpc("my_processing_state").execute().value
        async let storageQ: [StorageRow]? = try? supa
            .rpc("my_storage_state").execute().value
        let (processing, storage) = await (processingQ, storageQ)
        minutesBalance = processing?.first?.minutesBalance.map(Int.init)
        storageUsed = storage?.first?.usedBytes
        storageLimit = storage?.first?.storageLimitBytes
    }

    private func gbString(_ bytes: Int64) -> String {
        let gb = Double(bytes) / 1_073_741_824
        return gb >= 10 ? String(format: "%.0f GB", gb) : String(format: "%.1f GB", gb)
    }
}

// MARK: - The system video picker, with the export progress it reports

/// PHPicker hands the video over with a Progress object, which is the
/// whole reason it replaced the SwiftUI picker: a multi-gigabyte export
/// out of the photo library gets a percentage instead of dead air.
private struct VideoPicker: UIViewControllerRepresentable {
    /// Called once with the picked item, or nil when the user cancels.
    let onFinish: (NSItemProvider?) -> Void

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration()
        config.filter = .videos
        config.selectionLimit = 1
        // Hand over the original file; the default can re-encode HEVC and
        // double the wait.
        config.preferredAssetRepresentationMode = .current
        let controller = PHPickerViewController(configuration: config)
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        private let parent: VideoPicker
        init(_ parent: VideoPicker) { self.parent = parent }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            parent.onFinish(results.first?.itemProvider)
        }
    }
}

// MARK: - Camera placement guidance

/// "Where to place the camera" — the web's sheet: the top-down diagram,
/// the checks that make footage processable, and the landscape note.
/// Dressed on the shared sheet scaffold, the same chrome as match details.
///
/// This is the manual sheet, behind "How to record" on Home and Upload. It
/// used to open on its own for a new account; the recording brief
/// (RecordingBriefSheet) does that job now, and the two say the same
/// things — a rule added here is added there, and to the Learn guide, on
/// both platforms.
struct CameraPlacementSheet: View {
    /// Which door raised it. Only the closing note changes: "Record a
    /// match and the camera screen draws the table" is nonsense read one
    /// tap away from that camera screen, and pointing at the recorder is
    /// no use to somebody whose footage was filmed yesterday.
    enum Context {
        case general
        /// About to hand over to the recorder.
        case recording
        /// About to hand over to the library picker.
        case upload
    }

    var context: Context = .general

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        PLSheetScaffold(title: "Where to place the camera", showDone: false) {
            Form {
                Section {
                    CameraDiagram()
                        .aspectRatio(340.0 / 300.0, contentMode: .fit)
                        .frame(maxWidth: .infinity)
                        .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
                }

                Section {
                    checkRow("To the side of your half or diagonally behind your corner, raised to about head height.")
                    checkRow("On the side you do not serve from. A right-hander serving pendulum stands near their backhand corner, so the camera goes on the forehand side.")
                    checkRow("The whole table in frame, with the ball clearly visible where it lands on both halves.")
                    checkRow("Neither player standing between the camera and the table, on either half.")
                    checkRow("On a tripod or something that does not move, for the whole match.")
                    checkRow("Other tables out of the frame where you can.")
                }

                Section {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "iphone.landscape")
                            .font(.system(size: 15))
                            .foregroundStyle(PL.cyan)
                            .padding(.top, 2)
                        (Text("Hold your phone ")
                            + Text("landscape").fontWeight(.bold)
                            + Text(" (sideways). Vertical video still works, but accuracy drops."))
                            .font(.plBody)
                            .foregroundStyle(PL.text300)
                    }
                    .padding(.vertical, 2)
                }

                Section {
                    CameraRealSetups()
                        .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12))
                }

                if let note = viewfinderNote {
                    Section {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: "viewfinder")
                                .font(.system(size: 15))
                                .foregroundStyle(PL.cyan)
                                .padding(.top, 2)
                            Text(note)
                                .font(.plBody)
                                .foregroundStyle(PL.text300)
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
            // The bar covers the last inch of the form, and a Form inside
            // a sheet does not extend its own scroll for a safeAreaInset
            // — so the closing note sat permanently behind the button,
            // unreachable at any scroll position. Reserved explicitly.
            .contentMargins(.bottom, 76, for: .scrollContent)
            // Pinned, not the last row of the form. A way out that has to
            // be scrolled down to — past the diagram, six rules, a
            // landscape note and three photographs — reads as a trap
            // rather than an exit.
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 0) {
                    Divider().overlay(PL.edge)
                    Button("Got it") { dismiss() }
                        .buttonStyle(PLPrimaryButtonStyle())
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 20)
                        .padding(.top, 12)
                        .padding(.bottom, 6)
                }
                .background(PL.surface)
            }
        }
    }

    private var viewfinderNote: String? {
        switch context {
        case .general:
            "Filming on this phone? Record a match and the camera screen draws the table where it should sit, so you can line the real one up with it before you start."
        case .recording:
            "The next screen draws this table over the camera. Line the real one up with it before you start."
        case .upload:
            // Pointing at the recorder here is no help: the footage this
            // person is about to pick already exists.
            nil
        }
    }

    private func checkRow(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "checkmark")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(PL.cyan)
                .padding(.top, 3)
            Text(text)
                .font(.plBody)
                .foregroundStyle(PL.text200)
        }
    }
}

/// The top-down placement diagram: the table seen from above, both
/// players, and the camera off to one side level with the near half, its
/// sight lines sweeping the whole table. Shared with the "Upload a video"
/// guide in Learn.
///
/// Drawn side-on, not from behind a corner. Behind the player is the
/// position that breaks the pipeline: the near player stands between the
/// lens and their own half, so the bounces that decide a point are hidden
/// exactly when they matter. The near player is drawn at the backhand
/// corner, where a right-hander serving pendulum stands, and the camera on
/// the opposite side, so the picture says the same thing the words do.
struct CameraDiagram: View {
    var body: some View {
        Canvas { context, size in
            // One geometry shared with the web sheet's TableDiagram and the
            // brief's p1.svg, in a 320×300 design space: the table on the
            // left, the BAND of allowed camera positions on the right (side
            // of your half round to diagonally behind your corner), one
            // example camera in it, and its view cone taking in the whole
            // table. The band's outer edge fades open on purpose — further
            // back is fine, and the photos below prove it.
            let s = min(size.width / 320, size.height / 300)
            let ox = (size.width - 320 * s) / 2
            let oy = (size.height - 300 * s) / 2
            func P(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: ox + x * s, y: oy + y * s)
            }
            let cyan = Color(hex: 0x22D3EE)
            let cam = P(238, 199)

            // View cone: apex at the lens, padded past the table's angular
            // extremes (near-right and far-left reaches), so the whole
            // table sits inside with margin.
            var cone = Path()
            cone.move(to: cam)
            cone.addLine(to: P(69, -199))
            cone.addLine(to: P(-183, 225))
            cone.closeSubpath()
            context.fill(cone, with: .linearGradient(
                Gradient(stops: [
                    .init(color: cyan.opacity(0.30), location: 0),
                    .init(color: cyan.opacity(0.02), location: 1),
                ]),
                startPoint: cam, endPoint: P(110, 115)
            ))
            for end in [P(165.2, 27.6), P(51.7, 210.5)] {
                var sight = Path()
                sight.move(to: cam)
                sight.addLine(to: end)
                context.stroke(
                    sight, with: .color(cyan.opacity(0.5)),
                    style: StrokeStyle(lineWidth: 1, dash: [3, 4])
                )
            }

            // The band: an annular sector around your near corner, from
            // side (level with your half) round to diagonal.
            let pivot = P(168, 204)
            let a0 = Angle.degrees(-58), a1 = Angle.degrees(44)
            var band = Path()
            band.move(to: P(192.4, 165.0))
            band.addLine(to: P(217.8, 124.3))
            band.addArc(center: pivot, radius: 94 * s, startAngle: a0, endAngle: a1, clockwise: false)
            band.addLine(to: P(201.1, 236.0))
            band.addArc(center: pivot, radius: 46 * s, startAngle: a1, endAngle: a0, clockwise: true)
            band.closeSubpath()
            context.fill(band, with: .radialGradient(
                Gradient(stops: [
                    .init(color: cyan.opacity(0.15), location: 0.42),
                    .init(color: cyan.opacity(0.12), location: 0.72),
                    .init(color: cyan.opacity(0.03), location: 1),
                ]),
                center: pivot, startRadius: 0, endRadius: 94 * s
            ))
            var bandEdge = Path()
            bandEdge.addArc(center: pivot, radius: 46 * s, startAngle: a0, endAngle: a1, clockwise: false)
            bandEdge.move(to: P(192.4, 165.0))
            bandEdge.addLine(to: P(210.4, 136.2))
            bandEdge.move(to: P(201.1, 236.0))
            bandEdge.addLine(to: P(225.5, 259.6))
            context.stroke(
                bandEdge, with: .color(cyan.opacity(0.5)),
                style: StrokeStyle(lineWidth: 1, dash: [4, 4])
            )

            // Table, top-down, near end at the bottom.
            let table = Path(roundedRect: CGRect(x: ox + 84 * s, y: oy + 54 * s, width: 84 * s, height: 150 * s), cornerRadius: 4 * s)
            context.fill(table, with: .color(Color(hex: 0x0E3B36).opacity(0.55)))
            context.stroke(table, with: .color(cyan), lineWidth: 2)

            var centre = Path()
            centre.move(to: P(126, 54))
            centre.addLine(to: P(126, 204))
            context.stroke(
                centre, with: .color(cyan.opacity(0.5)),
                style: StrokeStyle(lineWidth: 1, dash: [4, 4])
            )

            var net = Path()
            net.move(to: P(76, 129))
            net.addLine(to: P(176, 129))
            context.stroke(net, with: .color(Color(hex: 0xA855F7)), lineWidth: 3)

            // One ball on each half: both bounces stay visible from here.
            for ball in [P(108, 90), P(146, 168)] {
                context.fill(
                    Path(ellipseIn: CGRect(x: ball.x - 5, y: ball.y - 5, width: 10, height: 10)),
                    with: .color(Color(hex: 0xF59E0B))
                )
            }

            // Players: hollow circles with labels.
            func player(_ point: CGPoint, _ label: String, labelBelow: Bool = false) {
                context.stroke(
                    Path(ellipseIn: CGRect(x: point.x - 8, y: point.y - 8, width: 16, height: 16)),
                    with: .color(Color(hex: 0x9CA3AF)), lineWidth: 1.5
                )
                context.draw(
                    Text(label).font(.system(size: 10)).foregroundColor(Color(hex: 0x9CA3AF)),
                    at: CGPoint(x: point.x, y: point.y + (labelBelow ? 20 : -20))
                )
            }
            player(P(126, 36), "Opponent")
            player(P(106, 224), "You", labelBelow: true)

            // The band's two ends, named, and the depth note.
            func dot(_ point: CGPoint) {
                context.fill(
                    Path(ellipseIn: CGRect(x: point.x - 3.5, y: point.y - 3.5, width: 7, height: 7)),
                    with: .color(cyan.opacity(0.9))
                )
            }
            dot(P(211.7, 151.9))
            context.draw(
                Text("Side").font(.system(size: 10, weight: .medium)).foregroundColor(Color(hex: 0x67E8F9)),
                at: P(237, 146)
            )
            dot(P(216.9, 251.2))
            context.draw(
                Text("Diagonal").font(.system(size: 10, weight: .medium)).foregroundColor(Color(hex: 0x67E8F9)),
                at: P(251, 253)
            )
            context.draw(
                Text("anywhere in\nthis band").font(.system(size: 9)).foregroundColor(Color(hex: 0x67E8F9).opacity(0.9)),
                at: P(276, 174)
            )

            // Camera glyph, one example position in the band, rotated so
            // the lens points at the table.
            let rot = CGAffineTransform(translationX: cam.x, y: cam.y)
                .rotated(by: 32 * .pi / 180)
            var camBody = Path(roundedRect: CGRect(x: -13 * s, y: -8.5 * s, width: 26 * s, height: 17 * s), cornerRadius: 3 * s)
            var lens = Path()
            lens.move(to: CGPoint(x: -13 * s, y: -3.5 * s))
            lens.addLine(to: CGPoint(x: -22 * s, y: -7.5 * s))
            lens.addLine(to: CGPoint(x: -22 * s, y: 5.5 * s))
            lens.addLine(to: CGPoint(x: -13 * s, y: 1.5 * s))
            lens.closeSubpath()
            camBody = camBody.applying(rot)
            lens = lens.applying(rot)
            context.fill(camBody, with: .color(PL.cyan))
            context.fill(lens, with: .color(PL.cyan))
            let eye = CGPoint(x: 2 * s, y: 0).applying(rot)
            context.fill(
                Path(ellipseIn: CGRect(x: eye.x - 4 * s, y: eye.y - 4 * s, width: 8 * s, height: 8 * s)),
                with: .color(Color(hex: 0x0A0A0F))
            )
            context.fill(
                Path(ellipseIn: CGRect(x: eye.x - 1.6 * s, y: eye.y - 1.6 * s, width: 3.2 * s, height: 3.2 * s)),
                with: .color(PL.cyan)
            )
            context.draw(
                Text("Camera").font(.system(size: 10, weight: .medium)).foregroundColor(PL.cyan),
                at: P(246, 227)
            )
        }
    }
}


/// Three real setups, collapsed until asked for.
///
/// Not chosen by eye. Every hand-corrected quad in table_calibration_review
/// pins down the camera that filmed it, so the corpus was reduced to a pose
/// (metres behind the near end, metres to the side, height above the table)
/// and these are the closest each venue gets to the placement the rules
/// above describe. The caption states that pose, because "about here" is
/// worth much less than a number a player can pace out.
///
/// Closed by default: someone who already knows where to stand should not
/// scroll past three photographs to reach Got it. Faces are blurred,
/// bystanders included, and so is the booking name on the venue screens.
struct CameraRealSetups: View {
    @State private var open = false

    private static let setups: [(file: String, caption: String)] = [
        ("camera-ref-4",
         "Diagonal, from behind the next table. The whole table is still in the picture."),
        ("camera-ref-1",
         "9 ft to the side, level with the near end, 3 ft above the table."),
        ("camera-ref-3",
         "7 ft to the side and a little further back. A busy hall, and the table is still clear."),
    ]

    /// Loose files in Resources/, the same as guides.json, so they ride the
    /// synchronised group without needing an asset catalog entry each.
    private func image(_ name: String) -> UIImage? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "jpg") else { return nil }
        return UIImage(contentsOfFile: url.path)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation(.easeOut(duration: 0.2)) { open.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Text("Real setups that worked")
                        .font(.plRowTitle)
                        .foregroundStyle(PL.text100)
                    Spacer()
                    Text("3 photos")
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(PL.text500)
                        .rotationEffect(.degrees(open ? 90 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if open {
                ForEach(Self.setups, id: \.file) { setup in
                    VStack(alignment: .leading, spacing: 0) {
                        if let ui = image(setup.file) {
                            Image(uiImage: ui)
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                        }
                        Text(setup.caption)
                            .font(.plCaption)
                            .foregroundStyle(PL.text400)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                    }
                    .background(PL.ink)
                    .clipShape(RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                            .strokeBorder(PL.edge, lineWidth: 1)
                    )
                }
            }
        }
        .padding(.vertical, 4)
    }
}
