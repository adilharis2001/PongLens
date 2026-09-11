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
    @Environment(JournalStore.self) private var journal
    @State private var queue = LessonVideoQueue.shared
    @State private var studentId: UUID?
    @State private var coachRefId: UUID?
    /// "No coach" as an answer given, held apart from coachRefId because
    /// nil alone cannot tell "not asked yet" from "asked, and nobody".
    /// Three lessons in one day were filed against nobody because the
    /// old menu started on "No coach" and looked answered.
    @State private var noCoach = false
    @State private var importCoachRef: UUID?
    @State private var videos: [LessonVideo] = []
    @State private var photosOpen = false
    @State private var filesOpen = false
    @State private var importing = false
    @State private var importOwner: UUID?
    @State private var importStudent: UUID?
    @State private var error: String?
    @State private var loading = true
    /// The one-time walk, in front of the import controls.
    @State private var briefOpen = false

    private var playerImport: Bool { coaches != nil }

    /// Which door this is, and therefore which brief belongs in front of
    /// the import controls.
    private var briefAudience: LessonBriefGate.Kind {
        playerImport ? .videoPlayer : .videoCoach
    }

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
            // Pull to refresh reads the list. It does NOT wait for the
            // upload: `resume()` can spend minutes pushing parts, and
            // awaiting it here held the spinner open the whole time and
            // then let SwiftUI cancel the list read when the control
            // retracted — which is how a pull to refresh came back saying
            // "cancelled" while the upload underneath was fine.
            .refreshable {
                Task { await queue.resume() }
                await refresh(asked: true)
            }
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
            // The brief, once, in front of the import controls. Each door
            // gets its own: a coach is sending the recap to a student, a
            // player is keeping it, and the last page is about exactly
            // that. Decided after the first refresh, so somebody who has
            // imported through THIS door before is not interrupted —
            // counted by which side the row names, because a private
            // import names neither and cannot speak for either door.
            .task {
                studentId = student?.id
                await queue.resume()
                await refresh()
                briefOpen = LessonBriefFirstRun.shouldShow(
                    briefAudience,
                    app: app,
                    hasDoneBefore: playerImport
                        ? videos.contains { $0.coach_ref_id != nil }
                        : videos.contains { $0.student_id != nil }
                )
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(10)) } catch { return }
                    if videos.contains(where: \.needsRefresh) || !uploads.isEmpty { await refresh() }
                }
            }
            .fullScreenCover(isPresented: $briefOpen) {
                LessonVideoBriefSheet(audience: briefAudience) {
                    LessonBriefFirstRun.markDone(briefAudience, app: app)
                    briefOpen = false
                }
                .interactiveDismissDisabled()
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
                if playerImport {
                    // The same "Who taught it?" the journal and the recorder
                    // use, so there is one place this question is asked and
                    // one idea of what an answer is. It starts on "Choose",
                    // and the import buttons below stay off until it is
                    // answered, because a picker that starts on "No coach"
                    // looks answered and is not.
                    CoachPickerRow(
                        coaches: journal.playerCoaches,
                        coachRefId: $coachRefId,
                        shareWithCoach: .constant(false),
                        noCoach: $noCoach,
                        requireAnswer: true,
                        shareNoun: "this recap",
                        showShare: false,
                        onCreate: { await journal.createCoach(named: $0) },
                        onAppearReload: { await journal.loadCoaches() }
                    )
                    .padding(16)
                    .disabled(importing)
                } else {
                Menu {
                    Button("Private lesson") { studentId = nil }
                    ForEach(workspace.activeStudents) { row in
                        Button(row.displayName) { studentId = row.id }
                    }
                } label: {
                    HStack(spacing: 12) {
                        Text("Student")
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
                    .disabled(importing || !answered)
                    Button { beginImport(); filesOpen = true } label: {
                        Label("Files", systemImage: "folder")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                    .disabled(importing || !answered)
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
                        Button("Resume upload") { Task { await queue.retry(item.id); await refresh(asked: true) } }
                            .buttonStyle(PLSecondaryButtonStyle())
                        // An upload that cannot finish needs a way out.
                        // Resume was the only control, so a dead upload sat
                        // in this list with nothing but a button that failed.
                        Button("Discard this upload") { queue.discard(item.id); Task { await refresh(asked: true) } }
                            .buttonStyle(PLSoftDestructiveButtonStyle())
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
                                    Text(video.statusLabel(hasRecap: video.edit != nil)).font(.plCaption).foregroundStyle(PL.text400)
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

    /// Whether "who taught it?" has been answered. A coach's import names
    /// a student or is private by choice, and has always been answered.
    private var answered: Bool {
        !playerImport || coachRefId != nil || noCoach
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
        case .failure(let failure): importing = false; error = UserFacingError.message(failure)
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
                    self.error = UserFacingError.message(error)
                }
            }
        }
    }
    /// Re-read the list.
    ///
    /// `asked` is whether a PERSON asked for it. This runs every ten
    /// seconds while an upload is in flight, again whenever the app comes
    /// back to the front, and again after a video is queued — and a poll
    /// that fails is not news. It used to write whatever it caught
    /// straight onto the screen, so a request that was merely cancelled,
    /// because the view went away or the app was backgrounded mid-flight,
    /// painted a red word over a page whose upload was going along fine.
    /// Adil saw "cancelled" sitting above an upload at 23%.
    ///
    /// A poll that fails now leaves the last good list alone and says
    /// nothing. Pull to refresh still reports, because somebody asked.
    /// The upload itself reports through the queue, which is the thing
    /// that would actually be lost.
    private func refresh(asked: Bool = false) async {
        do {
            let response: LessonVideoList = try await API.get("api/lesson-video", query: LessonVideoScope(studentId: student?.id).query)
            videos = playerImport
                ? response.videos.filter { $0.student_id == nil }
                : response.videos
            error = nil
        } catch {
            if asked { self.error = UserFacingError.message(error) }
        }
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
    @Environment(JournalStore.self) private var journal
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
    @State private var shareLinkOpen = false
    @State private var exportOpen = false
    /// Who the recap says taught the lesson. Mirrors the row so the
    /// picker can show an answer before the write comes back.
    @State private var coachRefId: UUID?
    @State private var noCoach = false

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
                        Text(detail.video.statusLabel(hasRecap: watchable(detail))).font(.plCaption).foregroundStyle(PL.cyan)
                    }
                    if watchable(detail) {
                        recap(detail)
                        if rebuilding(detail) { updating(detail.video) }
                    } else {
                        waiting(detail)
                    }
                    attribution(detail)
                    actions(detail)
                    if let edit = detail.video.edit {
                        // The two cards bracket the clips here the way
                        // they bracket them in the video. A lesson that
                        // stated neither shows neither.
                        focusList("Lesson goals", edit.goals ?? [])
                        if !edit.chapters.isEmpty {
                            chapters(edit, enabled: watchable(detail))
                        }
                        focusList("Things to work on", edit.work_on ?? [])
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
                // The file with the words in it is built long after the
                // recap is watchable, so the page waits on that too. Same
                // ten seconds, same loop.
                if !watchOpen && (detail?.needsRefresh == true || renewPlayback) {
                    await load(refreshPlayback: renewPlayback)
                }
            }
        }
        .confirmationDialog(cancellingUpload ? "Cancel this upload?" : "Delete this lesson video?",
                            isPresented: $deleteOpen, titleVisibility: .visible) {
            Button(cancellingUpload ? "Cancel the upload" : "Delete lesson video", role: .destructive) { cancelOrDelete() }
        } message: {
            Text(cancellingUpload
                 ? "The part of the video that has been sent so far will be thrown away. The video on your phone is untouched, and you can import it again."
                 : "The original video and recap will be permanently deleted.")
        }
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
        .sheet(isPresented: $shareLinkOpen) {
            LessonRecapLinkSheet(id: id, existing: detail?.link) { await load() }
        }
        .sheet(isPresented: $exportOpen) {
            // Read from the page's own copy, so the ten-second poll moves
            // the sheet from "Preparing" to "Ready" while it is open.
            if let detail {
                LessonRecapExportSheet(
                    id: id,
                    file: detail.file,
                    showFile: watchable(detail),
                    // The file is cut from the finished recap, so the
                    // database refuses to start one while the recap is
                    // being made again. A button that can only come back
                    // with an error is worse than no button.
                    canPrepare: detail.isOwner && watchable(detail)
                        && ["review", "ready"].contains(detail.video.status),
                    prepareWaiting: detail.isOwner && rebuilding(detail),
                    originalURL: originalURL(detail)
                ) { await load() }
            }
        }
    }

    private func watchable(_ detail: LessonVideoDetail) -> Bool {
        detail.playbackUrl != nil || detail.summaryUrl != nil
    }

    /// The lesson is still being sent up, so the destructive control is
    /// abandoning an upload rather than deleting a finished recap.
    private var cancellingUpload: Bool { detail?.video.status == "uploading" }

    /// Cancel or delete, and take the phone's own copy of the upload with
    /// it. Without that the queue keeps pushing parts at an upload the
    /// server has already thrown away, and the coach is left with a failed
    /// row instead of a stuck one.
    private func cancelOrDelete() {
        let wasUploading = cancellingUpload
        perform("delete")
        if wasUploading { Task { await LessonVideoQueue.shared.cancel(videoId: id) } }
    }

    /// A new recap is being made over one that can already be watched: an
    /// edit was saved and the worker is rendering it. The first import is
    /// not this; it has nothing to watch yet and shows `waiting` instead.
    private func rebuilding(_ detail: LessonVideoDetail) -> Bool {
        detail.video.isProcessing && watchable(detail)
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

    /// Under the poster while a saved edit is being rendered. The old recap
    /// stays playable above it, so this says what the worker is doing now
    /// rather than standing in for the video: the stage line is the same
    /// one the worker writes every few seconds, and the screen already
    /// polls it every ten seconds while the row needs refreshing.
    private func updating(_ video: LessonVideo) -> some View {
        let stage = video.stage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return VStack(alignment: .leading, spacing: 8) {
            Text("Updating your recap").font(.plCardTitle).foregroundStyle(PL.text100)
            Text(video.status == "processing" && !stage.isEmpty ? stage : "Waiting to start")
                .font(.plBody).foregroundStyle(PL.text300)
            Text("Your current recap stays until the new one is ready. This usually takes 15 to 20 minutes.")
                .font(.plCaption).foregroundStyle(PL.text400).lineSpacing(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
    }

    /// Who taught the lesson, answered or corrected after the import.
    ///
    /// The importer asks, but nobody is a real answer and an unanswered
    /// picker looks exactly like one, so a lesson could be filed against
    /// no coach with no way back: nothing set it afterwards, and a recap
    /// naming nobody can never be shared, which left this page reading
    /// "Saved" beside no controls at all. Same control the journal and
    /// the recorder use, so there is one place this question is asked.
    @ViewBuilder
    private func attribution(_ detail: LessonVideoDetail) -> some View {
        if LessonVideo.canSetCoach(detail.video, isOwner: detail.isOwner) {
            CoachGroup {
                // The share switch IS the share control. It used to be bound
                // to a constant, sitting above a second card of Share, Keep
                // it to myself and Stop sharing buttons: two answers to one
                // question, and the switch was a fake. Now the switch is the
                // whole of it, and it is shown once the recap is saved, which
                // is when there is something to share.
                CoachPickerRow(
                    coaches: journal.playerCoaches,
                    coachRefId: Binding(get: { coachRefId }, set: { setCoach($0) }),
                    shareWithCoach: Binding(get: { detail.sharedNow }, set: { setShared($0) }),
                    noCoach: Binding(get: { noCoach }, set: { if $0 { setCoach(nil) } }),
                    requireAnswer: true,
                    shareNoun: "this recap",
                    showShare: detail.video.status == "ready",
                    onCreate: { await journal.createCoach(named: $0) },
                    onAppearReload: { await journal.loadCoaches() }
                )
                .padding(16)
                .disabled(busy)
            }
        }
    }

    /// What can be done with the recap right now: share it, retry it, read it.
    @ViewBuilder
    private func actions(_ detail: LessonVideoDetail) -> some View {
        let video = detail.video
        let shared = detail.sharedNow
        // A player's sharing lives on the switch above, beside who taught
        // it. Only a coach's import, made FOR a student, keeps the button:
        // they review it before it goes anywhere.
        let canShare = video.student_id != nil && video.canShare(isOwner: detail.isOwner)
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
        let sharedWith = (detail.isOwner && shared && video.student_id != nil)
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
                if canRetry {
                    Button { perform("retry") } label: { Text("Retry processing").frame(maxWidth: .infinity) }
                        .buttonStyle(PLSecondaryButtonStyle()).disabled(busy)
                }
                if sharedWith && forStudent {
                    Text("Shared with \(other). It is in their journal, and any edit you make here goes to them once you share it again.")
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

    /// What the lesson set out to do, or what to practise next: the same
    /// grouped card the chapters sit in, reading as words rather than as
    /// rows anybody can press. An empty list draws nothing at all, not a
    /// heading over a blank card.
    @ViewBuilder
    private func focusList(_ title: String, _ lines: [String]) -> some View {
        if !lines.isEmpty {
            CoachGroup(title) {
                ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                    Text(line)
                        .font(.plBody).foregroundStyle(PL.text100)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16).padding(.vertical, 12)
                    if index < lines.count - 1 { CoachRowDivider() }
                }
            }
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
        case edit, shareLink, export, watchOriginal, delete
    }

    /// The original recording, for the owner. Sharing a recap never hands
    /// over the ninety minutes it was cut from.
    private func originalURL(_ detail: LessonVideoDetail) -> URL? {
        detail.isOwner ? (detail.sourceUrl ?? detail.originalUrl).flatMap(URL.init(string:)) : nil
    }

    private func manageRows(_ detail: LessonVideoDetail) -> [ManageRow] {
        let video = detail.video
        var rows: [ManageRow] = []
        // While a saved edit is being rendered the row stays, disabled:
        // a row that vanishes reads as the menu going missing, and the
        // caption under the list says when it comes back.
        if detail.isOwner, video.edit != nil,
           ["review", "ready", "failed"].contains(video.status) || rebuilding(detail) { rows.append(.edit) }
        // A public link is the owner's to hand out, and there is nothing
        // worth handing out until there is a recap to watch.
        if detail.isOwner, watchable(detail) { rows.append(.shareLink) }
        // Export is where the file with the words in it is asked for, so
        // the owner reaches it as soon as there is a recap or a recording
        // to save. Anybody else sees it only when a file already exists.
        let hasFile = detail.file?.downloadURL != nil
        if detail.isOwner ? (watchable(detail) || originalURL(detail) != nil) : hasFile { rows.append(.export) }
        if originalURL(detail) != nil { rows.append(.watchOriginal) }
        // An upload has no worker behind it, so it is the owner's to
        // abandon. Refusing it left a coach whose 7 GB import stalled with a
        // lesson that said "Uploading" for two days and no way out.
        if detail.isOwner, !video.isProcessing { rows.append(.delete) }
        return rows
    }

    @ViewBuilder
    private func manage(_ detail: LessonVideoDetail) -> some View {
        let rows = manageRows(detail)
        let editLocked = rebuilding(detail)
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                CoachGroup("Manage") {
                    ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                        manageRow(row, detail: detail, editLocked: editLocked)
                        if index < rows.count - 1 { CoachRowDivider() }
                    }
                }
                if editLocked && rows.contains(.edit) {
                    Text("Editing is available when the update finishes.")
                        .font(.plCaption).foregroundStyle(PL.text400)
                }
            }
        }
    }

    @ViewBuilder
    private func manageRow(_ row: ManageRow, detail: LessonVideoDetail, editLocked: Bool) -> some View {
        switch row {
        case .edit:
            CoachNavRow(label: "Edit recap") { editOpen = true }
                .disabled(busy || editLocked)
                .opacity(editLocked ? 0.5 : 1)
        case .shareLink:
            CoachNavRow(
                label: "Share a link",
                detail: detail.link == nil ? "Not shared" : "1 link"
            ) { shareLinkOpen = true }
        case .export:
            CoachNavRow(label: "Export", detail: "Video files") { exportOpen = true }
        case .watchOriginal:
            CoachNavRow(label: "Watch original recording") { watchOriginal() }
        case .delete:
            CoachNavRow(label: cancellingUpload ? "Cancel this upload" : "Delete lesson video", tint: PL.dangerText) { deleteOpen = true }.disabled(busy)
        }
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
    /// Read the recap.
    ///
    /// This runs on a ten-second poll while the recap is still being made,
    /// and again whenever the app comes back to the front. A reload that
    /// fails when a recap is already on screen is not news: the screen is
    /// still correct, and writing a red word over it says the lesson is
    /// broken when nothing is. Only the FIRST read reports, because then
    /// there is nothing else to show and an empty page would be a lie.
    /// Same rule as `refresh()` above.
    private func load(refreshPlayback: Bool = false) async {
        let hadRecap = detail != nil
        do {
            let value: LessonVideoDetail = try await API.get("api/lesson-video", query: ["id": id.uuidString])
            // The player is rebuilt only when the file behind it is a
            // different one. Comparing the revision meant a coach who
            // corrected a word watched the recap reload under them.
            let changed = !LessonVideoMedia.sameTarget(detail?.playbackUrl, value.playbackUrl)
            var next = value
            if !changed, let keep = detail?.playbackUrl { next.playbackUrl = keep }
            if LessonVideoMedia.sameTarget(detail?.posterUrl, value.posterUrl), let keep = detail?.posterUrl { next.posterUrl = keep }
            detail = next
            await saveOnOpen(value)
            // The picker follows the row. "No coach" is only shown as an
            // answer once somebody has given it, so an unattributed recap
            // still reads as a question the first time it is opened.
            coachRefId = value.video.coach_ref_id
            if value.video.coach_ref_id != nil { noCoach = false }
            urlsFetchedAt = Date()
            error = nil
            if player == nil || changed || refreshPlayback {
                setPlayer(preservingPosition: !changed && player != nil)
            }
        } catch {
            if !hadRecap { self.error = UserFacingError.message(error) }
        }
    }
    /// The share switch. On is share, off is take it back.
    private func setShared(_ on: Bool) {
        if on { perform("share", share: true) } else { perform("unshare") }
    }

    /// A player's finished recap saves itself to their journal the first
    /// time they open it, unshared. Adil, 2026-09-07: "the prepared recap
    /// should just save to my profile, and that's it." There is no review
    /// step for a lesson somebody had, only for one a coach made for a
    /// student, and a Save recap button that had to be pressed before the
    /// share switch meant anything was the button that read as reprocessing.
    @State private var savedOnOpen = false
    private func saveOnOpen(_ detail: LessonVideoDetail) async {
        guard detail.isOwner, detail.video.student_id == nil,
              detail.video.status == "review", !savedOnOpen else { return }
        savedOnOpen = true
        do {
            let _: LessonVideoOK = try await API.post(
                "api/lesson-video", LessonVideoAction(action: "share", id: id, share: false)
            )
            await load()
        } catch { self.error = UserFacingError.message(error) }
    }

    /// Record who taught it, and keep the picker showing the answer while
    /// the write is in flight.
    private func setCoach(_ id: UUID?) {
        coachRefId = id
        noCoach = id == nil
        busy = true
        Task {
            defer { busy = false }
            do {
                let _: LessonVideoOK = try await API.post(
                    "api/lesson-video",
                    LessonVideoRecipient(id: self.id, coachRefId: id)
                )
                await load()
            } catch {
                self.error = UserFacingError.message(error)
                // Put the picker back on what the row actually says.
                coachRefId = detail?.video.coach_ref_id
                noCoach = false
            }
        }
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
            } catch { self.error = UserFacingError.message(error) }
        }
    }
}

