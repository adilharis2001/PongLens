import SwiftUI
import PhotosUI
import AVKit
import UniformTypeIdentifiers

struct LessonVideoScreen: View {
    var student: CoachStudentRow? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(AppState.self) private var app
    @Environment(CoachWorkspaceStore.self) private var workspace
    @State private var queue = LessonVideoQueue.shared
    @State private var studentId: UUID?
    @State private var videos: [LessonVideo] = []
    @State private var photosOpen = false
    @State private var filesOpen = false
    @State private var importing = false
    @State private var importOwner: UUID?
    @State private var importStudent: UUID?
    @State private var error: String?
    @State private var loading = true

    private var uploads: [QueuedLessonVideo] {
        queue.items.filter {
            $0.ownerId == app.userId && $0.state != "done"
                && LessonVideoScope(studentId: student?.id).includes(studentId: $0.studentId)
        }.reversed()
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Button { dismiss() } label: {
                        Label("Back", systemImage: "chevron.left")
                    }
                    .buttonStyle(PLSecondaryButtonStyle())

                    Text("Lesson videos")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    importControls

                    if let error {
                        Text(error).font(.plBody).foregroundStyle(PL.dangerText)
                    }
                    if !uploads.isEmpty { uploadSection }
                    videoSection
                }
                .padding(20)
                .padding(.bottom, 40)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background { ArenaBackground() }
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await queue.resume(); await refresh() }
            .sheet(isPresented: $photosOpen) {
                LessonVideoPhotosPicker { result in
                    photosOpen = false
                    receive(result)
                }
                .interactiveDismissDisabled()
            }
            .fileImporter(isPresented: $filesOpen, allowedContentTypes: [.movie], allowsMultipleSelection: false) { result in
                switch result {
                case .success(let urls):
                    guard let url = urls.first else { importing = false; return }
                    Task {
                        do {
                            let copy = try await Task.detached(priority: .userInitiated) {
                                let access = url.startAccessingSecurityScopedResource()
                                defer { if access { url.stopAccessingSecurityScopedResource() } }
                                return try LessonVideoQueue.copyImport(url)
                            }.value
                            receive(.success(LessonVideoImport(url: copy, name: url.lastPathComponent)))
                        } catch { receive(.failure(error)) }
                    }
                case .failure(let failure): receive(.failure(failure))
                }
            }
            .task {
                studentId = student?.id
                await queue.resume()
                await refresh()
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(10)) } catch { return }
                    if videos.contains(where: \.needsRefresh) || !uploads.isEmpty { await refresh() }
                }
            }
            .onChange(of: queue.items.filter { $0.state == "done" }.count) { _, _ in Task { await refresh() } }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await queue.resume(); await refresh() } }
            }
        }
    }

    private var importControls: some View {
        VStack(alignment: .leading, spacing: 20) {
            CoachGroup {
                if let student {
                    HStack {
                        Text("Student").foregroundStyle(PL.text400)
                        Spacer()
                        Text(student.displayName).foregroundStyle(PL.text100)
                    }
                    .font(.plBody)
                    .padding(16)
                } else {
                Menu {
                    Button("Private lesson") { studentId = nil }
                    ForEach(workspace.activeStudents) { row in
                        Button(row.displayName) { studentId = row.id }
                    }
                } label: {
                    HStack(spacing: 12) {
                        Text("Student").foregroundStyle(PL.text400)
                        Spacer(minLength: 12)
                        Text(workspace.activeStudents.first { $0.id == studentId }?.displayName ?? "Private lesson")
                            .foregroundStyle(PL.text100)
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(PL.text500)
                    }
                    .font(.plBody)
                    .padding(16)
                    .contentShape(Rectangle())
                }
                .disabled(importing)
                }
            }
            VStack(alignment: .leading, spacing: 14) {
                Text("Record in the Camera app at 1080p, 30 fps, landscape. Place the phone diagonally beside the table, near the coach so their voice is clear.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                    .lineSpacing(4)
                HStack(spacing: 12) {
                    Button { beginImport(); photosOpen = true } label: {
                        Label("Photos", systemImage: "photo.on.rectangle")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PLPrimaryButtonStyle())
                    .disabled(importing)
                    Button { beginImport(); filesOpen = true } label: {
                        Label("Files", systemImage: "folder")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                    .disabled(importing)
                }
                if importing {
                    HStack(spacing: 10) {
                        ProgressView().tint(PL.cyan)
                        Text("Preparing your video…").foregroundStyle(PL.text300)
                    }.font(.plBody)
                    Text("Keep PongLens open while the video is copied. Your recording in Photos is kept.")
                        .font(.plCaption).foregroundStyle(PL.text400)
                }
            }
            .plCard(padding: 16)
        }
    }

    private var uploadSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Uploads on this phone")
            ForEach(uploads) { item in
                VStack(alignment: .leading, spacing: 10) {
                    Text(item.originalName).font(.plCardTitle).foregroundStyle(PL.text100)
                    ProgressView(value: Double(item.uploadedBytes), total: Double(item.bytes)).tint(PL.cyan)
                    Text("\(Int(Double(item.uploadedBytes) / Double(item.bytes) * 100))% uploaded")
                        .font(.plCaption).foregroundStyle(PL.text400)
                    if let message = item.error {
                        Text(message).font(.plBody).foregroundStyle(PL.dangerText)
                    }
                    if item.state == "failed" || item.state == "waiting" {
                        Button("Resume upload") { Task { await queue.retry(item.id); await refresh() } }
                            .buttonStyle(PLSecondaryButtonStyle())
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .plCard(padding: 16)
            }
            Text("Uploads resume when you return to PongLens. Keep the app open for the fastest upload.")
                .font(.plCaption).foregroundStyle(PL.text400)
        }
    }

    private var videoSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Videos")
            if loading && videos.isEmpty {
                ProgressView().tint(PL.cyan).frame(maxWidth: .infinity)
            } else if videos.isEmpty {
                Text("No lesson videos yet.").font(.plBody).foregroundStyle(PL.text400)
            } else {
                CoachGroup {
                    ForEach(Array(videos.enumerated()), id: \.element.id) { index, video in
                        NavigationLink {
                            LessonVideoDetailScreen(id: video.id)
                        } label: {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(video.title).font(.plCardTitle).foregroundStyle(PL.text100)
                                    Text(video.statusLabel).font(.plCaption).foregroundStyle(PL.text400)
                                }
                                Spacer(minLength: 8)
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(PL.text600)
                            }
                            .padding(16)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if index < videos.count - 1 { CoachRowDivider() }
                    }
                }
            }
        }
    }

    private func beginImport() {
        importOwner = app.userId
        importStudent = studentId
        error = nil
        importing = true
    }
    private func receive(_ result: Result<LessonVideoImport, Error>?) {
        guard let result else { importing = false; return }
        switch result {
        case .failure(let failure): importing = false; error = failure.localizedDescription
        case .success(let file):
            Task {
                defer { importing = false }
                do {
                    guard let owner = importOwner, app.userId == owner else {
                        throw LessonVideoLocalError.message("Sign back in before importing this video.")
                    }
                    try await queue.enqueue(copy: file.url, originalName: file.name, ownerId: owner, studentId: importStudent)
                    await refresh()
                } catch {
                    try? FileManager.default.removeItem(at: file.url)
                    self.error = error.localizedDescription
                }
            }
        }
    }
    private func refresh() async {
        do {
            let response: LessonVideoList = try await API.get("api/lesson-video", query: LessonVideoScope(studentId: student?.id).query)
            videos = response.videos
        } catch { self.error = error.localizedDescription }
        loading = false
    }
}

