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
    @State private var uploader = Uploader()
    @State private var picked: PhotosPickerItem?
    @State private var recordOpen = false
    @State private var loadError: String?
    @State private var processOn = true
    @State private var placementOn = false
    @State private var opponent = ""
    @State private var venue = ""
    @State private var matchType: String?
    @State private var userSide: String?
    @State private var minutesBalance: Int?

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
                            processingDecision
                            form
                            commitRow
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
            struct Row: Decodable {
                let minutesBalance: Double?
                enum CodingKeys: String, CodingKey { case minutesBalance = "minutes_balance" }
            }
            let rows: [Row]? = try? await supa.rpc("my_processing_state").execute().value
            minutesBalance = rows?.first?.minutesBalance.map(Int.init)
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
        .interactiveDismissDisabled(isUploading)
    }

    private var isUploading: Bool {
        if case .uploading = uploader.phase { return true }
        if case .finishing = uploader.phase { return true }
        return false
    }

    // MARK: - Pick

    private var pickCard: some View {
        VStack(spacing: 14) {
            Image(systemName: "tray.and.arrow.up")
                .font(.system(size: 30, weight: .medium))
                .foregroundStyle(PL.text500)
            VStack(spacing: 4) {
                Text("Upload a match")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Text("MP4 or MOV, up to 45 minutes.")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
            }
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
            }
            Button {
                recordOpen = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "video")
                        .font(.system(size: 14, weight: .medium))
                    Text("Record a match")
                }
            }
            .buttonStyle(PLSecondaryButtonStyle())
        }
        .frame(maxWidth: .infinity)
        .plCard(padding: 28)
        .fullScreenCover(isPresented: $recordOpen) {
            RecordScreen { url in
                Task { loadError = await uploader.probe(url: url) }
            }
        }
    }

    // MARK: - Processing decision (commerce)

    private var processingDecision: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Toggle("Process when the upload finishes", isOn: $processOn)
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                    .tint(PL.cyan.opacity(0.6))
                Text("Uses \(uploader.minutesCharge) minutes of your balance.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                if let minutesBalance {
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
        .plCard(padding: 16)
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
