import SwiftUI

/// The pieces the board, a post's own page and Home's card share, so a
/// post is drawn the same way wherever it appears: the same chips, the
/// same vote box, the same badge on the maker's reply.
enum FeedbackLook {
    static func typeLabel(_ type: String) -> String {
        switch type {
        case "bug": "Bug"
        case "idea": "Idea"
        case "improvement": "Improvement"
        default: "Private"
        }
    }

    static func typeTint(_ type: String) -> Color {
        switch type {
        case "bug": PL.dangerText
        case "idea": PL.cyan
        case "improvement": Color(hex: 0xC4B5FD)
        default: PL.text400
        }
    }

    /// Only the states worth naming. "Open" on every row is noise: it is
    /// what a board post is unless something says otherwise.
    static func statusLabel(_ status: String) -> String? {
        switch status {
        case "planned": "Planned"
        case "building": "Building"
        case "done": "Done"
        case "declined": "Declined"
        default: nil
        }
    }

    /// One colour per stage, the same on the rail and on the chip: a
    /// promise, something in motion, something finished.
    static func statusTint(_ status: String) -> Color {
        switch status {
        case "planned": Color(hex: 0x7DD3FC)
        case "building": PL.warningText
        case "done": PL.successText
        default: PL.text400
        }
    }

    /// "3m", "5h", "2d", then a date — the board's own scale.
    static func ago(_ iso: String) -> String {
        guard let date = PGDate.parse(iso) else { return "" }
        let seconds = Date().timeIntervalSince(date)
        if seconds < 3600 { return "\(max(1, Int(seconds / 60)))m" }
        if seconds < 86_400 { return "\(Int(seconds / 3600))h" }
        if seconds < 7 * 86_400 { return "\(Int(seconds / 86_400))d" }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }

    /// "You" for your own, a first name for everyone else.
    static func name(_ raw: String?, userId: UUID, viewerId: UUID?) -> String {
        let who = (raw ?? "").trimmingCharacters(in: .whitespaces)
        return userId == viewerId ? "You" : (who.isEmpty ? "A player" : who)
    }
}

struct FeedbackChip: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(.plMicro)
            .foregroundStyle(tint)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(tint.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.35), lineWidth: 1))
    }
}

/// A first name's photo, or its initial when the account has none.
struct FeedbackAvatar: View {
    let name: String?
    let url: String?
    var size: CGFloat = 16

    private var initial: String {
        String((name ?? "").trimmingCharacters(in: .whitespaces).prefix(1)).uppercased()
    }

    var body: some View {
        Group {
            if let url, let parsed = URL(string: url) {
                AsyncImage(url: parsed) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        fallback
                    }
                }
            } else {
                fallback
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
    }

    private var fallback: some View {
        ZStack {
            PL.surface2
            Text(initial.isEmpty ? "?" : initial)
                .font(.system(size: max(8, size * 0.45), weight: .medium))
                .foregroundStyle(PL.text400)
        }
    }
}

/// The maker's mark on a comment. Reads as the product, not a person.
struct FeedbackOfficialBadge: View {
    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(PL.cyan).frame(width: 5, height: 5)
            Text("PongLens")
        }
        .font(.plMicro)
        .foregroundStyle(PL.cyan)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(PL.cyan.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(PL.cyan.opacity(0.4), lineWidth: 1))
    }
}

/// The admin's reply, pinned under a post: a rule in the accent and the
/// badge, so a reader can tell in one glance that the maker answered
/// without opening the thread.
struct FeedbackOfficialReply: View {
    let text: String
    let at: String?
    var lineLimit: Int? = 2

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            RoundedRectangle(cornerRadius: 1)
                .fill(PL.cyan.opacity(0.6))
                .frame(width: 2)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    FeedbackOfficialBadge()
                    if let at {
                        Text(FeedbackLook.ago(at))
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                    }
                }
                Text(text)
                    .font(.plBody)
                    .foregroundStyle(PL.text300)
                    .lineLimit(lineLimit)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// Vote on the left, the count under the chevron, lit when it is yours.
/// The count is the reason the board exists — it is what tells someone
/// their idea is already here and already wanted — so it reads before
/// the text does.
struct FeedbackVoteBox: View {
    let count: Int
    let voted: Bool
    var large = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: "chevron.up")
                    .font(.system(size: large ? 13 : 12, weight: .bold))
                Text("\(count)")
                    .font(.system(size: large ? 15 : 14, weight: .semibold))
                    .monospacedDigit()
            }
            .foregroundStyle(voted ? PL.cyan : PL.text400)
            .frame(width: large ? 52 : 46, height: large ? 54 : 48)
            .background(
                voted ? PL.cyan.opacity(0.12) : PL.ink.opacity(0.4),
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(voted ? PL.cyan.opacity(0.5) : PL.edge, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(voted ? "Remove your vote" : "Vote for this")
    }
}

/// A private row cannot be voted on, so the column keeps its box without
/// offering the action. QA reports are the only rows that land here.
struct FeedbackHiddenBox: View {
    var body: some View {
        Image(systemName: "eye.slash")
            .font(.system(size: 14))
            .foregroundStyle(PL.text600)
            .frame(width: 46, height: 48)
            .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(PL.edge, lineWidth: 1))
            .accessibilityLabel("Not on the board")
    }
}

/// A bubble and a number: how much has been said under a post.
struct FeedbackCommentCount: View {
    let count: Int

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "bubble.left")
                .font(.system(size: 11))
            Text("\(count)")
                .monospacedDigit()
        }
        .font(.plCaption)
        .foregroundStyle(PL.text500)
        .accessibilityLabel("\(count) \(count == 1 ? "comment" : "comments")")
    }
}

// MARK: - Roadmap

/// The roadmap as a reader sees it: three sections, each hidden when
/// empty, each entry a title and one sentence. Shipped entries carry the
/// month. The same list the public web page shows.
struct RoadmapSectionsView: View {
    let items: [RoadmapItem]
    let loaded: Bool

    private func tint(_ stage: RoadmapStage) -> Color {
        switch stage {
        case .building: PL.warningText
        case .planned: Color(hex: 0x7DD3FC)
        case .shipped: PL.successText
        }
    }

    var body: some View {
        let groups = Roadmap.groups(items)
        VStack(alignment: .leading, spacing: 28) {
            if !loaded {
                VStack(alignment: .leading, spacing: 10) {
                    PLSkeletonBar(maxWidth: 200)
                    PLSkeletonBar()
                }
                .plCard(padding: 16)
                .plShimmer()
            } else if groups.isEmpty {
                Text("Nothing on the roadmap yet.")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
            } else {
                ForEach(groups) { group in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 8) {
                            Circle().fill(tint(group.stage)).frame(width: 6, height: 6)
                            SectionHeading(group.stage.label)
                        }
                        ForEach(group.items) { item in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(alignment: .firstTextBaseline, spacing: 10) {
                                    Text(item.title)
                                        .font(.plRowTitle)
                                        .foregroundStyle(PL.text100)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Spacer(minLength: 0)
                                    if group.stage == .shipped, let when = Roadmap.shippedLabel(item.shippedAt) {
                                        Text(when)
                                            .font(.plCaption)
                                            .foregroundStyle(PL.text500)
                                    }
                                }
                                if !item.description.isEmpty {
                                    Text(item.description)
                                        .font(.plBody)
                                        .foregroundStyle(PL.text400)
                                        .lineSpacing(2)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .plCard(padding: 14)
                        }
                    }
                }
            }
        }
    }
}
