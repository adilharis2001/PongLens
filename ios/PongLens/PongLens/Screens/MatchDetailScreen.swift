import SwiftUI
import Supabase

@Observable
final class MatchDetailModel {
    var points: [MatchPoint] = []
    var videoURL: URL?
    var loaded = false
    var error: String?

    /// The visible timeline: non-deleted, ordered by source time (idx tiebreak).
    var visible: [MatchPoint] {
        points
            .filter { !$0.deleted }
            .sorted { a, b in
                if let ta = a.t0, let tb = b.t0, ta != tb { return ta < tb }
                return a.idx < b.idx
            }
    }

    func load(_ match: MatchRow) async {
        do {
            points = try await supa
                .from("points")
                .select(MatchPoint.matchSelect)
                .eq("match_id", value: match.id.uuidString.lowercased())
                .order("idx")
                .execute()
                .value
        } catch {
            #if DEBUG
            self.error = String(describing: error)
            #else
            self.error = "Couldn't load this match. Try again."
            #endif
        }

        struct Req: Encodable {
            let matchId: String
            var preview: Bool?
            var raw: Bool?
        }
        struct Res: Decodable { let url: String? }
        do {
            let ready = match.status == .ready
            let res: Res = try await API.post(
                "api/media-url",
                Req(
                    matchId: match.id.uuidString.lowercased(),
                    preview: ready ? true : nil,
                    raw: ready ? nil : true
                )
            )
            videoURL = res.url.flatMap(URL.init)
        } catch {
            // Hero stays a poster; playback reports its own error.
        }
        loaded = true
    }
}

struct MatchDetailScreen: View {
    let match: MatchRow

    @Environment(\.dismiss) private var dismiss
    @Environment(MediaStore.self) private var media
    @Environment(Router.self) private var router
    @State private var model = MatchDetailModel()
    @State private var playerStartAt: Double?
    @State private var playerOpen = false
    @State private var pointsExpanded = false

    private let pointsPreview = 10

    private var pad: ClipPad {
        clipPad(strictness: nil, stored: match.clipPads)
    }

    private var score: MatchScore {
        computeMatchScore(model.visible.map {
            PointRow(
                id: $0.id, matchId: $0.matchId, idx: $0.idx, t0: $0.t0,
                confirmedWinner: $0.confirmedWinner, isLet: $0.isLet,
                deleted: $0.deleted, gameEndOverride: $0.gameEndOverride,
                gameWinnerOverride: $0.gameWinnerOverride
            )
        })
    }

