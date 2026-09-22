import SwiftUI

// Starred points, drawn small (2026-09-22): the frame both Home's row and
// the shelf's rows use, Home's card, and Home's row itself. The web twins
// are src/app/starred/PointFrame.tsx and src/app/dashboard/HomeStarred.tsx.

extension StarredPointRow {
    /// The same cyan/magenta the score has everywhere else.
    var outcomeTint: Color {
        switch outcome {
        case .won: PL.cyan
        case .lost: PL.magentaSoft
        case .skipped: PL.warningText
        case .unscored: PL.text400
        }
    }

    /// The match it belongs to, as the shelf's group header names it.
    var matchTitle: String {
        MatchTitle.parts(
            opponentName: opponentName, venue: venue,
            playedAt: playedAt, matchType: matchType
        ).primary
    }
}

/// A real frame out of the rally's own clip, over the outcome wash that
/// carries it until the picture arrives (and stays if it never does).
/// `ClipFrame` loads lazily and caches, so a row that never scrolls into
/// view never asks for anything.
struct StarredFrame<Overlay: View>: View {
    let row: StarredPointRow
    var cornerRadius: CGFloat = PL.rSmall
    @ViewBuilder var overlay: () -> Overlay

    var body: some View {
        ZStack {
            PL.surface2
            LinearGradient(
                colors: [row.outcomeTint.opacity(0.2), row.outcomeTint.opacity(0.05), .clear],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            if row.hasClip, !row.edited {
                ClipFrame(matchId: row.matchId, pointId: row.id, at: row.posterTime)
            }
            overlay()
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
        // A scaledToFill picture overflows its frame and would take taps
        // meant for whatever sits beside it.
        .contentShape(Rectangle())
    }
}

extension StarredFrame where Overlay == EmptyView {
    init(row: StarredPointRow, cornerRadius: CGFloat = PL.rSmall) {
        self.init(row: row, cornerRadius: cornerRadius) { EmptyView() }
    }
}

/// One card in Home's row: the frame, then "Point 42", then the outcome
/// and the match.
struct StarredCard: View {
    let row: StarredPointRow

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            StarredFrame(row: row, cornerRadius: PL.rField) {
                if let duration = row.durationLabel {
                    Text(duration)
                        .font(.system(size: 11, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(PL.text100)
                        .shadow(color: .black.opacity(0.95), radius: 2, y: 1)
                        .shadow(color: .black.opacity(0.6), radius: 6)
                        .frame(maxWidth: .infinity, maxHeight: .infinity,
                               alignment: .bottomTrailing)
                        .padding(8)
                }
            }
            Text("Point \(row.displayNo)")
                .font(.system(size: 14, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(PL.text100)
            Text("\(Text(row.outcomeLabel).foregroundStyle(row.outcomeTint))\(Text(" · \(row.matchTitle)").foregroundStyle(PL.text500))")
                .font(.plCaption)
                .lineLimit(1)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Point \(row.displayNo), \(row.outcomeLabel), \(row.matchTitle)")
    }
}

/// Home's Starred points row: the newest stars, swiped sideways. A card
/// opens its point inside its match; View all opens the shelf.
struct HomeStarredRow: View {
    let rows: [StarredPointRow]
    /// The library, to find each point's match for the push.
    let matches: [MatchRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                SectionHeading("Starred points")
                Spacer()
                NavigationLink(value: "starred") {
                    HStack(spacing: 3) {
                        Text("View all")
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .semibold))
                    }
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(PL.cyan)
                }
                .buttonStyle(.plain)
            }
            // Edge to edge, so the next card peeks in from the right; the
            // content margin puts the first card back on the page's edge.
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 12) {
                    ForEach(rows) { row in
                        card(row)
                            .containerRelativeFrame(.horizontal) { width, _ in
                                width * 0.6
                            }
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            .contentMargins(.horizontal, 20, for: .scrollContent)
            .padding(.horizontal, -20)
        }
    }

    @ViewBuilder
    private func card(_ row: StarredPointRow) -> some View {
        if let match = matches.first(where: { $0.id == row.matchId }) {
            NavigationLink(value: MatchPointRoute(match: match, pointId: row.id)) {
                StarredCard(row: row)
            }
            .buttonStyle(.plain)
        } else {
            StarredCard(row: row)
        }
    }
}
