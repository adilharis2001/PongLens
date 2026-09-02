import SwiftUI

/// Shared dress for the coaching workspace's lists: an entry card and a
/// compact match row. Both are content-only — navigation belongs to the
/// screens that place them.
struct CoachEntryCard: View {
    let entry: CoachEntryRow
    let lesson: LessonRow?
    /// Shown when the card sits in a cross-student list (Home). On a
    /// student's own page it repeats the heading, so pass nil there.
    var studentName: String?

    private var title: String {
        if let t = lesson?.takeaways?.title, !t.isEmpty { return t }
        let words = (lesson?.transcript ?? "")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        if words.isEmpty { return "Entry" }
        return words.count > 64 ? String(words.prefix(64)) + "…" : words
    }

    private var preview: String? {
        guard lesson?.takeaways?.title?.isEmpty == false else { return nil }
        let words = (lesson?.transcript ?? "")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        return words.isEmpty ? nil : words
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if let studentName {
                    Text(studentName)
                        .font(.plSection)
                        .tracking(0.6)
                        .foregroundStyle(PL.cyan)
                }
                Spacer(minLength: 0)
                sharedChip
                Text(PLWhen.day(entry.createdAt))
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            Text(title)
                .font(.plRowTitle)
                .foregroundStyle(PL.text100)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            if let preview {
                Text(preview)
                    .font(.plCaption)
                    .foregroundStyle(PL.text400)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 14)
    }

    @ViewBuilder
    private var sharedChip: some View {
        if entry.sharedAt != nil {
            Text("Shared")
                .font(.plMicro)
                .foregroundStyle(PL.cyan)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(PL.cyan.opacity(0.12), in: Capsule())
        } else {
            Text("Draft")
                .font(.plMicro)
                .foregroundStyle(PL.text500)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
        }
    }
}

/// A student's match, one line. The screens push the full MatchRow, so
/// this only has to say which match it is and whether it is watchable.
struct CoachMatchLine: View {
    let match: MatchRow
    /// Home's list crosses students; a student page passes nil.
    var studentName: String?

    private var title: String {
        if let opponent = match.opponentName, !opponent.isEmpty {
            return "vs \(opponent)"
        }
        if let name = match.originalName, !name.isEmpty { return name }
        return match.matchType == "practice" ? "Practice" : "Match"
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "play.rectangle")
                .font(.system(size: 16))
                .foregroundStyle(PL.text400)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    if let studentName {
                        Text(studentName)
                            .font(.plSection)
                            .tracking(0.6)
                            .foregroundStyle(PL.cyan)
                    }
                    Text(title)
                        .font(.plRowTitle)
                        .foregroundStyle(PL.text100)
                        .lineLimit(1)
                }
                Text(PLWhen.day(match.playedAt))
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            Spacer()
            if match.status != .ready {
                Text(match.status == .failed ? "Failed" : "Processing")
                    .font(.plMicro)
                    .foregroundStyle(PL.text500)
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PL.text500)
        }
        .padding(14)
        .contentShape(Rectangle())
    }
}

/// One place for "when" copy, so cards do not each own a formatter.
enum PLWhen {
    static func day(_ iso: String) -> String {
        guard let date = PGDate.parse(iso) else { return "" }
        if Calendar.current.isDateInToday(date) { return "Today" }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
        return date.formatted(date: .abbreviated, time: .omitted)
    }
}
