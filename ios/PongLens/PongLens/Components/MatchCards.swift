import SwiftUI

extension MatchRow {
    var chipStatus: PLStatus {
        switch status {
        case .uploaded: .notProcessed
        case .processing: .processing
        case .ready: .ready
        case .failed: .failed
        }
    }

    /// The chip a match should wear, accounting for a job the row hasn't
    /// linked yet. A live job outranks the status column — reading the
    /// column straight showed "Not processed" directly under a banner
    /// saying the same match was processing. Mirrors the web's chipForMatch.
    func chipStatus(live: JobRow?) -> PLStatus {
        if let live { return live.status == "queued" ? .queued : .processing }
        return chipStatus
    }
}

/// Home "Recent matches" row: portrait thumb, title, meta, games pill later.
struct MatchListRow: View {
    let match: MatchRow
    var score: ScoresStore.Entry? = nil
    var liveJob: JobRow? = nil

    var body: some View {
        let parts = MatchTitle.parts(for: match)
        HStack(spacing: 14) {
            MatchThumb(matchId: match.id)
                .frame(width: 104, height: 64)
                .clipShape(RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                        .strokeBorder(PL.edge, lineWidth: 1)
                )

            VStack(alignment: .leading, spacing: 5) {
                Text(parts.primary)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(PL.text200)
                    .lineLimit(1)
                if match.status != .ready {
                    StatusChip(status: match.chipStatus(live: liveJob))
                }
                HStack(spacing: 8) {
                    Text(parts.secondary)
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                        .lineLimit(1)
                    if let score, score.confirmedCount > 0 {
                        ScorePill(you: score.gamesYou, them: score.gamesThem)
                    }
                }
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PL.text600)
        }
        .plCard(padding: 14)
    }
}

/// Matches library grid card: 16:9 thumb, chip overlay, title, meta.
struct MatchCard: View {
    let match: MatchRow
    var score: ScoresStore.Entry? = nil
    var liveJob: JobRow? = nil
    /// Owner-only card actions. Left nil, no buttons render — the grid
    /// only passes them when the signed-in user owns the match.
    var onShare: (() -> Void)? = nil
    var onDelete: (() -> Void)? = nil

    var body: some View {
        let parts = MatchTitle.parts(for: match)
        VStack(alignment: .leading, spacing: 0) {
            Color.clear
                .aspectRatio(16 / 10, contentMode: .fit)
                .overlay(MatchThumb(matchId: match.id))
                .clipped()
                .overlay(alignment: .topLeading) {
                    if match.status != .ready {
                        StatusChip(status: match.chipStatus(live: liveJob))
                            .padding(8)
                    }
                }

            VStack(alignment: .leading, spacing: 4) {
                Text(parts.primary)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(PL.text100)
                    .lineLimit(1)
                Text(parts.secondary)
                    .font(.system(size: 12))
                    .foregroundStyle(PL.text500)
                    .lineLimit(1)
                // Bottom meta row: score on the left, share and delete on
                // the right, off the picture and clearly apart from the
                // tap-to-open area. Plain button style keeps their taps
                // out of the enclosing NavigationLink.
                HStack(spacing: 8) {
                    footer
                    Spacer(minLength: 0)
                    if let onShare {
                        cardAction("square.and.arrow.up", label: "Share match", action: onShare)
                    }
                    if let onDelete {
                        cardAction("trash", label: "Delete match", action: onDelete)
                    }
                }
                .padding(.top, 5)
            }
            .padding(12)
        }
        .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
    }

    private func cardAction(
        _ icon: String, label: String, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(PL.text300)
                .frame(width: 32, height: 32)
                .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    @ViewBuilder
    private var footer: some View {
        if let score, score.confirmedCount > 0 {
            ScorePill(you: score.gamesYou, them: score.gamesThem)
        } else if match.status == .ready,
                  match.matchType != "drills", match.matchType != "practice" {
            Text("Add score")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(PL.text500)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .overlay(
                    Capsule().strokeBorder(
                        PL.edge, style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                    )
                )
        }
    }
}