/// The public link to a recap.
///
/// One link, or none. There is no title to set, no expiry to choose and
/// nothing to switch: the page a stranger opens shows the recap as it
/// currently reads, and stopping the link is what takes it away. POST
/// /api/share is idempotent, so asking again hands back the link that
/// already exists rather than minting a second one, which is also how the
/// sheet learns the id it needs to revoke a link the page arrived with.
private struct LessonRecapLinkSheet: View {
    let id: UUID
    /// The live link the recap page already knows about, if there is one.
    let existing: String?
    /// Reload the page behind, so the Manage row's "Not shared" catches up.
    let onChanged: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var link: URL?
    @State private var linkId: String?
    @State private var started = false
    @State private var creating = false
    @State private var revoking = false
    @State private var copied = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let link {
                        Text(link.absoluteString)
                            .font(.system(size: 13, design: .monospaced))
                            .foregroundStyle(PL.text300)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(PL.surface, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(PL.edge, lineWidth: 1))
                        Button { copy(link) } label: {
                            Text(copied ? "Copied" : "Copy link").frame(maxWidth: .infinity, minHeight: 28)
                        }
                        .buttonStyle(PLPrimaryButtonStyle())
                        ShareLink(item: link) {
                            Text("Share the link").frame(maxWidth: .infinity, minHeight: 28)
                        }
                        .buttonStyle(PLSecondaryButtonStyle())
                        Button { Task { await stopSharing() } } label: {
                            Text(revoking ? "Stopping…" : "Stop sharing").frame(maxWidth: .infinity, minHeight: 28)
                        }
                        .buttonStyle(PLSoftDestructiveButtonStyle())
                        .disabled(revoking)
                    } else {
                        Text("Anyone with the link can watch this recap. They do not need a PongLens account.")
                            .font(.plBody).foregroundStyle(PL.text400).lineSpacing(4)
                        Button { Task { await create() } } label: {
                            Text(creating ? "Creating…" : "Create a link").frame(maxWidth: .infinity, minHeight: 28)
                        }
                        .buttonStyle(PLPrimaryButtonStyle())
                        .disabled(creating)
                    }
                    if let errorMessage {
                        Text(errorMessage).font(.plCaption).foregroundStyle(PL.dangerText)
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(PL.ink)
            .navigationTitle("Share a link")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .preferredColorScheme(.dark)
        .task {
            // Only on the way in. After that the sheet's own state is the
            // truth, so a reload landing mid-revoke cannot put the link
            // back on screen.
            guard !started else { return }
            started = true
            link = existing.flatMap(URL.init(string:))
        }
    }

