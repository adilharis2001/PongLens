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
    @State private var youtubeURL = ""
    @State private var youtubeState: YouTubeState = .idle

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
                    youtubeCard
                    cameraRow
                    balanceCard
                    reportRow
                }
                .padding(20)
                .padding(.bottom, 60)
            }
        }
        .task { await loadBalances() }
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
                placementOn: false
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .onAppear { queue.holdCompletion(sessionId: sessionId) }
            .onDisappear { queue.releaseCompletion(sessionId: sessionId) }
        }
        .sheet(isPresented: $cameraSheetOpen) {
            CameraPlacementSheet()
                .presentationDetents([.large])
                .presentationBackground(PL.surface)
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
        // and survives the app closing. The sheet rides on top.
        sessionId = UUID()
        draft = RecordingMetadata()
        let ext = url.pathExtension.lowercased()
        queue.enqueue(
            fileURL: url, durationS: duration, sessionId: sessionId,
            metadata: draft, processOn: true, placementOn: false,
            originalName: suggestedName.map { "\($0).\(ext)" } ?? url.lastPathComponent
        )
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
                Text("Queued. It shows up in your library once the download finishes.")
                    .font(.plBody)
                    .foregroundStyle(PL.successText)
                Button("Import another") {
                    youtubeURL = ""
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
                    Text(message)
                        .font(.plCaption)
                        .foregroundStyle(PL.dangerText)
                }
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
        struct Res: Decodable { let ok: Bool? }
        do {
            let _: Res = try await API.post("api/import-url", Req(
                url: youtubeURL.trimmingCharacters(in: .whitespacesAndNewlines),
                points: true,
                placement: false
            ))
            youtubeState = .queued
        } catch {
            youtubeState = .failed(
                (error as? APIError).map { $0.errorDescription ?? "" }
                    .flatMap { $0.isEmpty ? nil : $0 }
                    ?? "Couldn't queue that link. Check it and try again."
            )
        }
    }

    // MARK: - Camera guidance / balance / report

    private var cameraRow: some View {
        Button {
            cameraSheetOpen = true
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "video")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(PL.cyan)
                    .frame(width: 34, height: 26)
                    .background(PL.cyan.opacity(0.1), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                Text("Where to place the camera")
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.text500)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .plCard(padding: 16)
    }

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
/// the three checks that make footage processable, and the landscape note.
struct CameraPlacementSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                HStack(spacing: 8) {
                    Image(systemName: "video")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(PL.cyan)
                    Text("Where to place the camera")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(PL.textBody)
                }
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PL.cyan)
                        .frame(width: 34, height: 34)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .strokeBorder(PL.cyan.opacity(0.6), lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
            }

            CameraDiagram()
                .aspectRatio(340.0 / 300.0, contentMode: .fit)
                .frame(maxWidth: .infinity)

            VStack(alignment: .leading, spacing: 10) {
                checkRow("Diagonally behind you, raised a little")
                checkRow("The whole table in frame, so the ball lands clearly on both sides")
                checkRow("Neither player blocking the table")
            }

            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "rectangle")
                    .font(.system(size: 14))
                    .foregroundStyle(PL.cyan)
                    .padding(.top, 2)
                (Text("Hold your phone ")
                    + Text("landscape").fontWeight(.bold)
                    + Text(" (sideways). Vertical video still works, but accuracy drops."))
                    .font(.plBody)
                    .foregroundStyle(PL.text300)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )

            Button("Got it") { dismiss() }
                .buttonStyle(PLPrimaryButtonStyle())
                .frame(maxWidth: .infinity)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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

