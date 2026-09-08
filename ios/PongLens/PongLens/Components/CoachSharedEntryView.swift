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
                Text(PGDate.shortDate(entry.sharedAt))
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            HStack(alignment: .top, spacing: 12) {
                if let recapId = entry.recapId {
                    // A recap looks like a recap before it is opened, the
                    // way a shared match shows its picture.
                    RecapPosterThumb(id: recapId)
                } else if entry.imagePath != nil {
                    EntryPhotoThumb(lessonId: entry.lessonId)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.plRowTitle)
                        .foregroundStyle(PL.text100)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    if entry.recapId != nil {
                        // Says what it is before it is opened: a video, not a note.
                        Label("Lesson recap", systemImage: "play.rectangle")
                            .font(.plCaption)
                            .foregroundStyle(PL.text400)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 14)
    }
}

/// The recap behind a shared entry, as a thing to press: the poster, how
/// long it is, and one button that opens it. The poster is a signed link,
/// so it is fetched when the sheet opens; a missing poster still leaves a
/// working button, the same as the lesson screen.
struct LessonRecapPreview: View {
    let id: UUID
    let open: () -> Void

    @State private var detail: LessonVideoDetail?
    @State private var failed = false

    private var meta: String {
        if let edit = detail?.video.edit {
            let minutes = Int((edit.chapters.reduce(0) { $0 + max(0, $1.end_s - $1.start_s) } / 60).rounded())
            return "\(edit.chapters.count) chapters · \(minutes) min"
        }
        return failed ? "Not available right now" : "Loading…"
    }

    var body: some View {
        Button(action: open) {
            VStack(spacing: 0) {
                ZStack {
                    PL.surface2
                    AsyncImage(url: detail?.posterUrl.flatMap(URL.init(string:))) { phase in
                        if let image = phase.image { image.resizable().scaledToFill() }
                    }
                    Image(systemName: "play.fill").font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.white).frame(width: 52, height: 52)
                        .background(.black.opacity(0.6), in: Circle())
                }
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipped()
                HStack {
                    Text("Watch the recap").font(.plRowTitle).foregroundStyle(PL.text100)
                    Spacer()
                    Text(meta).font(.plCaption).foregroundStyle(PL.text500)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .background(PL.ink)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(PL.edge, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Watch the lesson recap")
        .task(id: id) {
            do { detail = try await API.get("api/lesson-video", query: ["id": id.uuidString.lowercased()]) }
            catch { failed = true }
        }
    }
}

struct CoachSharedEntrySheet: View {
    let entry: CoachSharedEntry
    @State private var lessonVideoLink: LessonVideoLink?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(LibraryStore.self) private var library

    /// A report goes to support as mail, with the entry named. Leaving the
    /// coach lives in Account, where coaches are managed.
    private var reportURL: URL? {
        var parts = URLComponents()
        parts.scheme = "mailto"
        parts.path = "support@ponglens.com"
        parts.queryItems = [
            URLQueryItem(name: "subject", value: "Report a shared entry"),
            URLQueryItem(name: "body", value: "Entry \(entry.entryId.uuidString.lowercased()) from \(entry.coachName).\n\nWhat is wrong with it:\n"),
        ]
        return parts.url
    }

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

                    Text(PGDate.shortDate(entry.sharedAt))
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)

                    if let recapId = entry.recapId {
                        // The recap is the body. The entry's own text is only a
                        // link to it, written for app versions that cannot show
                        // more, so it stays out of the way here.
                        LessonRecapPreview(id: recapId) { lessonVideoLink = LessonVideoLink(id: recapId) }
                    }

                    let themes = entry.visibleThemes
                    if !themes.isEmpty {
                        ForEach(themes, id: \.name) { theme in
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
                                        EntryText(text: point)
                                        Spacer(minLength: 0)
                                    }
                                }
                            }
                        }
                        if entry.recapId == nil {
                            DisclosureGroup {
                                EntryText(
                                    text: entry.transcript, color: PL.text300, lineSpacing: 4
                                )
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.top, 8)
                            } label: {
                                Text("Transcript")
                                    .font(.plRowTitle)
                                    .foregroundStyle(PL.text400)
                            }
                            .tint(PL.text400)
                        }
                    } else if entry.recapId == nil {
                        EntryText(text: entry.transcript, lineSpacing: 4)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    if entry.imagePath != nil {
                        EntryPhotoView(lessonId: entry.lessonId)
                    }

                    if linkedMatch != nil {
                        Text("This entry is about one of your matches. Find it in your library.")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("To stop hearing from this coach, remove them under Coaching in Account.")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                            .fixedSize(horizontal: false, vertical: true)
                        Button("Report this entry") {
                            if let reportURL { openURL(reportURL) }
                        }
                        .buttonStyle(PLSecondaryButtonStyle())
                    }
                    .padding(.top, 8)
                }
                .padding(24)
            }
        }
        // Present from this sheet, not behind it at the app root.
        .environment(\.openURL, OpenURLAction { url in
            guard let link = LessonVideoLink(url: url) else { return .systemAction }
            lessonVideoLink = link
            return .handled
        })
        .sheet(item: $lessonVideoLink) { link in
            NavigationStack {
                LessonVideoDetailScreen(id: link.id)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Done") { lessonVideoLink = nil }
                        }
                    }
            }
        }
        .presentationDetents([.large, .medium])
        .presentationDragIndicator(.visible)
    }
}