    var body: some View {
        let parts = MatchTitle.parts(
            opponentName: match.opponentName, venue: match.venue,
            playedAt: match.playedAt, matchType: match.matchType,
            pointCount: model.visible.count
        )
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Button {
                        dismiss()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Matches")
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())

                    VStack(alignment: .leading, spacing: 6) {
                        Text(parts.primary)
                            .font(.plPageTitle)
                            .tracking(-0.6)
                            .foregroundStyle(PL.textBody)
                        HStack {
                            Text(parts.secondary)
                                .font(.plBody)
                                .foregroundStyle(PL.text500)
                            Spacer()
                            if score.confirmedCount > 0 {
                                ScorePill(you: score.gamesYou, them: score.gamesThem)
                            }
                        }
                    }

                    if let error = model.error {
                        Text(error)
                            .font(.plCaption)
                            .foregroundStyle(PL.dangerText)
                            .plCard(padding: 14)
                    }

                    hero

                    if match.status == .ready {
                        pointsSection
                    } else {
                        rawStatus
                    }
                }
                .padding(20)
                .padding(.bottom, 100)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await model.load(match)
            #if DEBUG
            if router.devOpenPlayer, model.videoURL != nil {
                router.devOpenPlayer = false
                playerOpen = true
            }
            #endif
        }
        .fullScreenCover(isPresented: $playerOpen) {
            if let url = model.videoURL {
                PlayerTakeover(
                    points: model.visible,
                    pad: pad,
                    videoURL: url,
                    startAt: playerStartAt
                )
            }
        }
    }

    private var hero: some View {
        Button {
            playerStartAt = nil
            playerOpen = true
        } label: {
            Color.clear
                .aspectRatio(16 / 9, contentMode: .fit)
                .overlay(MatchThumb(url: media.thumbURL(match.id)))
                .overlay {
                    if model.videoURL != nil {
                        Circle()
                            .fill(PL.ink.opacity(0.65))
                            .frame(width: 60, height: 60)
                            .overlay(Circle().strokeBorder(PL.cyan.opacity(0.6), lineWidth: 1))
                            .overlay(
                                Image(systemName: "play.fill")
                                    .font(.system(size: 22))
                                    .foregroundStyle(PL.cyan)
                                    .offset(x: 2)
                            )
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                        .strokeBorder(PL.edge, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .disabled(model.videoURL == nil)
    }

    private var rawStatus: some View {
        VStack(alignment: .leading, spacing: 10) {
            StatusChip(status: match.chipStatus)
            if match.status == .processing {
                Text("You can leave this page. We email you when the match is ready.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
            } else if match.status == .failed {
                Text("Processing failed, and your minutes came back.")
                    .font(.plBody)
                    .foregroundStyle(PL.warningText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard()
    }

    @ViewBuilder
    private var pointsSection: some View {
        let visible = model.visible
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Points")

            if !model.loaded {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                        .fill(PL.surface)
                        .frame(height: 56)
                        .opacity(0.6)
                }
            } else if visible.isEmpty {
                Text("No point breakdown for this match.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                    .frame(maxWidth: .infinity)
                    .plCard(padding: 24)
            } else {
                let shown = pointsExpanded ? visible : Array(visible.prefix(pointsPreview))
                VStack(spacing: 8) {
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, point in
                        pointRow(point, number: index + 1)
                        if let boundary = score.boundaryAfter[point.id] {
                            Text("Game \(boundary.game) ends \(boundary.you)-\(boundary.them) · game \(boundary.game + 1) begins")
                                .font(.plCaption)
                                .monospacedDigit()
                                .foregroundStyle(PL.text500)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 2)
                        }
                    }
                }
                if visible.count > pointsPreview {
                    Button(
                        pointsExpanded
                            ? "Show first \(pointsPreview)"
                            : "Show all \(visible.count) points"
                    ) {
                        withAnimation { pointsExpanded.toggle() }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }

    private func pointRow(_ point: MatchPoint, number: Int) -> some View {
        Button {
            if let cutT0 = point.cutT0 {
                playerStartAt = cutT0
                playerOpen = true
            }
        } label: {
            HStack(spacing: 12) {
                Text("\(number)")
                    .font(.plMicro)
                    .monospacedDigit()
                    .foregroundStyle(PL.text400)
                    .frame(width: 28, height: 28)
                    .background(PL.surface2, in: Circle())
                    .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))

                VStack(alignment: .leading, spacing: 2) {
                    Text(winnerText(point))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(winnerColor(point))
                    if let secs = point.rallySeconds {
                        Text(String(format: "%.1fs", secs))
                            .font(.plCaption)
                            .monospacedDigit()
                            .foregroundStyle(PL.text500)
                    }
                }
                Spacer()
                if point.edited {
                    Text("Updating clip")
                        .font(.plCaption)
                        .foregroundStyle(PL.text400)
                }
                if point.starred {
                    Image(systemName: "star.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(PL.warningText)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.text600)
            }
            .plInnerRow(padding: 12)
        }
        .buttonStyle(.plain)
    }

    private func winnerText(_ point: MatchPoint) -> String {
        if point.isLet { return "Skipped" }
        switch point.confirmedWinner {
        case .user: return "I won"
        case .opponent: return "They won"
        case nil: return "View point"
        }
    }

    private func winnerColor(_ point: MatchPoint) -> Color {
        if point.isLet { return PL.warningText }
        switch point.confirmedWinner {
        case .user: return PL.cyan
        case .opponent: return PL.magentaSoft
        case nil: return PL.text300
        }
    }
}