/// The top-down placement diagram: table with net, both players, and the
/// camera diagonally behind the near player with its sight lines. Shared
/// with the "Upload a video" guide in Learn.
struct CameraDiagram: View {
    var body: some View {
        Canvas { context, size in
            let w = size.width
            let h = size.height
            let teal = Color(hex: 0x2DD4BF)

            // Table: a gently keystoned quad, wider at the bottom.
            let tableTop = h * 0.16
            let tableBottom = h * 0.78
            let topL = CGPoint(x: w * 0.34, y: tableTop)
            let topR = CGPoint(x: w * 0.62, y: tableTop)
            let botL = CGPoint(x: w * 0.30, y: tableBottom)
            let botR = CGPoint(x: w * 0.66, y: tableBottom)

            // The floor wedge the camera sees, faint.
            var wedge = Path()
            let cam = CGPoint(x: w * 0.16, y: h * 0.88)
            wedge.move(to: cam)
            wedge.addLine(to: CGPoint(x: w * 0.46, y: h * 0.06))
            wedge.addLine(to: CGPoint(x: w * 0.86, y: h * 0.24))
            wedge.addLine(to: CGPoint(x: w * 0.80, y: h * 0.88))
            wedge.closeSubpath()
            context.fill(wedge, with: .color(teal.opacity(0.06)))

            var table = Path()
            table.move(to: topL)
            table.addLine(to: topR)
            table.addLine(to: botR)
            table.addLine(to: botL)
            table.closeSubpath()
            context.fill(table, with: .color(Color(hex: 0x0E3B36).opacity(0.55)))
            context.stroke(table, with: .color(teal), lineWidth: 2)

            // Center line, dashed.
            var center = Path()
            center.move(to: CGPoint(x: (topL.x + topR.x) / 2, y: tableTop))
            center.addLine(to: CGPoint(x: (botL.x + botR.x) / 2, y: tableBottom))
            context.stroke(
                center, with: .color(teal.opacity(0.5)),
                style: StrokeStyle(lineWidth: 1, dash: [4, 4])
            )

            // Net, purple, across the middle.
            let netY = (tableTop + tableBottom) / 2
            let netL = CGPoint(x: w * 0.27, y: netY)
            let netR = CGPoint(x: w * 0.69, y: netY)
            var net = Path()
            net.move(to: netL)
            net.addLine(to: netR)
            context.stroke(net, with: .color(Color(hex: 0xA855F7)), lineWidth: 3)

            // Ball on the near half.
            let ball = CGPoint(x: w * 0.55, y: h * 0.55)
            context.fill(
                Path(ellipseIn: CGRect(x: ball.x - 5, y: ball.y - 5, width: 10, height: 10)),
                with: .color(Color(hex: 0xF59E0B))
            )

            // Players: hollow circles with labels.
            func player(_ point: CGPoint, _ label: String) {
                context.stroke(
                    Path(ellipseIn: CGRect(x: point.x - 8, y: point.y - 8, width: 16, height: 16)),
                    with: .color(Color(hex: 0x9CA3AF)), lineWidth: 1.5
                )
                context.draw(
                    Text(label).font(.system(size: 10)).foregroundColor(Color(hex: 0x9CA3AF)),
                    at: CGPoint(x: point.x, y: point.y - 20)
                )
            }
            player(CGPoint(x: w * 0.48, y: h * 0.08), "Opponent")
            player(CGPoint(x: w * 0.48, y: h * 0.9), "You")

            // Camera: cyan glyph bottom-left, dashed sight lines to the far
            // corners of its wedge.
            for end in [CGPoint(x: w * 0.46, y: h * 0.06), CGPoint(x: w * 0.30, y: tableBottom)] {
                var sight = Path()
                sight.move(to: cam)
                sight.addLine(to: end)
                context.stroke(
                    sight, with: .color(teal.opacity(0.5)),
                    style: StrokeStyle(lineWidth: 1, dash: [3, 4])
                )
            }
            let body = CGRect(x: cam.x - 14, y: cam.y - 8, width: 22, height: 16)
            context.fill(Path(roundedRect: body, cornerRadius: 3), with: .color(PL.cyan))
            var lens = Path()
            lens.move(to: CGPoint(x: body.maxX, y: body.minY + 3))
            lens.addLine(to: CGPoint(x: body.maxX + 8, y: body.minY - 1))
            lens.addLine(to: CGPoint(x: body.maxX + 8, y: body.maxY + 1))
            lens.addLine(to: CGPoint(x: body.maxX, y: body.maxY - 3))
            lens.closeSubpath()
            context.fill(lens, with: .color(PL.cyan))
            context.draw(
                Text("Camera").font(.system(size: 10, weight: .medium)).foregroundColor(PL.cyan),
                at: CGPoint(x: cam.x + 2, y: cam.y + 22)
            )
        }
    }
}