private struct LessonVideoImport { let url: URL; let name: String }
private struct LessonVideoPhotosPicker: UIViewControllerRepresentable {
    let onPick: (Result<LessonVideoImport, Error>?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(onPick: onPick) }
    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration(photoLibrary: .shared())
        config.filter = .videos
        config.selectionLimit = 1
        config.preferredAssetRepresentationMode = .current
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) {}
    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let onPick: (Result<LessonVideoImport, Error>?) -> Void
        init(onPick: @escaping (Result<LessonVideoImport, Error>?) -> Void) { self.onPick = onPick }
        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            guard let provider = results.first?.itemProvider else { onPick(nil); return }
            // SwiftUI dismisses the picker after the durable copy returns.
            // Dismissing UIKit here too can close the parent lesson cover.
            let name = provider.suggestedName
            provider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { url, error in
                let result: Result<LessonVideoImport, Error>
                do {
                    if let error { throw error }
                    guard let url else { throw LessonVideoLocalError.message("Couldn't read this video. Try importing it from Files.") }
                    // This copy must finish before the callback returns: Photos owns url.
                    let copy = try LessonVideoQueue.copyImport(url)
                    result = .success(LessonVideoImport(url: copy, name: name ?? url.lastPathComponent))
                } catch { result = .failure(error) }
                Task { @MainActor in self.onPick(result) }
            }
        }
    }
}

