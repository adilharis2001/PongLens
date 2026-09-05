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
        queue.items.filter { $0.ownerId == app.userId && $0.state != "done" }.reversed()
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Record in the Camera app at 1080p, 30 fps, landscape. Place the phone diagonally beside the table, near the coach so their voice is clear. Import the recording here afterwards.")
                        .foregroundStyle(PL.text300)
                    Picker("For", selection: $studentId) {
                        Text("My own lesson").tag(Optional<UUID>.none)
                        ForEach(workspace.activeStudents) { row in
                            Text(row.displayName).tag(Optional(row.id))
                        }
                    }
                    .disabled(importing)
                    Button { beginImport(); photosOpen = true } label: {
                        Label("Import from Photos", systemImage: "photo.on.rectangle")
                            .frame(minHeight: 32)
                    }
                    .disabled(importing)
                    Button { beginImport(); filesOpen = true } label: {
                        Label("Import from Files", systemImage: "folder")
                            .frame(minHeight: 32)
                    }
                    .disabled(importing)
                    if importing {
                        HStack { ProgressView(); Text("Preparing your video…") }
                        Text("Keep PongLens open while the video is copied. Your recording in Photos is kept.")
                            .foregroundStyle(PL.text400)
                    }
                }
                if let error { Section { Text(error).foregroundStyle(PL.dangerText) } }
                if !uploads.isEmpty {
                    Section("Uploads on this phone") {
                        ForEach(uploads) { item in
                            VStack(alignment: .leading, spacing: 10) {
                                Text(item.originalName).font(.headline)
                                ProgressView(value: Double(item.uploadedBytes), total: Double(item.bytes))
                                Text("\(Int(Double(item.uploadedBytes) / Double(item.bytes) * 100))% uploaded")
                                    .foregroundStyle(PL.text400)
                                if let message = item.error { Text(message).foregroundStyle(PL.dangerText) }
                                if item.state == "failed" || item.state == "waiting" {
                                    Button("Resume upload") { Task { await queue.retry(item.id); await refresh() } }
                                        .buttonStyle(.bordered).controlSize(.large)
                                }
                            }.padding(.vertical, 8)
                        }
                        Text("Uploads resume when you return to PongLens. Keep the app open for the fastest upload.")
                            .foregroundStyle(PL.text400)
                    }
                }
                Section("Lesson videos") {
                    if loading && videos.isEmpty { ProgressView() }
                    else if videos.isEmpty { Text("No lesson videos yet.").foregroundStyle(PL.text400) }
                    ForEach(videos) { video in
                        NavigationLink {
                            LessonVideoDetailScreen(id: video.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(video.title).font(.headline)
                                Text(video.statusLabel).foregroundStyle(PL.text400)
                            }.padding(.vertical, 6)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(PL.ink)
            .navigationTitle("Lesson videos")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Done") { dismiss() } } }
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
            let response: LessonVideoList = try await API.get("api/lesson-video")
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
                if let detail {
                    Text(detail.video.title).font(.title2.bold())
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
                                    .buttonStyle(.bordered).controlSize(.large)
                                    .disabled(!original && detail.sourceUrl == nil && detail.originalUrl == nil)
                                ShareLink(item: url) { Label("Original", systemImage: "square.and.arrow.up") }
                                    .buttonStyle(.bordered).controlSize(.large)
                            }
                        }
                        if detail.video.edit != nil && ["review", "ready", "failed"].contains(detail.video.status) {
                            Button("Edit title and cues") { editOpen = true }
                                .buttonStyle(.bordered).controlSize(.large).disabled(busy)
                        }
                        if detail.video.status == "review" {
                            Button(detail.video.student_id == nil ? "Save recap" : "Share with student") { perform("share") }
                                .buttonStyle(.borderedProminent).controlSize(.large).disabled(busy)
                        }
                        if detail.video.status == "failed" {
                            Button("Retry processing") { perform("retry") }
                                .buttonStyle(.borderedProminent).controlSize(.large).disabled(busy)
                        }
                    }
                    if let edit = detail.video.edit {
                        ForEach(Array(edit.chapters.enumerated()), id: \.offset) { _, chapter in
                            VStack(alignment: .leading, spacing: 8) {
                                Button {
                                    let seconds = original ? chapter.start_s : chapter.summary_start_s
                                    if let seconds { player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600)); player?.play() }
                                } label: {
                                    Label(chapter.title, systemImage: "play.circle").font(.headline)
                                        .frame(minHeight: 44, alignment: .leading)
                                }.disabled(player == nil || (!original && chapter.summary_start_s == nil))
                                ForEach(Array(chapter.cues.enumerated()), id: \.offset) { _, cue in
                                    Text(cue).foregroundStyle(PL.text300)
                                }
                            }
                        }
                        if !edit.themes.isEmpty {
                            Text("Lesson notes").font(.title3.bold())
                            ForEach(Array(edit.themes.enumerated()), id: \.offset) { _, theme in
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(theme.name).font(.headline)
                                    ForEach(Array(theme.points.enumerated()), id: \.offset) { _, point in Text(point).foregroundStyle(PL.text300) }
                                }
                            }
                        }
                    }
                } else if error == nil { ProgressView() }
                if let error { Text(error).foregroundStyle(PL.dangerText) }
            }.padding(20)
        }
        .background(PL.ink)
        .navigationTitle("Lesson video")
        .navigationBarTitleDisplayMode(.inline)
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
            Form {
                Section("Title") { TextField("Lesson title", text: $edit.title) }
                ForEach(edit.chapters.indices, id: \.self) { index in
                    Section {
                        TextField("Chapter title", text: $edit.chapters[index].title)
                        ForEach(edit.chapters[index].cues.indices, id: \.self) { cue in
                            TextField("Cue", text: $edit.chapters[index].cues[cue], axis: .vertical)
                                .lineLimit(2...6)
                        }
                    }
                }
                Section { Text("Saving prepares a new recap. Review it again before saving or sharing.") }
                if let error { Section { Text(error).foregroundStyle(PL.dangerText) } }
            }
            .navigationTitle("Edit recap")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "Saving…" : "Save") {
                        busy = true
                        Task {
                            do {
                                let _: LessonVideoOK = try await API.post("api/lesson-video", LessonVideoAction(action: "edit", id: id, edit: edit, expectedRevision: expectedRevision))
                                await onSaved()
                                dismiss()
                            } catch { self.error = error.localizedDescription }
                            busy = false
                        }
                    }.disabled(busy || edit.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .interactiveDismissDisabled(busy)
        }
    }
}
