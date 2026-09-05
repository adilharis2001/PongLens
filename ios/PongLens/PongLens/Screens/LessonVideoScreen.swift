import SwiftUI
import Combine

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
    @State private var original = false
    @State private var editOpen = false
    @State private var busy = false
    @State private var error: String?

    @State private var watchOpen = false
    @State private var deleteOpen = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    Button { dismiss() } label: { Label("Back", systemImage: "chevron.left") }
                        .buttonStyle(PLSecondaryButtonStyle())
                    Spacer()
                    if let detail { moreMenu(detail) }
                }
                if let detail {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(detail.video.title).font(.plPageTitle).tracking(-0.6).foregroundStyle(PL.textBody)
                        Text(detail.video.statusLabel).font(.plCaption).foregroundStyle(PL.cyan)
                    }
                    if detail.playbackUrl != nil || detail.summaryUrl != nil {
                        Button {
                            if original { original = false; setPlayer() }
                            watchOpen = true
                        } label: {
                            ZStack {
                                PL.surface2
                                AsyncImage(url: detail.posterUrl.flatMap(URL.init(string:))) { phase in
                                    if let image = phase.image { image.resizable().scaledToFill() }
                                    else if phase.error == nil && detail.posterUrl != nil { ProgressView().tint(PL.cyan).offset(y: 60) }
                                }
                                Image(systemName: "play.fill").font(.system(size: 26, weight: .semibold))
                                    .foregroundStyle(.white).frame(width: 68, height: 68)
                                    .background(.black.opacity(0.65), in: Circle())
                            }
                            .aspectRatio(16 / 9, contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }.buttonStyle(.plain).accessibilityLabel("Watch lesson recap")
                        if let count = detail.video.edit?.chapters.count, count > 0 {
                            Label("\(count) chapters · Watch with coaching notes", systemImage: "text.bubble")
                                .font(.plBody).foregroundStyle(PL.text300)
                        }
                    }
                    if detail.isOwner && detail.video.status == "review" {
                        Button { perform("share") } label: {
                            Text(detail.video.student_id == nil ? "Save recap" : "Share with student")
                                .frame(maxWidth: .infinity)
                        }.buttonStyle(PLPrimaryButtonStyle()).disabled(busy)
                    }
                    if detail.isOwner && detail.video.status == "failed" {
                        Button("Retry processing") { perform("retry") }.buttonStyle(PLPrimaryButtonStyle()).disabled(busy)
                    }
                    if let message = detail.video.error { Text(message).foregroundStyle(PL.dangerText) }
                    if let warning = detail.video.edit?.warning, !warning.isEmpty {
                        DisclosureGroup("Review note") { Text(warning).foregroundStyle(PL.warningText).padding(.top, 8) }
                            .font(.plCaption)
                    }
                } else if error == nil {
                    ProgressView().tint(PL.cyan).frame(maxWidth: .infinity, minHeight: 160)
                }
                if let error { Text(error).foregroundStyle(PL.dangerText) }
            }
            .font(.plBody).lineSpacing(3).padding(20).padding(.bottom, 40)
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
                if !watchOpen && (detail?.video.needsRefresh == true || renewPlayback) {
                    await load(refreshPlayback: renewPlayback)
                }
            }
        }
        .confirmationDialog("Delete this lesson video?", isPresented: $deleteOpen, titleVisibility: .visible) {
            Button("Delete lesson video", role: .destructive) { perform("delete") }
        } message: { Text("The original video and recap will be permanently deleted.") }
        .onDisappear { if !watchOpen { player?.pause() } }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { player?.pause() }
            else if !watchOpen { Task { await load(refreshPlayback: true) } }
        }
        .fullScreenCover(isPresented: $watchOpen, onDismiss: { player?.pause() }) {
            if let player, player.currentItem != nil, let detail {
                LessonVideoTakeover(player: player, title: detail.video.title,
                    chapters: detail.video.edit?.chapters ?? [], original: original,
                    refresh: { await load(refreshPlayback: true) },
                    renewIfNeeded: {
                        if LessonVideoPlaybackRefresh.isDue(lastRefresh: playerURLFetchedAt) { await load(refreshPlayback: true) }
                    })
            }
        }
        .sheet(isPresented: $editOpen) {
            if let edit = detail?.video.edit {
                LessonVideoEditSheet(id: id, expectedRevision: detail?.video.revision, edit: edit) { await load() }
            }
        }
    }
    private func moreMenu(_ detail: LessonVideoDetail) -> some View {
        Menu {
            if detail.isOwner && detail.video.edit != nil && ["review", "ready", "failed"].contains(detail.video.status) {
                Button("Edit recap", systemImage: "pencil") { editOpen = true }
            }
            if detail.isOwner, detail.sourceUrl != nil || detail.originalUrl != nil {
                Button(original ? "Watch recap" : "Watch original") { original.toggle(); setPlayer(); watchOpen = true }
                if let url = (detail.sourceUrl ?? detail.originalUrl).flatMap(URL.init(string:)) {
                    ShareLink(item: url) { Label("Export original video", systemImage: "square.and.arrow.up") }
                }
            }
            if let url = detail.summaryUrl.flatMap(URL.init(string:)) {
                ShareLink(item: url) { Label("Export recap with cues", systemImage: "square.and.arrow.up") }
            }
            if detail.isOwner && !detail.video.needsRefresh {
                Button("Delete lesson video", role: .destructive) { deleteOpen = true }
            }
        } label: { Label("More", systemImage: "ellipsis") }
            .buttonStyle(PLSecondaryButtonStyle()).disabled(busy)
    }
    private func setPlayer(preservingPosition: Bool = false) {
        let position = preservingPosition ? player?.currentTime() : nil
        let wasPlaying = preservingPosition && (player?.rate ?? 0) > 0
        player?.pause()
        guard let detail else { return }
        let raw = original ? (detail.sourceUrl ?? detail.originalUrl) : (detail.playbackUrl ?? detail.summaryUrl)
        guard let url = raw.flatMap(URL.init(string:)) else { player?.replaceCurrentItem(with: nil); return }
        // Keep one player across the detail, takeover, source changes and URL renewal.
        let activePlayer = player ?? AVPlayer()
        let item = AVPlayerItem(url: url)
        activePlayer.replaceCurrentItem(with: item)
        player = activePlayer
        playerURLFetchedAt = urlsFetchedAt
        if let position, position.seconds.isFinite, position.seconds > 0 {
            activePlayer.seek(to: position, toleranceBefore: .zero, toleranceAfter: .zero) { finished in
                Task { @MainActor in
                    if finished && wasPlaying && watchOpen && scenePhase == .active && activePlayer.currentItem === item {
                        activePlayer.play()
                    }
                }
            }
        } else if wasPlaying && watchOpen && scenePhase == .active { activePlayer.play() }
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
                if action == "delete" { dismiss() } else { await load() }
            } catch { self.error = error.localizedDescription }
        }
    }
}