    private func copy(_ url: URL) {
        UIPasteboard.general.string = url.absoluteString
        copied = true
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
        }
    }

    private struct MintResponse: Decodable {
        let id: String
        let url: String
    }

    private func create() async {
        guard !creating else { return }
        creating = true
        errorMessage = nil
        defer { creating = false }
        struct Req: Encodable { let lessonVideoId: String }
        do {
            let res: MintResponse = try await API.post(
                "api/share", Req(lessonVideoId: id.uuidString.lowercased())
            )
            guard let url = URL(string: res.url) else {
                errorMessage = "Couldn't create the link. Try again."
                return
            }
            link = url
            linkId = res.id
            await onChanged()
        } catch {
            errorMessage = UserFacingError.message(error) ?? "Couldn't create the link. Try again."
        }
    }

    private func stopSharing() async {
        guard !revoking else { return }
        revoking = true
        errorMessage = nil
        defer { revoking = false }
        struct Req: Encodable { let lessonVideoId: String }
        struct RevokeReq: Encodable { let id: String }
        do {
            // The page arrives with the link's address and not its id, so
            // the id is asked for here. The mint is idempotent and returns
            // the link that already exists.
            let target: String
            if let linkId { target = linkId }
            else {
                let res: MintResponse = try await API.post(
                    "api/share", Req(lessonVideoId: id.uuidString.lowercased())
                )
                target = res.id
            }
            let _: LessonVideoOK = try await API.post("api/share/revoke", RevokeReq(id: target))
            link = nil
            linkId = nil
            copied = false
            await onChanged()
        } catch {
            errorMessage = UserFacingError.message(error) ?? "Couldn't stop sharing. Try again."
        }
    }
}

