import SwiftUI
import Combine

import PhotosUI
import AVKit
import UniformTypeIdentifiers

struct LessonVideoScreen: View {
    var student: CoachStudentRow? = nil
    /// The player's own coaches. Non-nil means the PLAYER is importing a
    /// lesson they had, rather than a coach importing one they gave: the
    /// picker names coaches, the create call carries coachRefId, and the
    /// list shows only the player's own lessons. Same upload either way,
    /// because that is the part nobody wants written twice.
    var coaches: [PlayerCoach]? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(AppState.self) private var app
    @Environment(CoachWorkspaceStore.self) private var workspace
    @State private var queue = LessonVideoQueue.shared
    @State private var studentId: UUID?
    @State private var coachRefId: UUID?
    @State private var importCoachRef: UUID?
    @State private var videos: [LessonVideo] = []
    @State private var photosOpen = false
    @State private var filesOpen = false
    @State private var importing = false
    @State private var importOwner: UUID?
    @State private var importStudent: UUID?
    @State private var error: String?
    @State private var loading = true

    private var playerImport: Bool { coaches != nil }

    private var uploads: [QueuedLessonVideo] {
        queue.items.filter {
            guard $0.ownerId == app.userId, $0.state != "done" else { return false }
            // A player's page never shows a coach's imports, and a coach's
            // never shows the player's own. One account can have both.
            if playerImport { return $0.studentId == nil }
            return LessonVideoScope(studentId: student?.id).includes(studentId: $0.studentId)
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
                        Text(
                            AllowanceLimit.isStorage(error)
                                ? "There isn't enough storage to import this lesson."
                                : error
                        )
                        .font(.plBody)
                        .foregroundStyle(PL.dangerText)
                        // A refusal that only says no leaves the player
                        // stuck: in beta the storage is theirs to ask for,
                        // so the way out sits with the refusal.
                        if AllowanceLimit.isStorage(error) {
                            AllowanceRecoveryView(
                                resource: "storage", retryLabel: "Try again"
                            ) {
                                await queue.resume()
                                await refresh()
                            }
                        }
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
                    if let coaches {
                        Button("No coach") { coachRefId = nil }
                        ForEach(coaches) { row in
                            Button(row.displayName) { coachRefId = row.id }
                        }
                    } else {
                        Button("Private lesson") { studentId = nil }
                        ForEach(workspace.activeStudents) { row in
                            Button(row.displayName) { studentId = row.id }
                        }
                    }
                } label: {
                    HStack(spacing: 12) {
                        Text(playerImport ? "Who taught it?" : "Student")
                            .foregroundStyle(PL.text400)
                        Spacer(minLength: 12)
                        Text(chosenName)
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
                            LessonVideoDetailScreen(id: video.id, studentName: studentName(video))
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

    /// Whoever the lesson is with, in the picker's own words.
    private var chosenName: String {
        if let coaches {
            return coaches.first { $0.id == coachRefId }?.displayName ?? "No coach"
        }
        return workspace.activeStudents.first { $0.id == studentId }?.displayName
            ?? "Private lesson"
    }
    private func studentName(_ video: LessonVideo) -> String? {
        video.student_id.flatMap { workspace.student($0)?.displayName }
    }
    private func beginImport() {
        importOwner = app.userId
        importStudent = playerImport ? nil : studentId
        importCoachRef = playerImport ? coachRefId : nil
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
                    try await queue.enqueue(
                        copy: file.url, originalName: file.name, ownerId: owner,
                        studentId: importStudent, coachRefId: importCoachRef
                    )
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
            videos = playerImport
                ? response.videos.filter { $0.student_id == nil }
                : response.videos
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

/// One lesson video: the recap to watch, its chapters, and what the coach
/// can do with it. The same pieces as the web page, in the same order a
/// phone shows them there: recap, actions, chapters, manage.
///
/// The chapters are listed on the screen itself, not only inside the
/// player: a coach checking a recap wants to see what is in it before
/// pressing play, and a student coming back for one point wants to land
/// on that point. Tapping a chapter opens playback there.
///
/// "Manage" replaces the More menu: the same actions, as rows in a card,
/// which is how every other coach screen offers its secondary actions.
struct LessonVideoDetailScreen: View {
    let id: UUID
    /// Who the lesson is for, when the opening screen knows. A recap opened
    /// from a notification or a journal entry does not, and says "your
    /// student" instead.
    var studentName: String? = nil
    /// The coach a PLAYER recorded the lesson with, when the opening screen
    /// knows. A recap has one side or the other, never both.
    var coachName: String? = nil
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

    /// What the player is open on, or nil while it is closed. The player is
    /// presented from this item rather than from a flag beside a chapter
    /// number: presented from a flag, the cover read the chapter as nil the
    /// first time it opened, and a tap on a chapter row played from the start.
    @State private var watchRequest: WatchRequest?
    @State private var notesOpen = false
    @State private var deleteOpen = false

    private struct WatchRequest: Identifiable {
        let id = UUID()
        /// The original recording rather than the recap.
        let original: Bool
        /// Start at this chapter; nil resumes where the video was.
        let chapter: Int?
    }
    private var watchOpen: Bool { watchRequest != nil }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Button { dismiss() } label: { Label("Back", systemImage: "chevron.left") }
                    .buttonStyle(PLSecondaryButtonStyle())
                if let detail {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(detail.video.title).font(.plPageTitle).tracking(-0.6).foregroundStyle(PL.textBody)
                        Text(detail.video.statusLabel).font(.plCaption).foregroundStyle(PL.cyan)
                    }
                    if watchable(detail) { recap(detail) } else { waiting(detail) }
                    actions(detail)
                    if let edit = detail.video.edit, !edit.chapters.isEmpty {
                        chapters(edit, enabled: watchable(detail))
                    }
                    manage(detail)
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
        .fullScreenCover(item: $watchRequest, onDismiss: { player?.pause() }) { request in
            if let player, player.currentItem != nil, let detail {
                LessonVideoTakeover(player: player, title: detail.video.title,
                    chapters: detail.video.edit?.chapters ?? [], original: request.original,
                    initialChapter: request.chapter,
                    refresh: { await load(refreshPlayback: true) },
                    renewIfNeeded: {
                        if LessonVideoPlaybackRefresh.isDue(lastRefresh: playerURLFetchedAt) { await load(refreshPlayback: true) }
                    })
            }
        }
        .fullScreenCover(isPresented: $notesOpen) {
            if let edit = detail?.video.edit { LessonVideoNotesReader(edit: edit) }
        }
        .sheet(isPresented: $editOpen) {
            if let edit = detail?.video.edit {
                LessonVideoEditSheet(id: id, expectedRevision: detail?.video.revision, edit: edit) { await load() }
            }
        }
    }

    private func watchable(_ detail: LessonVideoDetail) -> Bool {
        detail.playbackUrl != nil || detail.summaryUrl != nil
    }

    /// The poster, and the two numbers the recap is made of.
    private func recap(_ detail: LessonVideoDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Button { watch() } label: {
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
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Watch lesson recap")
            if let edit = detail.video.edit, !edit.chapters.isEmpty {
                HStack {
                    Text(edit.chapters.count == 1 ? "1 chapter" : "\(edit.chapters.count) chapters")
                    Spacer()
                    Text("\(edit.recapMinutes) min recap")
                }
                .font(.plBody).foregroundStyle(PL.text400)
            }
        }
    }

    /// Stands where the poster will be until the recap exists.
    private func waiting(_ detail: LessonVideoDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(detail.video.status == "failed" ? "The recap needs another try" : (detail.video.stage ?? "Waiting for the upload"))
                .font(.plCardTitle).foregroundStyle(PL.text100)
            Text(detail.video.error ?? "Your lesson will be here when it is ready.")
                .font(.plBody).foregroundStyle(PL.text400).lineSpacing(4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
    }

    /// What can be done with the recap right now: share it, retry it, read it.
    @ViewBuilder
    private func actions(_ detail: LessonVideoDetail) -> some View {
        let video = detail.video
        // Older servers do not say; until they do, ready-with-somebody
        // means shared.
        let shared = video.shared ?? (video.status == "ready" && video.hasRecipient)
        let canShare = video.canShare(isOwner: detail.isOwner)
        let canRetry = detail.isOwner && video.status == "failed"
        let hasNotes = video.edit?.chapters.isEmpty == false
        // A coach made it FOR a student; a player made it WITH a coach.
        // Same recap, opposite halves of the relationship, and this screen
        // used to know only one of them.
        let forStudent = video.student_id != nil
        let withCoach = video.coach_ref_id != nil
        let other = forStudent
            ? (studentName ?? "your student")
            : (coachName ?? "your coach")
        let sharedWith = (detail.isOwner && shared && video.hasRecipient)
        if canShare || canRetry || hasNotes || sharedWith || !detail.isOwner {
            VStack(alignment: .leading, spacing: 12) {
                if canShare {
                    Button { perform("share", share: withCoach ? true : nil) } label: {
                        Text(
                            busy
                                ? "Saving…"
                                : forStudent
                                    ? "Share with student"
                                    : withCoach ? "Share with \(other)" : "Save recap"
                        )
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PLPrimaryButtonStyle()).disabled(busy)
                }
                // Sharing is asked every time and never assumed: a player
                // who wants the recap in their own journal and nowhere
                // else says so here, rather than finding out later that
                // pressing the one button sent it.
                if canShare && withCoach {
                    Button { perform("share", share: false) } label: {
                        Text("Keep it to myself").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PLSecondaryButtonStyle()).disabled(busy)
                }
                if detail.isOwner && withCoach && shared && video.status == "ready" {
                    Button { perform("unshare") } label: {
                        Text("Stop sharing").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PLSecondaryButtonStyle()).disabled(busy)
                }
                if canRetry {
                    Button { perform("retry") } label: { Text("Retry processing").frame(maxWidth: .infinity) }
                        .buttonStyle(PLSecondaryButtonStyle()).disabled(busy)
                }
                if sharedWith && forStudent {
                    Text("Shared with \(other). It is in their journal, and any edit you make here goes to them once you share it again.")
                        .font(.plBody).foregroundStyle(PL.text400).lineSpacing(4)
                }
                if sharedWith && withCoach {
                    Text("\(other) can read this recap. Stop sharing takes it back.")
                        .font(.plBody).foregroundStyle(PL.text400).lineSpacing(4)
                }
                if !detail.isOwner {
                    Text("Shared with you.").font(.plBody).foregroundStyle(PL.text400)
                }
                if hasNotes {
                    Button { notesOpen = true } label: { Text("Read lesson notes").frame(maxWidth: .infinity) }
                        .buttonStyle(PLSecondaryButtonStyle())
                }
            }
            .frame(maxWidth: .infinity)
            .plCard(padding: 16)
        }
    }

    /// Every chapter, numbered and timed, each a way into the player.
    private func chapters(_ edit: LessonVideoEdit, enabled: Bool) -> some View {
        CoachGroup("Chapters") {
            ForEach(Array(edit.chapters.enumerated()), id: \.offset) { index, chapter in
                Button { watch(from: index) } label: {
                    HStack(spacing: 14) {
                        Text("\(index + 1)")
                            .font(.plCaption.weight(.semibold)).foregroundStyle(PL.text400)
                            .frame(width: 28, height: 28)
                            .background(PL.surface2, in: Circle())
                        Text(chapter.title)
                            .font(.plBody.weight(.medium)).foregroundStyle(PL.text100)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(LessonVideoLength.label(seconds: chapter.end_s - chapter.start_s))
                            .font(.plCaption).monospacedDigit().foregroundStyle(PL.text500)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!enabled)
                .opacity(enabled ? 1 : 0.6)
                .accessibilityLabel("Chapter \(index + 1), \(chapter.title)")
                .accessibilityHint("Plays the recap from this chapter")
                if index < edit.chapters.count - 1 { CoachRowDivider() }
            }
        }
    }

    private enum ManageRow: Hashable {
        case edit, watchOriginal, exportSummary(URL), exportOriginal(URL), delete
    }

    private func manageRows(_ detail: LessonVideoDetail) -> [ManageRow] {
        let video = detail.video
        var rows: [ManageRow] = []
        if detail.isOwner, video.edit != nil, ["review", "ready", "failed"].contains(video.status) { rows.append(.edit) }
        let originalURL = detail.isOwner ? (detail.sourceUrl ?? detail.originalUrl).flatMap(URL.init(string:)) : nil
        if originalURL != nil { rows.append(.watchOriginal) }
        if let url = detail.summaryUrl.flatMap(URL.init(string:)) { rows.append(.exportSummary(url)) }
        if let originalURL { rows.append(.exportOriginal(originalURL)) }
        if detail.isOwner, !video.needsRefresh { rows.append(.delete) }
        return rows
    }

    @ViewBuilder
    private func manage(_ detail: LessonVideoDetail) -> some View {
        let rows = manageRows(detail)
        if !rows.isEmpty {
            CoachGroup("Manage") {
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    manageRow(row)
                    if index < rows.count - 1 { CoachRowDivider() }
                }
            }
        }
    }

    @ViewBuilder
    private func manageRow(_ row: ManageRow) -> some View {
        switch row {
        case .edit:
            CoachNavRow(label: "Edit recap") { editOpen = true }.disabled(busy)
        case .watchOriginal:
            CoachNavRow(label: "Watch original recording") { watchOriginal() }
        case .exportSummary(let url):
            exportRow("Export video with text", url: url)
        case .exportOriginal(let url):
            exportRow("Export original video", url: url)
        case .delete:
            CoachNavRow(label: "Delete lesson video", tint: PL.dangerText) { deleteOpen = true }.disabled(busy)
        }
    }

    /// A Manage row that hands the file to the share sheet rather than
    /// opening a screen, so it carries the share glyph where the others
    /// carry a chevron.
    private func exportRow(_ label: String, url: URL) -> some View {
        ShareLink(item: url) {
            HStack(spacing: 12) {
                Text(label).font(.system(size: 16)).foregroundStyle(PL.textBody)
                Spacer()
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(PL.text500)
            }
            .padding(.horizontal, 16).padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// Open the player on the recap, at a chapter when one was tapped.
    private func watch(from index: Int? = nil) {
        if original { original = false; setPlayer() }
        watchRequest = WatchRequest(original: false, chapter: index)
    }
    private func watchOriginal() {
        original = true
        setPlayer()
        watchRequest = WatchRequest(original: true, chapter: nil)
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
    private func perform(_ action: String, share: Bool? = nil) {
        busy = true
        Task {
            defer { busy = false }
            do {
                let _: LessonVideoOK = try await API.post(
                    "api/lesson-video",
                    LessonVideoAction(action: action, id: id, share: share)
                )
                if action == "delete" { dismiss() } else { await load() }
            } catch { self.error = error.localizedDescription }
        }
    }
}

private struct LessonVideoNotesReader: View {
    let edit: LessonVideoEdit
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("Lesson notes").font(.plPageTitle).foregroundStyle(PL.text100)
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.plCardTitle).frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close lesson notes")
                }
                Text(edit.title)
                    .font(.plPageTitle).tracking(-0.6).foregroundStyle(PL.textBody)
                    .padding(.top, 24)
                ForEach(Array(edit.chapters.enumerated()), id: \.offset) { index, chapter in
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Chapter \(index + 1)")
                            .font(.plCaption).textCase(.uppercase).foregroundStyle(PL.cyan)
                        Text(chapter.title).font(.plCardTitle).foregroundStyle(PL.text100)
                        ForEach(Array(chapter.cues.enumerated()), id: \.offset) { _, cue in
                            Text(cue).font(.plBody).foregroundStyle(PL.text300).lineSpacing(4)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 24)
                    if index < edit.chapters.count - 1 { Divider().overlay(PL.edge) }
                }
            }
            .padding(20).padding(.bottom, 36)
        }
        .background { ArenaBackground() }
        .preferredColorScheme(.dark)
    }
}

/// Watch-style presentation: footage and synchronized notes stay together in both orientations.
private struct LessonVideoTakeover: View {
    let player: AVPlayer
    let title: String
    let chapters: [LessonVideoEdit.Chapter]
    let original: Bool
    /// Start here when opened from a chapter row; nil resumes.
    let initialChapter: Int?
    let refresh: () async -> Void
    let renewIfNeeded: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var selected: Int
    /// A chapter start still to be applied, when the player was asked to
    /// open at a chapter before its video was ready to seek.
    @State private var pendingStart: Double?
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
    @State private var indexOpen = false
    @State private var muted = false
    private let tick = Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()

    init(player: AVPlayer, title: String, chapters: [LessonVideoEdit.Chapter], original: Bool,
         initialChapter: Int? = nil, refresh: @escaping () async -> Void, renewIfNeeded: @escaping () async -> Void) {
        self.player = player
        self.title = title
        self.chapters = chapters
        self.original = original
        self.initialChapter = initialChapter
        self.refresh = refresh
        self.renewIfNeeded = renewIfNeeded
        // The cue pages open on the chapter being started, so the pager is
        // never asked to jump on appearance. Jumping it there made the page
        // style snap back to the first page and write that back through the
        // selection binding, which seeked the video to the start and undid
        // the chapter the row had asked for.
        let start = initialChapter.flatMap { chapters.indices.contains($0) ? $0 : nil } ?? 0
        _selected = State(initialValue: start)
    }

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
            let session = AVAudioSession.sharedInstance()
            try? session.setCategory(.playback, mode: .moviePlayback)
            try? session.setActive(true)
            muted = false
            player.isMuted = muted
            if let initialChapter, chapters.indices.contains(initialChapter) {
                // Opened from a chapter row: start there, not where the
                // last viewing stopped. The seek goes first so the tick
                // cannot read the old position back into the page selection
                // before the video has moved.
                startChapter(initialChapter)
                synchronize()
                return
            }
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
        .sheet(isPresented: $indexOpen) {
            LessonVideoChapterIndex(chapters: chapters, selected: selected) { index in
                indexOpen = false
                selectChapter(index)
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
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
                HStack {
                    Spacer()
                    Button {
                        muted.toggle()
                        player.isMuted = muted
                    } label: {
                        // Drawn small, hit large. A 44pt disc over the picture
                        // read as a control the size of the play button; the
                        // speaker is a secondary toggle and looks like one at
                        // 30pt, while the tap target stays the full 44pt.
                        Image(systemName: muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                            .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                            .frame(width: 30, height: 30).background(.black.opacity(0.55), in: Circle())
                            .frame(width: 44, height: 44).contentShape(Rectangle())
                    }
                    .accessibilityLabel(muted ? "Turn on lesson audio" : "Mute lesson audio")
                }.padding(8)
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
                    Button {
                        player.pause()
                        indexOpen = true
                    } label: {
                        Text("Chapter \(selected + 1) of \(chapters.count)")
                            .font(.plButton).foregroundStyle(PL.cyan).underline()
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open chapter index")
                    Spacer()
                    Button { selectChapter(min(chapters.count - 1, selected + 1)) } label: {
                        Image(systemName: "chevron.right").frame(width: 44, height: 44)
                    }.disabled(selected == chapters.count - 1).accessibilityLabel("Next chapter")
                }.foregroundStyle(PL.text100).padding(.horizontal, 8).padding(.top, 8)
                // Only user-driven page writes seek. Playback-driven selection assigns
                // `selected` directly, so an automatic cue transition cannot seek back.
                // A write of the page already showing is the pager settling, not a
                // swipe, and must not restart the chapter.
                TabView(selection: Binding(get: { selected }, set: { if $0 != selected { selectChapter($0) } })) {
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
        guard chapters.indices.contains(index) else { return }
        selected = index
        if let start = LessonVideoChapterSelection.start(at: index, chapters: chapters, original: original) {
            seek(to: start, resume: true)
        }
    }
    /// Open on a chapter. The seek is issued at once when the video can take
    /// it, and otherwise held until the tick sees the item ready, so a tap
    /// on a chapter row lands there rather than wherever the video began.
    private func startChapter(_ index: Int) {
        guard let start = LessonVideoChapterSelection.start(at: index, chapters: chapters, original: original) else {
            player.play()
            return
        }
        selected = index
        currentTime = start
        if player.currentItem?.status == .readyToPlay {
            pendingStart = nil
            seek(to: start, resume: true)
        } else {
            pendingStart = start
        }
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
        if let pendingStart {
            // Still waiting to open at a chapter: keep the page and the
            // slider on it, and seek the moment the video is ready.
            guard player.currentItem?.status == .readyToPlay else { return }
            self.pendingStart = nil
            seek(to: pendingStart, resume: true)
            return
        }
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

private struct LessonVideoChapterIndex: View {
    let chapters: [LessonVideoEdit.Chapter]
    let selected: Int
    let onSelect: (Int) -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(Array(chapters.enumerated()), id: \.offset) { index, chapter in
                        Button { onSelect(index) } label: {
                            HStack(spacing: 14) {
                                Text("\(index + 1)")
                                    .font(.plButton)
                                    .foregroundStyle(index == selected ? PL.ink : PL.text400)
                                    .frame(width: 34, height: 34)
                                    .background(index == selected ? PL.cyan : PL.surface2, in: Circle())
                                Text(chapter.title).font(.plBody.weight(.medium)).foregroundStyle(PL.text100)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                if index == selected {
                                    Image(systemName: "checkmark").foregroundStyle(PL.cyan)
                                        .accessibilityLabel("Current chapter")
                                }
                            }
                            .padding(.horizontal, 16).padding(.vertical, 12).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if index < chapters.count - 1 { Divider().overlay(PL.edge).padding(.leading, 64) }
                    }
                }.padding(.vertical, 8)
            }
            .background { ArenaBackground() }
            .navigationTitle("Chapters")
            .navigationBarTitleDisplayMode(.inline)
            .preferredColorScheme(.dark)
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