struct LessonVideoDetailScreen: View {
    let id: UUID
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var detail: LessonVideoDetail?
    @State private var player: AVPlayer?
    @State private var urlsFetchedAt: Date?
    @State private var playerURLFetchedAt: Date?
    @State private var visible = false
    @State private var original = false
    @State private var editOpen = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Button { dismiss() } label: {
                    Label("Back", systemImage: "chevron.left")
                }
                .buttonStyle(PLSecondaryButtonStyle())
                if let detail {
                    Text(detail.video.title).font(.plPageTitle).tracking(-0.6).foregroundStyle(PL.textBody)
                    if let player {
                        VideoPlayer(player: player)
                            .aspectRatio(16 / 9, contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    Text(detail.video.statusLabel).foregroundStyle(PL.text400)
                    if let message = detail.video.error { Text(message).foregroundStyle(PL.dangerText) }
                    if let warning = detail.video.edit?.warning, !warning.isEmpty {
                        Text(warning).foregroundStyle(PL.warningText)
                    }
                    if detail.isOwner {
                        if let url = (detail.sourceUrl ?? detail.originalUrl).flatMap(URL.init(string:)) {
                            HStack {
                                Button(original ? "Watch recap" : "Watch original") { original.toggle(); setPlayer() }
                                    .buttonStyle(PLSecondaryButtonStyle())
                                    .disabled(!original && detail.sourceUrl == nil && detail.originalUrl == nil)
                                ShareLink(item: url) { Label("Original", systemImage: "square.and.arrow.up") }
                                    .buttonStyle(PLSecondaryButtonStyle())
                            }
                        }
                        if detail.video.edit != nil && ["review", "ready", "failed"].contains(detail.video.status) {
                            Button("Edit title and cues") { editOpen = true }
                                .buttonStyle(PLSecondaryButtonStyle()).disabled(busy)
                        }
                        if detail.video.status == "review" {
                            Button(detail.video.student_id == nil ? "Save recap" : "Share with student") { perform("share") }
                                .buttonStyle(PLPrimaryButtonStyle()).disabled(busy)
                        }
                        if detail.video.status == "failed" {
                            Button("Retry processing") { perform("retry") }
                                .buttonStyle(PLPrimaryButtonStyle()).disabled(busy)
                        }
                    }
                    if let edit = detail.video.edit {
                        ForEach(Array(edit.chapters.enumerated()), id: \.offset) { _, chapter in
                            VStack(alignment: .leading, spacing: 8) {
                                Button {
                                    let seconds = original ? chapter.start_s : chapter.summary_start_s
                                    if let seconds { player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600)); player?.play() }
                                } label: {
                                    Label(chapter.title, systemImage: "play.circle").font(.plCardTitle)
                                        .frame(minHeight: 44, alignment: .leading)
                                }.disabled(player == nil || (!original && chapter.summary_start_s == nil))
                                ForEach(Array(chapter.cues.enumerated()), id: \.offset) { _, cue in
                                    Text(cue).foregroundStyle(PL.text300)
                                }
                            }
                        }
                        if !edit.themes.isEmpty {
                            Text("Lesson notes").font(.plCardTitle)
                            ForEach(Array(edit.themes.enumerated()), id: \.offset) { _, theme in
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(theme.name).font(.plCardTitle)
                                    ForEach(Array(theme.points.enumerated()), id: \.offset) { _, point in Text(point).foregroundStyle(PL.text300) }
                                }
                            }
                        }
                    }
                } else if error == nil {
                    ProgressView().tint(PL.cyan).frame(maxWidth: .infinity, minHeight: 160)
                }
                if let error { Text(error).foregroundStyle(PL.dangerText) }
            }
            .font(.plBody)
            .lineSpacing(3)
            .padding(20)
            .padding(.bottom, 40)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background { ArenaBackground() }
        .toolbar(.hidden, for: .navigationBar)
        .refreshable { await load(refreshPlayback: true) }
        .task {
            await load(refreshPlayback: true)
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(10)) } catch { return }
                let renewPlayback = LessonVideoPlaybackRefresh.isDue(lastRefresh: playerURLFetchedAt)
                if detail?.video.needsRefresh == true || renewPlayback {
                    await load(refreshPlayback: renewPlayback)
                }
            }
        }
        .onAppear { visible = true }
        .onDisappear { visible = false; player?.pause() }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { player?.pause() }
            else { Task { await load(refreshPlayback: true) } }
        }
        .sheet(isPresented: $editOpen) {
            if let edit = detail?.video.edit {
                LessonVideoEditSheet(id: id, expectedRevision: detail?.video.revision, edit: edit) { await load() }
            }
        }
    }
    private func setPlayer(preservingPosition: Bool = false) {
        let position = preservingPosition ? player?.currentTime() : nil
        let wasPlaying = preservingPosition && (player?.rate ?? 0) > 0
        player?.pause()
        guard let detail else { player = nil; playerURLFetchedAt = nil; return }
        let raw = original ? (detail.sourceUrl ?? detail.originalUrl) : (detail.playbackUrl ?? detail.summaryUrl)
        let replacement = raw.flatMap(URL.init(string:)).map { AVPlayer(url: $0) }
        player = replacement
        playerURLFetchedAt = replacement == nil ? nil : urlsFetchedAt
        if let replacement, let position, position.seconds.isFinite, position.seconds > 0 {
            replacement.seek(to: position, toleranceBefore: .zero, toleranceAfter: .zero) { finished in
                Task { @MainActor in
                    if finished && wasPlaying && visible && scenePhase == .active && player === replacement {
                        replacement.play()
                    }
                }
            }
        } else if wasPlaying && visible && scenePhase == .active { replacement?.play() }
    }
    private func load(refreshPlayback: Bool = false) async {
        do {
            let value: LessonVideoDetail = try await API.get("api/lesson-video", query: ["id": id.uuidString])
            let changed = detail?.video.revision != value.video.revision || detail?.video.status != value.video.status
            detail = value
            urlsFetchedAt = Date()
            error = nil
            if player == nil || changed || refreshPlayback {
                setPlayer(preservingPosition: !changed && player != nil)
            }
        } catch { self.error = error.localizedDescription }
    }
    private func perform(_ action: String) {
        busy = true
        Task {
            defer { busy = false }
            do {
                let _: LessonVideoOK = try await API.post("api/lesson-video", LessonVideoAction(action: action, id: id))
                await load()
            } catch { self.error = error.localizedDescription }
        }
    }
}

