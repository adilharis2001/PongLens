import SwiftUI

/// Shared dress for the coaching workspace's lists, in the journal's own
/// language: the header line the lesson card uses ("Jonah · Sep 2"), a
/// bold title, a quiet preview. Content only — navigation belongs to the
/// screens that place them.
struct CoachEntryCard: View {
    let entry: CoachEntryRow
    let lesson: LessonRow?
    /// Named on Home, where the list crosses students; a student's own
    /// page passes nil and the line reads "Entry · Sep 2".
    var studentName: String?
    /// The one-tap share, in the corner where the Shared badge lands. A
    /// coach writing in a student's folder assumes the student reads it,
    /// and nothing said otherwise until the entry was opened. The name
    /// itself is no longer drawn, so this reads as "there is somebody to
    /// share with"; the card drops the control once the entry is shared.
    var shareWith: String? = nil
    /// Whether that student has a PongLens account behind them, which is
    /// the difference between Shared and Waiting.
    ///
    /// DELIBERATELY WITHOUT A DEFAULT. This used to be folded into
    /// shareWith, which meant two things at once — the name, and whether
    /// they had joined — and splitting them is the whole point. A default
    /// of true here would let a call site that was never updated keep the
    /// old behaviour silently; with none, the compiler names every one of
    /// them.
    let studentLinked: Bool
    var sharing = false
    var onShare: (() -> Void)? = nil

    private var title: String? {
        if let t = lesson?.takeaways?.title, !t.isEmpty { return t }
        return nil
    }

    private var words: String {
        (lesson?.transcript ?? "")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 4) {
                if let studentName {
                    (Text(studentName).foregroundColor(PL.text200).fontWeight(.semibold)
                        + Text(" · \(PGDate.shortDate(entry.createdAt))").foregroundColor(PL.text500))
                        .font(.system(size: 13))
                } else {
                    Text("Entry · \(PGDate.shortDate(entry.createdAt))")
                        .font(.system(size: 13))
                        .foregroundStyle(PL.text500)
                }
                Spacer()
                if entry.sharedAt != nil {
                    // "Shared" over an entry nobody can read yet would be
                    // a lie the coach could act on (2026-09-04). A coach
                    // can now mark an entry for a student who has not
                    // joined; it lands the day they do, and says so until
                    // then.
                    Text(studentLinked ? "Shared" : "Waiting")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(studentLinked ? PL.cyan : PL.text500)
                } else if shareWith != nil, let onShare {
                    // In the corner the Shared badge would occupy, sized
                    // against it, but ringed and filled so it reads as a
                    // control rather than another status word. It was a
                    // full-width cyan bar under the entry, which shouted
                    // beside a badge that whispers (Adil, 2026-09-04).
                    // The name lives in the page title above; "Share"
                    // alone is what fits a badge-sized control.
                    Button(action: onShare) {
                        Text(sharing ? "Sharing…" : "Share")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(PL.cyan)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(PL.cyan.opacity(0.12), in: Capsule())
                            .overlay(Capsule().strokeBorder(PL.cyan.opacity(0.6), lineWidth: 1))
                            // The whole pill takes the tap, not only the
                            // letters: a bare Text button has bitten this
                            // app twice.
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(sharing)
                } else if lesson?.status == "queued" {
                    Text("Writing up…")
                        .font(.system(size: 12))
                        .foregroundStyle(PL.text500)
                }
            }
            // The photo beside the words, not only inside the entry. It
            // is half of what a card like "camera setup, see the photo"
            // is saying, and a row that hides it makes the words read as
            // a mistake.
            HStack(alignment: .top, spacing: 12) {
                if let lesson, lesson.imagePath != nil {
                    EntryPhotoThumb(lessonId: lesson.id)
                }
                VStack(alignment: .leading, spacing: 6) {
                    if let title {
                        Text(title)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(PL.text100)
                            .multilineTextAlignment(.leading)
                        if !words.isEmpty {
                            Text(words)
                                .font(.plBody)
                                .foregroundStyle(PL.text400)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                    } else {
                        Text(words.isEmpty ? "Empty entry" : words)
                            .font(.plBody)
                            .foregroundStyle(PL.text200)
                            .lineLimit(4)
                            .multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
    }
}

/// A student's match as a row in a grouped card — the Account row dress,
/// with the match named the way the library names it.
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
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 16))
                    .foregroundStyle(PL.textBody)
                    .lineLimit(1)
                HStack(spacing: 4) {
                    if let studentName {
                        Text(studentName)
                            .fontWeight(.semibold)
                            .foregroundStyle(PL.text300)
                        Text("·").foregroundStyle(PL.text600)
                    }
                    Text(PGDate.shortDate(match.playedAt))
                        .foregroundStyle(PL.text500)
                    if match.status != .ready {
                        Text("·").foregroundStyle(PL.text600)
                        Text(match.status == .failed ? "Failed" : "Processing")
                            .foregroundStyle(match.status == .failed ? PL.warningText : PL.text500)
                    }
                }
                .font(.system(size: 13))
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PL.text600)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
        .contentShape(Rectangle())
    }
}

/// The grouped card the Account page uses: a section heading over a
/// bordered surface of rows, dividers inset from the left.
struct CoachGroup<Content: View>: View {
    let title: String?
    @ViewBuilder var content: () -> Content

    init(_ title: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title { SectionHeading(title) }
            VStack(spacing: 0, content: content)
                .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                        .strokeBorder(PL.edge, lineWidth: 1)
                )
        }
    }
}

struct CoachRowDivider: View {
    var body: some View {
        Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1).padding(.leading, 16)
    }
}

/// An Account-style action row: label, optional leading symbol, chevron.
struct CoachNavRow: View {
    let label: String
    var symbol: String? = nil
    var tint: Color = PL.textBody
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                if let symbol {
                    Image(systemName: symbol)
                        .font(.system(size: 15))
                        .foregroundStyle(tint == PL.textBody ? PL.text400 : tint)
                        .frame(width: 20)
                }
                Text(label)
                    .font(.system(size: 16))
                    .foregroundStyle(tint)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.text600)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Where a coach's lists say "nothing yet": one short line, the way every
/// empty state in the app does it.
struct CoachEmptyLine: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.plBody)
            .foregroundStyle(PL.text400)
            .frame(maxWidth: .infinity, alignment: .leading)
            .plCard(padding: 16)
    }
}
