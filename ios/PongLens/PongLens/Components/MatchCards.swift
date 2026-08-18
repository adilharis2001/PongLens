import SwiftUI

/// Poster placeholder until signed thumbnails arrive via /api/media-url.
struct ThumbPlaceholder: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [PL.surface2, PL.surface],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            Image(systemName: "play.rectangle")
                .font(.system(size: 18))
                .foregroundStyle(PL.text600)
        }
    }
}

/// A signed poster thumb, falling back to the placeholder while loading
/// (or when the match has no thumb at all).
struct MatchThumb: View {
    let url: URL?

    var body: some View {
        if let url {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    ThumbPlaceholder()
                }
            }
        } else {
            ThumbPlaceholder()
        }
    }
}

extension MatchRow {
    var chipStatus: PLStatus {
        switch status {
        case .uploaded: .notProcessed
        case .processing: .processing
        case .ready: .ready
        case .failed: .failed
        }
    }
}

/// Home "Recent matches" row: portrait thumb, title, meta, games pill later.
struct MatchListRow: View {
    let match: MatchRow
    var thumbURL: URL? = nil
    var score: ScoresStore.Entry? = nil

    var body: some View {
        let parts = MatchTitle.parts(for: match)
        HStack(spacing: 14) {
            MatchThumb(url: thumbURL)
                .frame(width: 64, height: 96)
                .clipShape(RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                        .strokeBorder(PL.edge, lineWidth: 1)
                )

            VStack(alignment: .leading, spacing: 5) {
                Text(parts.primary)
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                    .lineLimit(1)
                if match.status != .ready {
                    StatusChip(status: match.chipStatus)
                }
                Text(parts.secondary)
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .lineLimit(1)
            }
            Spacer()
            if let score, score.confirmedCount > 0 {
                ScorePill(you: score.gamesYou, them: score.gamesThem)
            }
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
    var thumbURL: URL? = nil
    var score: ScoresStore.Entry? = nil

    var body: some View {
        let parts = MatchTitle.parts(for: match)
        VStack(alignment: .leading, spacing: 8) {
            Color.clear
                .aspectRatio(16 / 9, contentMode: .fit)
                .overlay(MatchThumb(url: thumbURL))
                .clipShape(RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                        .strokeBorder(PL.edge, lineWidth: 1)
                )
                .overlay(alignment: .topLeading) {
                    if match.status != .ready {
                        StatusChip(status: match.chipStatus)
                            .padding(6)
                    }
                }

            VStack(alignment: .leading, spacing: 3) {
                Text(parts.primary)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PL.text100)
                    .lineLimit(1)
                Text(parts.secondary)
                    .font(.system(size: 11))
                    .foregroundStyle(PL.text500)
                    .lineLimit(1)
                footer
                    .padding(.top, 3)
            }
            .padding(.horizontal, 2)
        }
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
