import SwiftUI

/// The mobile point card, matching the web match page's row anatomy:
/// number circle · server chip + winner text · duration, with stacked
/// You/Them/Skip pills and a star/delete rail on the right.
struct PointCard: View {
    let point: MatchPoint
    let number: Int
    /// Rotation-computed server (serving.ts port), with the raw column as
    /// display fallback while rotation can't be computed.
    let displayServer: Winner?
    /// tracksServe on the live match type. False (practice/drills) drops
    /// the score anatomy — server chip, winner text, You/Them/Skip pills —
    /// and the row becomes number · duration · tag/star/delete.
    var scoring = true
    var noteCount = 0
    var tagCount = 0
    let onOpen: () -> Void
    let onYou: () -> Void
    let onThem: () -> Void
    let onSkip: () -> Void
    let onTag: () -> Void
    let onStar: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onOpen) {
                HStack(spacing: 12) {
                    Text("\(number)")
                        .font(.system(size: 14, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(PL.text300)
                        .frame(width: 36, height: 36)
                        .background(PL.ink.opacity(0.6), in: Circle())
                        .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))

                    VStack(alignment: .leading, spacing: 8) {
                        if scoring {
                            HStack(spacing: 8) {
                                serverChip
                                    .fixedSize()
                                if let winner = winnerLabel {
                                    Text(winner.text)
                                        .font(.system(size: 11, weight: .medium))
                                        .foregroundStyle(winner.color)
                                        .lineLimit(1)
                                }
                            }
                        }
                        HStack(spacing: 10) {
                            Text(durationLabel)
                                .monospacedDigit()
                            if noteCount > 0 {
                                HStack(spacing: 3) {
                                    Image(systemName: "text.bubble")
                                        .font(.system(size: 10))
                                    if noteCount > 1 {
                                        Text("\(noteCount)").monospacedDigit()
                                    }
                                }
                            }
                            if tagCount > 0 {
                                HStack(spacing: 3) {
                                    Image(systemName: "tag")
                                        .font(.system(size: 10))
                                    if tagCount > 1 {
                                        Text("\(tagCount)").monospacedDigit()
                                    }
                                }
                            }
                        }
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if scoring {
                VStack(spacing: 8) {
                    answerPill("You", selected: point.confirmedWinner == .user, tint: PL.cyan, action: onYou)
                    answerPill("Them", selected: point.confirmedWinner == .opponent, tint: PL.magentaSoft, action: onThem)
                    answerPill("Skip", selected: point.isLet, tint: PL.warning, small: true, action: onSkip)
                }
            }

            VStack(spacing: 16) {
                Button(action: onTag) {
                    Image(systemName: "tag")
                        .font(.system(size: 14))
                        .foregroundStyle(tagCount > 0 ? PL.cyan : PL.text600)
                }
                .buttonStyle(.plain)
                Button(action: onStar) {
                    Image(systemName: point.starred ? "star.fill" : "star")
                        .font(.system(size: 15))
                        .foregroundStyle(point.starred ? Color(hex: 0xFFD230) : PL.text600)
                }
                .buttonStyle(.plain)
                Button(action: onDelete) {
                    Image(systemName: "trash")
                        .font(.system(size: 14))
                        .foregroundStyle(PL.text600)
                }
                .buttonStyle(.plain)
            }
            .padding(.leading, 2)
        }
        .plCard(padding: 16)
    }

    private var durationLabel: String {
        if let secs = point.rallySeconds {
            return String(format: "%.1fs", secs)
        }
        return "View point"
    }

    private var winnerLabel: (text: String, color: Color)? {
        if point.isLet { return ("Skipped", PL.warningText) }
        switch point.confirmedWinner {
        case .user: return ("I won", PL.successText)
        case .opponent: return ("They won", PL.text400)
        case nil: return nil
        }
    }

    @ViewBuilder
    private var serverChip: some View {
        switch displayServer {
        case .user:
            chipBody("I served", tint: PL.cyan, textColor: PL.cyan)
        case .opponent:
            chipBody("They served", tint: PL.magenta, textColor: PL.magentaSoft)
        case nil:
            Text("Server")
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

    private func chipBody(_ label: String, tint: Color, textColor: Color) -> some View {
        HStack(spacing: 4) {
            Text(label)
            Image(systemName: "chevron.down")
                .font(.system(size: 8, weight: .semibold))
        }
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(textColor)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(tint.opacity(0.1), in: Capsule())
        .overlay(Capsule().strokeBorder(tint.opacity(0.4), lineWidth: 1))
    }

    private func answerPill(
        _ label: String, selected: Bool, tint: Color,
        small: Bool = false, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: small ? 10 : 11, weight: .semibold))
                .foregroundStyle(selected ? tint : PL.text400)
                .frame(width: 48)
                .padding(.vertical, 4)
                .background(
                    selected ? tint.opacity(0.15) : PL.ink.opacity(0.4),
                    in: Capsule()
                )
                .overlay(
                    Capsule().strokeBorder(
                        selected ? tint.opacity(0.6) : PL.edge, lineWidth: 1
                    )
                )
        }
        .buttonStyle(.plain)
    }
}
