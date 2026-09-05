import SwiftUI

/// Lesson recaps have a place beside the roster and journal, including drafts
/// that have not yet become shared entries. Used on Home and a student's page.
struct CoachLessonVideosSection: View {
    var student: CoachStudentRow? = nil
    @Environment(AppState.self) private var app
    @Environment(CoachRouter.self) private var router
    @Environment(CoachWorkspaceStore.self) private var workspace
    @Environment(\.scenePhase) private var scenePhase
    @State private var videos: [LessonVideo] = []
    @State private var loading = true
    @State private var failed = false
    @State private var queue = LessonVideoQueue.shared

    var body: some View {
        CoachGroup("Lesson videos") {
            if loading && videos.isEmpty {
                ProgressView().tint(PL.cyan).frame(maxWidth: .infinity).padding(16)
            } else if failed && videos.isEmpty {
                CoachNavRow(label: "Try loading lesson videos again", symbol: "arrow.clockwise") {
                    Task { await refresh() }
                }
            } else if videos.isEmpty {
                CoachEmptyLine(text: "No lesson videos yet.")
            } else {
                ForEach(Array(videos.prefix(3).enumerated()), id: \.element.id) { index, video in
                    NavigationLink {
                        LessonVideoDetailScreen(id: video.id)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "video")
                                .font(.system(size: 16))
                                .foregroundStyle(PL.cyan)
                                .frame(width: 24)
                            VStack(alignment: .leading, spacing: 5) {
                                Text(video.title).font(.plCardTitle).foregroundStyle(PL.text100)
                                Text(statusLine(video)).font(.plCaption).foregroundStyle(PL.text400)
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
                    if index < min(videos.count, 3) - 1 { CoachRowDivider() }
                }
            }
            CoachRowDivider()
            CoachNavRow(label: videos.isEmpty ? "Import a lesson video" : "All lesson videos", symbol: "video.badge.plus") {
                router.composeRecord = CoachComposerRequest(mode: .video, student: student)
            }
        }
        .task(id: student?.id) {
            await refresh()
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(10)) } catch { return }
                if videos.contains(where: \.needsRefresh) { await refresh() }
            }
        }
        .onAppear { Task { await refresh() } }
        .onChange(of: router.composeRecord?.id) { _, value in
            if value == nil { Task { await refresh() } }
        }
        .onChange(of: queue.items.filter { $0.state == "done" }.count) { _, _ in
            Task { await refresh() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await refresh() } }
        }
    }

    private func statusLine(_ video: LessonVideo) -> String {
        guard student == nil else { return video.statusLabel }
        let name = video.student_id.flatMap { workspace.student($0)?.displayName } ?? "Private lesson"
        return "\(name) · \(video.statusLabel)"
    }

    private func refresh() async {
        guard app.userId != nil else { return }
        do {
            let result: LessonVideoList = try await API.get("api/lesson-video", query: LessonVideoScope(studentId: student?.id).query)
            videos = result.videos
            failed = false
        } catch { failed = true }
        loading = false
    }
}