private struct LessonVideoEditSheet: View {
    let id: UUID
    let expectedRevision: Int?
    @State var edit: LessonVideoEdit
    let onSaved: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    HStack {
                        Button("Cancel") { dismiss() }
                            .buttonStyle(PLSecondaryButtonStyle())
                            .disabled(busy)
                        Spacer()
                        Button(busy ? "Saving…" : "Save") { save() }
                            .buttonStyle(PLPrimaryButtonStyle())
                            .disabled(busy || edit.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    Text("Edit recap").font(.plPageTitle).tracking(-0.6).foregroundStyle(PL.textBody)
                    VStack(alignment: .leading, spacing: 10) {
                        SectionHeading("Title")
                        TextField("Lesson title", text: $edit.title, axis: .vertical)
                            .font(.plCardTitle)
                            .foregroundStyle(PL.text100)
                            .plCard(padding: 16)
                    }
                    ForEach(edit.chapters.indices, id: \.self) { index in
                        VStack(alignment: .leading, spacing: 14) {
                            TextField("Chapter title", text: $edit.chapters[index].title, axis: .vertical)
                                .font(.plCardTitle).foregroundStyle(PL.text100)
                            ForEach(edit.chapters[index].cues.indices, id: \.self) { cue in
                                TextField("Cue", text: $edit.chapters[index].cues[cue], axis: .vertical)
                                    .font(.plBody)
                                    .foregroundStyle(PL.text300)
                                    .lineLimit(2...6)
                                if cue < edit.chapters[index].cues.count - 1 {
                                    Rectangle().fill(PL.edge).frame(height: 1)
                                }
                            }
                        }
                        .plCard(padding: 16)
                    }
                    Text("Saving prepares a new recap. Review it again before saving or sharing.")
                        .font(.plCaption).foregroundStyle(PL.text400)
                    if let error { Text(error).font(.plBody).foregroundStyle(PL.dangerText) }
                }
                .padding(20)
                .padding(.bottom, 40)
            }
            .background { ArenaBackground() }
            .toolbar(.hidden, for: .navigationBar)
            .plKeyboardDismiss()
            .interactiveDismissDisabled(busy)
        }
    }

    private func save() {
        busy = true
        Task {
            do {
                let _: LessonVideoOK = try await API.post("api/lesson-video", LessonVideoAction(action: "edit", id: id, edit: edit, expectedRevision: expectedRevision))
                await onSaved()
                dismiss()
            } catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}
