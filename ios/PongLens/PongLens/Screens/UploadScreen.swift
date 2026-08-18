import PhotosUI
import Supabase
import SwiftUI

/// Movie import that streams to a temp file — a match video never has to
/// fit in memory.
struct MovieFile: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .movie) { received in
            let destination = FileManager.default.temporaryDirectory
                .appendingPathComponent("upload-\(UUID().uuidString).\(received.file.pathExtension)")
            try FileManager.default.copyItem(at: received.file, to: destination)
            return MovieFile(url: destination)
        }
    }
}

struct UploadScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @Environment(LibraryStore.self) private var library
    @Environment(Router.self) private var router
    @State private var uploader = Uploader()
    @State private var picked: PhotosPickerItem?
    @State private var loadError: String?
    @State private var processOn = true
    @State private var placementOn = false
    @State private var opponent = ""
    @State private var venue = ""
    @State private var matchType: String?
    @State private var userSide: String?
    @State private var minutesBalance: Int?
    @State private var storageUsed: Int64?
    @State private var storageLimit: Int64?
    @State private var cameraSheetOpen = false
    @State private var feedbackOpen = false
    @State private var youtubeURL = ""
    @State private var youtubeState: YouTubeState = .idle

    enum YouTubeState: Equatable {
        case idle, sending, queued
        case failed(String)
    }

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
                            uploader.cancel()
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

                    switch uploader.phase {
                    case .idle, .probing:
                        pickCard
                        if uploader.durationS != nil {
                            form
                            commitRow
                        } else {
                            youtubeCard
                            cameraRow
                            balanceCard
                            reportRow
                        }
                    case .uploading(let progress):
                        progressCard(progress, finishing: false)
                        form
                        cancelRow
                    case .finishing:
                        progressCard(1, finishing: true)
                    case .done(let matchId, let processed):
                        doneCard(matchId: matchId, processed: processed)
                    case .failed(let message):
                        failedCard(message)
                    }
                }
                .padding(20)
                .padding(.bottom, 60)
            }
        }
        .task {
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
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task {
                loadError = nil
                if let movie = try? await item.loadTransferable(type: MovieFile.self) {
                    loadError = await uploader.probe(url: movie.url)
                } else {
                    loadError = "That's not an MP4 or MOV video."
                }
            }
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
        .interactiveDismissDisabled(isUploading)
    }

    private var isUploading: Bool {
        if case .uploading = uploader.phase { return true }
        if case .finishing = uploader.phase { return true }
        return false
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

            processingDecision

            VStack(spacing: 14) {
                if let loadError {
                    Text(loadError)
                        .font(.plCaption)
                        .foregroundStyle(PL.warningText)
                        .multilineTextAlignment(.center)
                }
                if let poster = uploader.poster {
                    Image(uiImage: poster)
                        .resizable()
                        .scaledToFill()
                        .frame(height: 130)
                        .clipShape(RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                    Text(uploader.fileName)
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                } else {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 26, weight: .medium))
                        .foregroundStyle(PL.text500)
                }
                PhotosPicker(selection: $picked, matching: .videos) {
                    Text(uploader.phase == .probing
                        ? "Reading the video…"
                        : uploader.durationS == nil ? "Choose a video" : "Choose a different video")
                        .font(.plButton)
                        .foregroundStyle(PL.ink)
                        .padding(.horizontal, 22)
                        .padding(.vertical, 12)
                        .background(PL.cyan, in: Capsule())
                        .shadow(color: PL.cyan.opacity(0.5), radius: 14)
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

    // MARK: - Processing decision (commerce)

    private var processingDecision: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Toggle("Process when the upload finishes", isOn: $processOn)
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                    .tint(PL.cyan.opacity(0.6))
                Text(uploader.durationS == nil
                    ? "Its length in minutes comes off your balance."
                    : "Uses \(uploader.minutesCharge) minutes of your balance.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                if uploader.durationS != nil, let minutesBalance {
                    Text("You have \(minutesBalance).")
                        .font(.plCaption)
                        .foregroundStyle(
                            minutesBalance < uploader.minutesCharge && processOn
                                ? PL.warningText : PL.text500
                        )
                }
            }
            Rectangle().fill(PL.edge.opacity(0.5)).frame(height: 1)
            VStack(alignment: .leading, spacing: 3) {
                Toggle(isOn: $placementOn) {
                    HStack(spacing: 8) {
                        Text("Placement maps")
                            .font(.plRowTitle)
                            .foregroundStyle(PL.text100)
                        Text("BETA")
                            .font(.system(size: 10, weight: .semibold))
                            .tracking(0.5)
                            .foregroundStyle(PL.warningText.opacity(0.9))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(PL.warning.opacity(0.1), in: Capsule())
                            .overlay(Capsule().strokeBorder(PL.warning.opacity(0.25), lineWidth: 1))
                    }
                }
                .tint(PL.cyan.opacity(0.6))
                Text("Where every ball landed. Adds processing time.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
        }
        .padding(14)
        .background(PL.ink.opacity(0.35), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                .strokeBorder(PL.edge.opacity(0.8), lineWidth: 1)
        )
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
                points: processOn,
                placement: placementOn
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

    private func gbString(_ bytes: Int64) -> String {
        let gb = Double(bytes) / 1_073_741_824
        return gb >= 10 ? String(format: "%.0f GB", gb) : String(format: "%.1f GB", gb)
    }

    // MARK: - Form

    private var form: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeading("Match details")
            TextField("Opponent name", text: $opponent).plField()
            TextField("Club or location", text: $venue).plField()
            FlowLayout(spacing: 8) {
                ForEach(["drills", "practice", "match", "league", "tournament"], id: \.self) { value in
                    let active = matchType == value
                    Button(MatchTitle.typeLabel[value] ?? value) {
                        matchType = active ? nil : value
                    }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(active ? PL.cyan : PL.text400)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(active ? PL.cyan.opacity(0.15) : .clear, in: Capsule())
                    .overlay(Capsule().strokeBorder(active ? PL.cyan.opacity(0.5) : PL.edge, lineWidth: 1))
                    .buttonStyle(.plain)
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("Which player are you?")
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                HStack(spacing: 10) {
                    sidePill("Bottom of video", value: "near")
                    sidePill("Top of video", value: "far")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
    }

    private func sidePill(_ label: String, value: String) -> some View {
        let active = userSide == value
        return Button(label) { userSide = active ? nil : value }
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(active ? PL.cyan : PL.text400)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(active ? PL.cyan.opacity(0.15) : .clear, in: Capsule())
            .overlay(Capsule().strokeBorder(active ? PL.cyan.opacity(0.5) : PL.edge, lineWidth: 1))
            .buttonStyle(.plain)
    }

    // MARK: - Progress / commit / done

    private var commitRow: some View {
        Button(processOn ? "Process video" : "Save video in library") {
            uploader.start(
                register: Uploader.Register(
                    opponent: opponent.isEmpty ? nil : opponent,
                    venue: venue.isEmpty ? nil : venue,
                    matchType: matchType,
                    userSide: userSide
                ),
                process: processOn,
                placement: placementOn
            )
        }
        .buttonStyle(PLPrimaryButtonStyle())
        .frame(maxWidth: .infinity)
    }

    private func progressCard(_ progress: Double, finishing: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("\(Int(progress * 100))%")
                    .font(.system(size: 34, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(PL.text100)
                Text(finishing ? "Finishing up" : "Uploading")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(PL.surface2)
                    Capsule().fill(PL.cyan)
                        .frame(width: max(6, geo.size.width * progress))
                }
            }
            .frame(height: 6)
            Text("\(byteString(uploader.uploadedBytes)) of \(byteString(uploader.totalBytes))")
                .font(.plCaption)
                .monospacedDigit()
                .foregroundStyle(PL.text500)
            Text(uploader.fileName)
                .font(.plCaption)
                .foregroundStyle(PL.text600)
            Text("Keep this screen open until it finishes.")
                .font(.plBody)
                .foregroundStyle(PL.warningText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 18)
    }

    private var cancelRow: some View {
        Button("Cancel upload") { uploader.cancel() }
            .buttonStyle(PLSoftDestructiveButtonStyle())
            .frame(maxWidth: .infinity)
    }

    private func doneCard(matchId: UUID?, processed: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(processed ? "Uploaded. Processing has started." : "Uploaded. It's in your library.")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
            Text(processed
                ? "\(uploader.minutesCharge) minutes used. You'll get an email when it's ready."
                : "Process it any time from the match page.")
                .font(.plBody)
                .foregroundStyle(PL.text400)
            HStack(spacing: 10) {
                if matchId != nil {
                    Button("Open the video") {
                        Task { await library.load() }
                        dismiss()
                    }
                    .buttonStyle(PLPrimaryButtonStyle())
                }
                Button("Upload another") {
                    uploader.reset()
                    picked = nil
                }
                .buttonStyle(PLSecondaryButtonStyle())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 18)
    }

    private func failedCard(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(message)
                .font(.plBody)
                .foregroundStyle(PL.warningText)
            Button("Close") {
                uploader.reset()
            }
            .buttonStyle(PLSecondaryButtonStyle())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 18)
    }

    private func byteString(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
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
/// camera diagonally behind the near player with its sight lines.
private struct CameraDiagram: View {
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
