import SwiftUI

/// The student's side of a shared coach entry: the card in the journal
/// feed, and the sheet that shows the whole thing. Read-only — the words
/// belong to the coach, and edits over there show up here.
struct CoachSharedEntryCard: View {
    let entry: CoachSharedEntry

    private var title: String {
        if let t = entry.takeaways?.title, !t.isEmpty { return t }
        let words = entry.transcript
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        return words.count > 64 ? String(words.prefix(64)) + "…" : words
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "person.crop.circle")
                    .font(.system(size: 14))
                    .foregroundStyle(PL.cyan)
                Text(entry.coachName)
                    .font(.plSection)
                    .tracking(0.6)
                    .foregroundStyle(PL.cyan)
                Spacer()
                Text(PLWhen.day(entry.sharedAt))
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            Text(title)
                .font(.plRowTitle)
                .foregroundStyle(PL.text100)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 14)
    }
}

struct CoachSharedEntrySheet: View {
    let entry: CoachSharedEntry

    @Environment(\.dismiss) private var dismiss
    @Environment(LibraryStore.self) private var library

    private var linkedMatch: MatchRow? {
        guard let id = entry.matchId else { return nil }
        return library.matches.first { $0.id == id }
    }

    var body: some View {
        ZStack {
            PL.surface.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("From \(entry.coachName)")
                                .font(.plSection)
                                .tracking(0.6)
                                .foregroundStyle(PL.cyan)
                            if let title = entry.takeaways?.title, !title.isEmpty {
                                Text(title)
                                    .font(.plPageTitle)
                                    .tracking(-0.6)
                                    .foregroundStyle(PL.textBody)
                            }
                        }
                        Spacer()
                        Button { dismiss() } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(PL.text400)
                                .frame(width: 34, height: 34)
                                .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Close")
                    }
                    .padding(.top, 8)

                    Text(PLWhen.day(entry.sharedAt))
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)

                    if let takeaways = entry.takeaways, !(takeaways.themes ?? []).isEmpty {
                        ForEach(takeaways.themes ?? [], id: \.name) { theme in
                            VStack(alignment: .leading, spacing: 7) {
                                Text(theme.name.uppercased())
                                    .font(.plSection)
                                    .tracking(0.6)
                                    .foregroundStyle(PL.cyan)
                                ForEach(theme.points, id: \.self) { point in
                                    HStack(alignment: .top, spacing: 8) {
                                        Circle().fill(PL.text600)
                                            .frame(width: 4, height: 4)
                                            .padding(.top, 7)
                                        Text(point)
                                            .font(.plBody)
                                            .foregroundStyle(PL.text200)
                                            .lineSpacing(3)
                                        Spacer(minLength: 0)
                                    }
                                }
                            }
                        }
                        DisclosureGroup {
                            Text(entry.transcript)
                                .font(.plBody)
                                .foregroundStyle(PL.text300)
                                .lineSpacing(4)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.top, 8)
                        } label: {
                            Text("Transcript")
                                .font(.plRowTitle)
                                .foregroundStyle(PL.text400)
                        }
                        .tint(PL.text400)
                    } else {
                        Text(entry.transcript)
                            .font(.plBody)
                            .foregroundStyle(PL.text200)
                            .lineSpacing(4)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    if linkedMatch != nil {
                        Text("This entry is about one of your matches. Find it in your library.")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                    }
                }
                .padding(24)
            }
        }
        .presentationDetents([.large, .medium])
        .presentationDragIndicator(.visible)
    }
}