/// The two files a recap can hand somebody: the copy with the words in the
/// picture, and the recording it was made from.
///
/// The recap people watch in PongLens is the clean video with the chapters
/// drawn by the app, so the burnt-in copy is only ever a download. It is
/// built on request rather than with every correction, which is why this
/// sheet is mostly about saying where that build has got to.
private struct LessonRecapExportSheet: View {
    let id: UUID
    let file: LessonShareFile?
    /// There is a recap to cut a file from. A student sees this entry only
    /// when there is already a file to take.
    let showFile: Bool
    /// Only the owner of a settled recap can ask for a build.
    let canPrepare: Bool
    /// The owner, while the recap itself is being made again, which is the
    /// one time asking would be refused.
    let prepareWaiting: Bool
    let originalURL: URL?
    let onChanged: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var errorMessage: String?

    private var state: LessonShareFileState { file?.state ?? .none }
    /// The server sends the address only when there is something at it, so
    /// this is its own answer about whether a download is possible, rather
    /// than a second reading of the state.
    private var downloadURL: URL? { file?.downloadURL }
    private var prepareOffered: Bool { canPrepare && state.canPrepare }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    if showFile || file?.downloadURL != nil { videoWithText }
                    if let originalURL { originalRecording(originalURL) }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(PL.ink)
            .navigationTitle("Export")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .preferredColorScheme(.dark)
    }

    private var videoWithText: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Video with text").font(.plCardTitle).foregroundStyle(PL.text100)
            Text(stateLine).font(.plBody).foregroundStyle(PL.text400).lineSpacing(4)
            if prepareOffered {
                Button { Task { await prepare() } } label: {
                    Text(busy ? "Starting…" : prepareLabel).frame(maxWidth: .infinity, minHeight: 28)
                }
                .buttonStyle(PLPrimaryButtonStyle())
                .disabled(busy)
                Text("This takes a few minutes. You can keep using PongLens while it runs.")
                    .font(.plCaption).foregroundStyle(PL.text400).lineSpacing(3)
            } else if prepareWaiting, state.canPrepare {
                Text("You can make it once the update finishes.")
                    .font(.plCaption).foregroundStyle(PL.text400).lineSpacing(3)
            }
            if let downloadURL {
                // A file that is behind is still a file, and somebody who
                // only wants to send something today should be able to. It
                // steps back to the outlined style when there is a build to
                // start beside it, so the card keeps one cyan action.
                if prepareOffered {
                    saveOrSend(downloadURL).buttonStyle(PLSecondaryButtonStyle())
                } else {
                    saveOrSend(downloadURL).buttonStyle(PLPrimaryButtonStyle())
                }
            }
            if let errorMessage {
                Text(errorMessage).font(.plCaption).foregroundStyle(PL.dangerText)
            }
        }
    }

    private func originalRecording(_ url: URL) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Original recording").font(.plCardTitle).foregroundStyle(PL.text100)
            saveOrSend(url).buttonStyle(PLSecondaryButtonStyle())
        }
    }

    /// Hands the file's address to the system share sheet, which is where
    /// Save to Files, Messages and the rest live.
    private func saveOrSend(_ url: URL) -> some View {
        ShareLink(item: url) {
            Text("Save or send").frame(maxWidth: .infinity, minHeight: 28)
        }
    }

    /// What the file is doing, in the words a person would use.
    private var stateLine: String {
        let stage = file?.stage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        switch state {
        case .none:
            return "The video with your words on it has not been made yet."
        case .queued, .processing:
            return stage.isEmpty ? "Waiting to start" : stage
        case .ready:
            // Same sentence as the web panel, full stop included: one rule
            // written twice is how two surfaces start disagreeing.
            if let size = file?.sizeLabel { return "Ready. \(size)." }
            return "Ready."
        case .behind:
            return "This file still shows your earlier wording."
        case .failed:
            let reason = file?.error?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return reason.isEmpty ? "The video could not be made." : reason
        case .unknown:
            return "Update PongLens to see the state of this file."
        }
    }

    private var prepareLabel: String {
        switch state {
        case .behind: "Prepare it again"
        case .failed: "Try again"
        default: "Prepare the video"
        }
    }

    private func prepare() async {
        guard !busy else { return }
        busy = true
        errorMessage = nil
        defer { busy = false }
        do {
            let _: LessonVideoFileResponse = try await API.post(
                "api/lesson-video", LessonVideoAction(action: "prepare-file", id: id)
            )
            // The page's own read is what this sheet renders, and it is
            // also what starts the poll that will move it to Ready.
            await onChanged()
        } catch {
            errorMessage = UserFacingError.message(error)
                ?? "The video file could not be started. Try again."
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

/// Correct the recap's words: the title, each chapter's title and its
/// points. Nothing is written until Save, and Save prepares a new recap
/// video from what is here.
///
/// The draft is `LessonVideoEditDraft`, which gives every row an id, so
/// removing a point removes that point and not its twin. What the sheet
/// opened with is kept beside it: Cancel asks only when something has
/// changed, and a swipe down is refused while there is anything to lose.
private struct LessonVideoEditSheet: View {
    let id: UUID
    let expectedRevision: Int?
    let onSaved: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var draft: LessonVideoEditDraft
    private let opened: LessonVideoEditDraft
    @State private var busy = false
    @State private var error: String?
    @State private var discardAsk = false
    /// The point the keyboard is on, by its draft id.
    @FocusState private var focus: UUID?

    init(id: UUID, expectedRevision: Int?, edit: LessonVideoEdit, onSaved: @escaping () async -> Void) {
        self.id = id
        self.expectedRevision = expectedRevision
        self.onSaved = onSaved
        let draft = LessonVideoEditDraft(edit)
        _draft = State(initialValue: draft)
        opened = draft
    }

    private var dirty: Bool { draft != opened }
    private var blocker: String? { draft.blocker }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Button("Cancel") { cancel() }
                                .buttonStyle(PLSecondaryButtonStyle())
                                .disabled(busy)
                            Spacer()
                            Button(busy ? "Saving…" : "Save") { save() }
                                .buttonStyle(PLPrimaryButtonStyle())
                                .disabled(busy || blocker != nil)
                        }
                        if let blocker {
                            Text(blocker).font(.plCaption).foregroundStyle(PL.warningText)
                        }
                    }
                    Text("Edit recap").font(.plPageTitle).tracking(-0.6).foregroundStyle(PL.textBody)
                    VStack(alignment: .leading, spacing: 10) {
                        SectionHeading("Title")
                        TextField("Lesson title", text: $draft.title, axis: .vertical)
                            .font(.plCardTitle)
                            .foregroundStyle(PL.text100)
                            .plCard(padding: 16)
                    }
                    focusSection(.goals)
                    ForEach(draft.chapters) { chapter in
                        chapterCard(chapter)
                    }
                    focusSection(.workOn)
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
            .confirmationDialog("Discard your changes?", isPresented: $discardAsk, titleVisibility: .visible) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
            }
        }
        // Swiping the sheet away with edits in it lost them silently, and
        // nothing here has been written yet. With changes on screen the
        // way out is Cancel, which asks first.
        .interactiveDismissDisabled(dirty || busy)
    }

    /// One chapter: its title, its points with a remove control on each,
    /// a row to add a point while there is room, and a way to drop the
    /// whole chapter while there is another to keep.
    ///
    /// The rows are walked by value and every field is bound by id.
    /// `ForEach` over a binding to a collection hands each row a binding
    /// that resolves by POSITION, so removing a point left a row holding
    /// the index of something no longer there, and reading it crashed the
    /// app on the next pass. Nothing here can be read by a stale index:
    /// a lookup that finds nothing returns empty text and writes nowhere.
    private func chapterCard(_ chapter: LessonVideoEditDraft.Chapter) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("Chapter title", text: chapterTitle(chapter.id), axis: .vertical)
                .font(.plCardTitle).foregroundStyle(PL.text100)
                .writingSurface()
            ForEach(chapter.cues) { cue in
                HStack(alignment: .top, spacing: 4) {
                    TextField("Point", text: cueText(chapter.id, cue.id), axis: .vertical)
                        .font(.plBody)
                        .foregroundStyle(PL.text200)
                        .lineLimit(2...6)
                        .focused($focus, equals: cue.id)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .writingSurface()
                    // A chapter keeps its last point: the recap panel has
                    // to say something, and the server refuses an empty
                    // chapter, so the control goes rather than the button
                    // failing on press.
                    if chapter.cues.count > 1 {
                        Button { remove(cue: cue.id, from: chapter.id) } label: {
                            Image(systemName: "xmark.circle")
                                .font(.system(size: 18))
                        }
                        .buttonStyle(RemoveControlStyle())
                        .accessibilityLabel("Remove this point")
                    }
                }
            }
            if chapter.cues.count < LessonVideoEditDraft.maxCuesPerChapter {
                Button { addCue(to: chapter.id) } label: {
                    Label("Add a point", systemImage: "plus.circle")
                        .font(.plBody)
                        .foregroundStyle(PL.cyan)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            if draft.chapters.count > 1 {
                Button("Remove chapter") { removeChapter(chapter.id) }
                    .buttonStyle(PLSoftDestructiveButtonStyle())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
        .disabled(busy)
    }

    /// The two lists that bracket the clips. One shape, two headings.
    private enum FocusList {
        case goals, workOn
        var heading: String { self == .goals ? "Lesson goals" : "Things to work on" }
        var placeholder: String { self == .goals ? "Goal" : "Something to work on" }
        var addLabel: String { self == .goals ? "Add a goal" : "Add something to work on" }
        var removeLabel: String { self == .goals ? "Remove this goal" : "Remove this line" }
        var limit: Int { self == .goals ? LessonVideoEditDraft.maxGoals : LessonVideoEditDraft.maxWorkOn }
    }

    private func lines(_ list: FocusList) -> [LessonVideoEditDraft.Line] {
        switch list {
        case .goals: draft.goals
        case .workOn: draft.workOn
        }
    }

    /// One line, found by id rather than by where it sits, for the reason
    /// written over `chapterCard`.
    private func focusText(_ list: FocusList, _ lineId: UUID) -> Binding<String> {
        Binding(
            get: {
                switch list {
                case .goals: draft.goalText(lineId)
                case .workOn: draft.workOnText(lineId)
                }
            },
            set: { text in
                switch list {
                case .goals: draft.setGoalText(lineId, text)
                case .workOn: draft.setWorkOnText(lineId, text)
                }
            }
        )
    }

    /// A list a coach can take down to nothing.
    ///
    /// Unlike a chapter's points, the last row here may go: a lesson with
    /// no goals left is a recap with no goals card, which is a real
    /// answer. So the remove control stays on the final row and an empty
    /// list never blocks Save.
    private func focusSection(_ list: FocusList) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading(list.heading)
            VStack(alignment: .leading, spacing: 10) {
                ForEach(lines(list)) { line in
                    HStack(alignment: .top, spacing: 4) {
                        TextField(list.placeholder, text: focusText(list, line.id), axis: .vertical)
                            .font(.plBody)
                            .foregroundStyle(PL.text200)
                            .lineLimit(2...6)
                            .focused($focus, equals: line.id)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .writingSurface()
                        Button { remove(line: line.id, from: list) } label: {
                            Image(systemName: "xmark.circle")
                                .font(.system(size: 18))
                        }
                        .buttonStyle(RemoveControlStyle())
                        .accessibilityLabel(list.removeLabel)
                    }
                }
                if lines(list).count < list.limit {
                    Button { addLine(to: list) } label: {
                        Label(list.addLabel, systemImage: "plus.circle")
                            .font(.plBody)
                            .foregroundStyle(PL.cyan)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .plCard(padding: 16)
            .disabled(busy)
        }
    }

    private func addLine(to list: FocusList) {
        guard lines(list).count < list.limit else { return }
        let line = LessonVideoEditDraft.Line(text: "")
        switch list {
        case .goals: draft.goals.append(line)
        case .workOn: draft.workOn.append(line)
        }
        // A render behind the append, the same as a chapter's points.
        DispatchQueue.main.async { focus = line.id }
    }

    private func remove(line lineId: UUID, from list: FocusList) {
        if focus == lineId { focus = nil }
        switch list {
        case .goals: draft.goals.removeAll { $0.id == lineId }
        case .workOn: draft.workOn.removeAll { $0.id == lineId }
        }
    }

    /// The chapter's title, found by id rather than by where it sits.
    private func chapterTitle(_ chapterId: UUID) -> Binding<String> {
        Binding(
            get: { draft.chapterTitle(chapterId) },
            set: { draft.setChapterTitle(chapterId, $0) }
        )
    }

    /// One point, found by id rather than by where it sits.
    private func cueText(_ chapterId: UUID, _ cueId: UUID) -> Binding<String> {
        Binding(
            get: { draft.cueText(chapter: chapterId, cue: cueId) },
            set: { draft.setCueText(chapter: chapterId, cue: cueId, $0) }
        )
    }

    /// The small round remove control beside a point: caption grey, and
    /// amber under the finger, the same lean the soft destructive button
    /// has. A 44pt square so the target is the whole corner, not the glyph.
    private struct RemoveControlStyle: ButtonStyle {
        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .foregroundStyle(configuration.isPressed ? PL.warning : PL.text400)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
    }

    private func addCue(to chapterId: UUID) {
        guard let i = draft.chapters.firstIndex(where: { $0.id == chapterId }),
              draft.chapters[i].cues.count < LessonVideoEditDraft.maxCuesPerChapter else { return }
        let cue = LessonVideoEditDraft.Cue(text: "")
        draft.chapters[i].cues.append(cue)
        // A render behind the append: the row the keyboard is being sent
        // to does not exist yet on this pass, and focus set now lands on
        // nothing at all.
        DispatchQueue.main.async { focus = cue.id }
    }

    private func remove(cue cueId: UUID, from chapterId: UUID) {
        guard let i = draft.chapters.firstIndex(where: { $0.id == chapterId }),
              draft.chapters[i].cues.count > 1 else { return }
        if focus == cueId { focus = nil }
        draft.chapters[i].cues.removeAll { $0.id == cueId }
    }

    private func removeChapter(_ chapterId: UUID) {
        guard draft.chapters.count > 1 else { return }
        focus = nil
        draft.chapters.removeAll { $0.id == chapterId }
    }

    private func cancel() {
        if dirty { discardAsk = true } else { dismiss() }
    }

    private func save() {
        guard blocker == nil else { return }
        busy = true
        error = nil
        Task {
            do {
                let _: LessonVideoOK = try await API.post(
                    "api/lesson-video",
                    LessonVideoAction(action: "edit", id: id, edit: draft.cleaned(), expectedRevision: expectedRevision)
                )
                await onSaved()
                dismiss()
            } catch { self.error = UserFacingError.message(error) }
            busy = false
        }
    }
}