/// Watch-style presentation: footage and synchronized notes stay together in both orientations.
private struct LessonVideoTakeover: View {
    let player: AVPlayer
    let title: String
    let chapters: [LessonVideoEdit.Chapter]
    let original: Bool
    let refresh: () async -> Void
    let renewIfNeeded: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var selected = 0
    @State private var currentTime = 0.0
    @State private var duration = 0.0
    @State private var isPlaying = false
    @State private var buffering = false
    @State private var failed = false
    @State private var visible = false
    @State private var seeking = false
    @State private var seekGeneration = UUID()
    @State private var scrubbing = false
    @State private var resumeAfterScrub = false
    @State private var retrying = false
    @State private var forcedLandscape = false
    @State private var chromeVisible = true
    @State private var chromeGeneration = UUID()
    private let tick = Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()

    var body: some View {
        GeometryReader { geo in
            let landscape = geo.size.width > geo.size.height
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    Button { player.pause(); dismiss() } label: {
                        Image(systemName: "xmark").font(.plCardTitle).frame(width: 44, height: 44)
                    }.accessibilityLabel("Close lesson viewer")
                    Text(original ? "Original lesson video" : title).font(.plRowTitle).lineLimit(1)
                    Spacer(minLength: 0)
                    Button {
                        forcedLandscape = !landscape
                        requestOrientation(landscape ? .portrait : .landscapeRight)
                    } label: {
                        Image(systemName: landscape ? "rectangle.portrait.arrowtriangle.2.outward" : "rectangle.landscape.rotate")
                            .font(.plCardTitle).frame(width: 44, height: 44)
                    }.accessibilityLabel(landscape ? "Back to portrait" : "Turn to landscape")
                }.foregroundStyle(PL.text100).padding(.horizontal, 8)
                if landscape {
                    HStack(spacing: 0) {
                        video.frame(width: geo.size.width * 0.56)
                        chapterPages.frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                } else {
                    video.frame(height: geo.size.width * 9 / 16)
                    chapterPages.frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .background { ArenaBackground() }
        .preferredColorScheme(.dark)
        .onAppear {
            visible = true
            synchronize()
            if duration > 0 && currentTime >= duration - 0.1 { seek(to: 0, resume: true) }
            else { player.play() }
        }
        .onDisappear {
            visible = false
            seekGeneration = UUID()
            player.pause()
            if forcedLandscape && !UIDevice.current.orientation.isLandscape { requestOrientation(.portrait) }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { player.pause() }
            else { Task { await refresh() } }
        }
        .task {
            await renewIfNeeded()
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
                await renewIfNeeded()
            }
        }
        .onReceive(tick) { _ in synchronize() }
    }

    private var video: some View {
        ZStack {
            PlayerLayerView(player: player)
                .contentShape(Rectangle()).onTapGesture { revealControls() }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Show playback controls")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { revealControls() }
            VStack {
                Spacer()
                HStack {
                    Button {
                        if player.rate > 0 { player.pause() }
                        else if duration > 0 && currentTime >= duration - 0.1 { seek(to: 0, resume: true) }
                        else { player.play() }
                    } label: {
                        Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 24, weight: .semibold)).foregroundStyle(.white)
                            .frame(width: 56, height: 56).background(.black.opacity(0.5), in: Circle())
                    }.accessibilityLabel(isPlaying ? "Pause lesson" : "Play lesson")
                }
                Spacer()
                HStack(spacing: 10) {
                    Text(timeLabel(currentTime)).monospacedDigit().frame(minWidth: 34)
                    Slider(value: $currentTime, in: 0...max(duration, 1)) { editing in
                        if editing { resumeAfterScrub = player.rate > 0; scrubbing = true; player.pause() }
                        else { scrubbing = false; seek(to: currentTime, resume: resumeAfterScrub) }
                    }.tint(PL.cyan).disabled(duration <= 0).accessibilityLabel("Lesson playback position")
                    Text(timeLabel(duration)).monospacedDigit().frame(minWidth: 34)
                }
                .font(.plCaption).foregroundStyle(.white).padding(.horizontal, 12).padding(.vertical, 6)
                .background(.black.opacity(0.65))
            }
            .opacity(chromeVisible ? 1 : 0).allowsHitTesting(chromeVisible).accessibilityHidden(!chromeVisible)
            .animation(.easeInOut(duration: 0.2), value: chromeVisible)
            if buffering && !failed { ProgressView().tint(.white).padding(16).background(.black.opacity(0.75), in: Circle()).allowsHitTesting(false) }
            if failed {
                VStack(spacing: 12) {
                    Text("Video could not play").font(.plCardTitle)
                    Button(retrying ? "Loading…" : "Try again") {
                        retrying = true
                        Task {
                            await refresh()
                            retrying = false
                            if visible && scenePhase == .active { player.play() }
                        }
                    }.buttonStyle(PLSecondaryButtonStyle()).disabled(retrying)
                }.frame(maxWidth: .infinity, maxHeight: .infinity).background(PL.surface)
            }
        }.clipped()
    }

    private var chapterPages: some View {
        VStack(spacing: 0) {
            if !chapters.isEmpty {
                HStack {
                    Button { selectChapter(max(0, selected - 1)) } label: {
                        Image(systemName: "chevron.left").frame(width: 44, height: 44)
                    }.disabled(selected == 0).accessibilityLabel("Previous chapter")
                    Spacer()
                    Text("Chapter \(selected + 1) of \(chapters.count)").font(.plButton).foregroundStyle(PL.cyan)
                    Spacer()
                    Button { selectChapter(min(chapters.count - 1, selected + 1)) } label: {
                        Image(systemName: "chevron.right").frame(width: 44, height: 44)
                    }.disabled(selected == chapters.count - 1).accessibilityLabel("Next chapter")
                }.foregroundStyle(PL.text100).padding(.horizontal, 8).padding(.top, 8)
                // Only user-driven page writes seek. Playback-driven selection assigns
                // `selected` directly, so an automatic cue transition cannot seek back.
                TabView(selection: Binding(get: { selected }, set: { selectChapter($0) })) {
                    ForEach(Array(chapters.enumerated()), id: \.offset) { index, chapter in
                        ScrollView {
                            VStack(alignment: .leading, spacing: 18) {
                                Text(chapter.title).font(.plPageTitle).foregroundStyle(PL.text100)
                                ForEach(Array(chapter.cues.enumerated()), id: \.offset) { _, cue in
                                    Text(cue).font(.plCardTitle.weight(.regular)).foregroundStyle(PL.text300).lineSpacing(5)
                                }
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(20).padding(.bottom, 20)
                        }.tag(index)
                    }
                }.tabViewStyle(.page(indexDisplayMode: .automatic))
            } else {
                Text("Coaching notes are not available for this video yet.")
                    .font(.plBody).foregroundStyle(PL.text400).padding(20)
                Spacer()
            }
        }
    }

    private func selectChapter(_ index: Int) {
        guard chapters.indices.contains(index), index != selected else { return }
        selected = index
        let chapter = chapters[index]
        if let start = original ? chapter.start_s : chapter.summary_start_s { seek(to: start, resume: true) }
    }
    private func seek(to seconds: Double, resume: Bool) {
        guard seconds.isFinite else { return }
        let generation = UUID()
        seekGeneration = generation
        seeking = true
        let item = player.currentItem
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { finished in
            Task { @MainActor in
                guard generation == seekGeneration else { return }
                seeking = false
                if finished && resume && visible && scenePhase == .active && player.currentItem === item { player.play() }
            }
        }
    }
    private func synchronize() {
        guard visible else { return }
        let playing = player.rate > 0
        if playing != isPlaying {
            isPlaying = playing
            if playing { revealControls() } else { chromeVisible = true }
        }
        failed = player.currentItem?.status == .failed
        buffering = player.timeControlStatus == .waitingToPlayAtSpecifiedRate
        let length = player.currentItem?.duration.seconds ?? 0
        if length.isFinite && length > 0 { duration = length }
        guard !scrubbing && !seeking else { return }
        let time = player.currentTime().seconds
        guard time.isFinite else { return }
        currentTime = time
        if let index = LessonVideoChapterSelection.index(at: time, chapters: chapters, original: original) { selected = index }
    }
    private func revealControls() {
        chromeVisible = true
        let generation = UUID()
        chromeGeneration = generation
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            if generation == chromeGeneration && visible && player.rate > 0 && !scrubbing { chromeVisible = false }
        }
    }
    private func timeLabel(_ seconds: Double) -> String {
        let value = seconds.isFinite ? max(0, Int(seconds)) : 0
        return String(format: "%d:%02d", value / 60, value % 60)
    }
    private func requestOrientation(_ orientations: UIInterfaceOrientationMask) {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: orientations))
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
