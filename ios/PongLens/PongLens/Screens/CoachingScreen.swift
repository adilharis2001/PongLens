import SwiftUI
import Supabase

/// The player's coaching workspace: everything between you and the people
/// who coach you, newest first, in one feed you can narrow to one of them.
///
/// A feed rather than a list of coaches, because what a player comes here
/// for is "what happened", and only afterwards "who with" (Adil,
/// 2026-09-06). The chips narrow it; the card that appears when you do is
/// the door to everything about that coach.
///
/// The Journal keeps every one of these entries too. That is deliberate:
/// the Journal is the place you ask questions of, and it can only answer
/// "what did Jonathan tell me to work on" if the lesson is in it. This tab
/// is the same content read by coach instead of by date.
///
/// The coaching side of an account lives in its own root (CoachTabView),
/// reached by the switcher in the top bar. What is left here behind
/// `AppConfig.coachMarketplace` is the paid half, which is web-only.
struct CoachingScreen: View {
    @Environment(AppState.self) private var app
    @Environment(JournalStore.self) private var journal
    @Environment(Router.self) private var router
    @Environment(LibraryStore.self) private var library
    @Environment(CoachingStore.self) private var coaching
    @Environment(\.scenePhase) private var scenePhase

    /// The chip a row answers to. `noCoach` is its own bucket, not
    /// "everyone" — a lesson you took alone is not a lesson with nobody
    /// in particular.
    private enum Filter: Hashable { case all, coach(UUID), noCoach }

    @State private var filter: Filter = .all
    @State private var inviteOpen = false
    @State private var chooserOpen = false
    @State private var choice: NewLessonChoice?
    @State private var composerOpen = false
    @State private var recordOpen = false
    @State private var importOpen = false
    @State private var recaps: [LessonVideo] = []
    /// The entry being corrected. Presented from a value rather than a
    /// flag, so the sheet cannot be built before the lesson lands — the
    /// same shape the Journal uses.
    @State private var editRequest: EditRequest?
    @State private var coachEntryOpen: CoachSharedEntry?

    struct EditRequest: Identifiable {
        let id = UUID()
        let lesson: LessonRow
    }
    @State private var showAll = false

    private let feedCap = 30

    /// Notes somebody else left on YOUR matches.
    ///
    /// Both halves matter. note_feed returns every match the viewer may
    /// read, which for an account that also coaches includes their
    /// students' matches — so without the owner check a coach would find
    /// their students' notes in the feed of what their own coach has told
    /// them. The web filters this server-side for the same reason.
    private var coachNotes: [NoteFeedRow] {
        journal.notes.filter {
            $0.authorId != app.userId && $0.matchOwnerId == app.userId
        }
    }

    /// Which of the player's coaches a coach account belongs to, so a
    /// note or a shared entry can answer to the same chip their lessons do.
    private var coachByAccount: [UUID: PlayerCoach] {
        Dictionary(
            coaching.playerCoaches.compactMap { row in
                row.coachId.map { ($0, row) }
            },
            uniquingKeysWith: { first, _ in first }
        )
    }

    private var items: [CoachingItem] {
        var out: [CoachingItem] = []
        for entry in journal.coachShared {
            out.append(
                .init(
                    kind: .shared(entry), at: entry.sharedAt,
                    coachRef: coachByAccount[entry.coachId]?.id
                )
            )
        }
        for note in coachNotes {
            out.append(
                .init(
                    kind: .note(note), at: note.createdAt,
                    coachRef: coachByAccount[note.authorId]?.id
                )
            )
        }
        // A recap is one thing everywhere. When a recap has been saved
        // the feed used to keep its journal entry and hide the recap, so
        // the card was the whole written entry with a link bullet at the
        // bottom. It is the other way round now: the recap card, with the
        // entry's coach line and shared state on it, and the entry itself
        // is not drawn twice.
        var shownAsRecap = Set<UUID>()
        for recap in recaps where recap.student_id == nil {
            let entry = journal.lessons.first { $0.lessonVideoId == recap.id }
            if let entry { shownAsRecap.insert(entry.id) }
            out.append(
                .init(
                    kind: .recap(recap, entry),
                    at: entry?.createdAt ?? recap.created_at,
                    coachRef: entry?.coachRefId ?? recap.coach_ref_id
                )
            )
        }
        for lesson in journal.lessons where lesson.kind == "lesson" && !shownAsRecap.contains(lesson.id) {
            out.append(
                .init(kind: .lesson(lesson), at: lesson.createdAt, coachRef: lesson.coachRefId)
            )
        }
        for link in coaching.coachLinks
        where link.status == "accepted" && link.scopeMatchId != nil {
            guard let matchId = link.scopeMatchId,
                  let match = library.matches.first(where: { $0.id == matchId })
            else { continue }
            out.append(
                .init(
                    kind: .match(match, link.coachName ?? "your coach"),
                    at: link.createdAt,
                    coachRef: link.coachId.flatMap { coachByAccount[$0]?.id }
                )
            )
        }
        return out.sorted {
            (PGDate.parse($0.at) ?? .distantPast) > (PGDate.parse($1.at) ?? .distantPast)
        }
    }

    private var shown: [CoachingItem] {
        switch filter {
        case .all: items
        case .coach(let id): items.filter { $0.coachRef == id }
        case .noCoach: items.filter { $0.coachRef == nil && $0.ownsIt }
        }
    }

    private var anyWithoutCoach: Bool {
        items.contains { $0.coachRef == nil && $0.ownsIt }
    }

    private var selected: PlayerCoach? {
        if case .coach(let id) = filter {
            return coaching.playerCoaches.first { $0.id == id }
        }
        return nil
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Coaching")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    if !coaching.playerCoaches.isEmpty {
                        chips
                    }

                    if let selected {
                        coachCard(selected)
                    }

                    // The same first-run card Matches uses: a player who
                    // opens a tab they have never had before is owed the
                    // explanation, not a label and a button.
                    if coaching.playerCoaches.isEmpty, coaching.loaded {
                        VStack(spacing: 12) {
                            Text("👥").font(.system(size: 40))
                            Text("No coaches yet")
                                .font(.plCardTitle)
                                .foregroundStyle(PL.text100)
                            Text("Invite your coach and they can watch your matches and leave notes on them. You can also record a lesson here on your own, with or without a coach on it.")
                                .font(.plBody)
                                .foregroundStyle(PL.text400)
                                .multilineTextAlignment(.center)
                                .lineSpacing(4)
                            Button("Add a coach") { inviteOpen = true }
                                .buttonStyle(PLPrimaryButtonStyle())
                                .padding(.top, 8)
                        }
                        .frame(maxWidth: .infinity)
                        .plCard(padding: 40)
                    }

                    feed
                }
                .padding(20)
                .padding(.top, 12)
                .padding(.bottom, 120)
            }
            .refreshable {
                await journal.load(userId: app.userId)
                await coaching.load(userId: app.userId)
                await loadRecaps()
            }

            PLFab(label: "New lesson", systemImage: "plus") {
                chooserOpen = true
            }
            .padding(20)
        }
        .task { await loadRecaps() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await loadRecaps() } }
        }
        .sheet(item: $coachEntryOpen) { entry in
            CoachSharedEntrySheet(entry: entry)
        }
        .sheet(item: $editRequest) { request in
            JournalNoteEditor(lesson: request.lesson, store: journal)
                .presentationDetents([.large])
        }
        .sheet(isPresented: $inviteOpen) {
            AllMatchesCoachInvite()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        // Handed off on dismissal rather than presented from inside: a
        // second sheet raised while the first is still up races it, and
        // one of the two is dropped.
        .sheet(isPresented: $chooserOpen, onDismiss: {
            switch choice {
            case .write: composerOpen = true
            case .record: recordOpen = true
            case .importVideo: importOpen = true
            case nil: break
            }
            choice = nil
        }) {
            NewLessonSheet { picked in
                choice = picked
                chooserOpen = false
            }
            .presentationDetents([.height(330)])
            .presentationBackground(PL.surface)
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $composerOpen) {
            JournalComposer(store: journal, mode: .lesson) {
                Task { await journal.load(userId: app.userId) }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .fullScreenCover(isPresented: $recordOpen) {
            LessonRecordScreen {
                Task { await journal.load(userId: app.userId) }
            }
        }
        .sheet(isPresented: $importOpen, onDismiss: { Task { await loadRecaps() } }) {
            LessonVideoScreen(coaches: coaching.playerCoaches)
        }
    }

    // MARK: - Chips and the coach card

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                chip("All", value: .all)
                ForEach(coaching.playerCoaches) { coach in
                    chip(coach.displayName, value: .coach(coach.id))
                }
                if anyWithoutCoach {
                    chip("No coach", value: .noCoach)
                }
            }
            .padding(.horizontal, 1)
        }
    }

    private func chip(_ label: String, value: Filter) -> some View {
        let active = filter == value
        return Button(label) { filter = value }
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(active ? PL.cyan : PL.text400)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(active ? PL.cyan.opacity(0.1) : .clear, in: Capsule())
            .overlay(
                Capsule().strokeBorder(active ? PL.cyan.opacity(0.6) : PL.edge, lineWidth: 1)
            )
            .buttonStyle(.plain)
    }

    private func coachCard(_ coach: PlayerCoach) -> some View {
        NavigationLink(value: CoachPageRoute(coachRefId: coach.id)) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(coach.displayName)
                        .font(.plCardTitle)
                        .foregroundStyle(PL.text100)
                    Text("\(standing(coach)) · \(access(coach))")
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                }
                Spacer(minLength: 8)
                Text("Manage")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PL.text300)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.text500)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .plCard(padding: 16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// Their standing in one phrase, the same words the web uses.
    private func standing(_ coach: PlayerCoach) -> String {
        switch coach.status {
        case "connected": "Connected"
        case "invited": "Invite waiting"
        case "past": "No longer connected"
        default: "Not on PongLens"
        }
    }

    /// What they can see. Match access and shared entries are two
    /// different grants, so this only speaks for the matches.
    private func access(_ coach: PlayerCoach) -> String {
        guard let accountId = coach.coachId else { return "Not connected" }
        let mine = coaching.coachLinks.filter {
            $0.coachId == accountId && $0.status == "accepted"
        }
        if mine.contains(where: \.watchesAll) { return "All matches" }
        let count = Set(mine.compactMap(\.scopeMatchId)).count
        if count == 0 { return "No matches shared" }
        return "\(count) \(count == 1 ? "match" : "matches") shared"
    }

    // MARK: - Feed

    @ViewBuilder
    private var feed: some View {
        let rows = shown
        if !journal.loaded {
            ForEach(0..<3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                    .fill(PL.surface)
                    .frame(height: 96)
                    .opacity(0.6)
            }
        } else if rows.isEmpty {
            // The "No coaches yet" card above already speaks for a player
            // with nothing at all; a second empty line says it twice.
            if !coaching.playerCoaches.isEmpty {
                Text("Nothing with this coach yet.")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
            }
        } else {
            ForEach(showAll ? rows : Array(rows.prefix(feedCap))) { item in
                row(item)
            }
            if !showAll, rows.count > feedCap {
                Button("Show \(rows.count - feedCap) more") { showAll = true }
                    .buttonStyle(PLSecondaryButtonStyle())
                    .frame(maxWidth: .infinity)
            }
        }
    }

    @ViewBuilder
    private func row(_ item: CoachingItem) -> some View {
        switch item.kind {
        case .shared(let entry):
            // A recap is one thing everywhere: the card opens the recap
            // page. A written entry keeps its sheet, where the linked
            // match and Report live.
            if let recapId = entry.recapId {
                NavigationLink {
                    LessonVideoDetailScreen(id: recapId)
                } label: {
                    CoachSharedEntryCard(entry: entry)
                }
                .buttonStyle(.plain)
            } else {
                Button {
                    coachEntryOpen = entry
                } label: {
                    CoachSharedEntryCard(entry: entry)
                }
                .buttonStyle(.plain)
            }
        case .note(let note):
            // A coach's remark and the rally it is about stay one tap
            // apart: a point note opens that point, a match note opens
            // the match.
            let title = MatchTitle.parts(
                opponentName: note.opponentName, venue: note.venue,
                playedAt: note.playedAt
            ).primary
            if let match = library.matches.first(where: { $0.id == note.matchId }) {
                if let pointId = note.pointId {
                    NavigationLink(value: MatchPointRoute(match: match, pointId: pointId)) {
                        coachNoteBody(note, title: title)
                    }
                    .buttonStyle(.plain)
                } else {
                    NavigationLink(value: match) {
                        coachNoteBody(note, title: title)
                    }
                    .buttonStyle(.plain)
                }
            } else {
                coachNoteBody(note, title: title)
            }
        case .lesson(let lesson):
            // A preview, and a doorway: the Journal tab, scrolled to this
            // entry. The Journal itself shows the whole card.
            LessonCardView(
                lesson: lesson, store: journal, collapsed: true,
                onOpen: {
                    router.journalEntryToReveal = lesson.id
                    router.tab = .journal
                },
                onEdit: { editRequest = EditRequest(lesson: lesson) }
            )
        case .recap(let recap, let entry):
            NavigationLink {
                LessonVideoDetailScreen(
                    id: recap.id,
                    coachName: (entry?.coachRefId ?? recap.coach_ref_id).flatMap { ref in
                        coaching.playerCoaches.first { $0.id == ref }?.displayName
                    }
                )
            } label: {
                // The chapter count and length come from the list response
                // the feed already has, so a recap can look like a recap
                // without a second request per row.
                HStack(spacing: 14) {
                    RecapPosterThumb(id: recap.id)
                    VStack(alignment: .leading, spacing: 5) {
                        if let entry, let coachName = entry.coachName, !coachName.isEmpty {
                            // Saved: whose lesson it was and whether they can
                            // see it, the same line the journal card carries.
                            (Text("Lesson with ").foregroundColor(PL.text500)
                                + Text(coachName).foregroundColor(PL.text200).fontWeight(.semibold)
                                + Text(entry.sharedWithCoachAt != nil ? " · Shared" : "").foregroundColor(PL.cyan))
                                .font(.system(size: 12))
                                .lineLimit(1)
                        } else {
                            Text("LESSON RECAP")
                                .font(.system(size: 11, weight: .semibold))
                                .tracking(0.6)
                                .foregroundStyle(PL.cyan)
                        }
                        Text(recap.title)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(PL.text200)
                            .lineLimit(2)
                        Text(recapMeta(recap))
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PL.text600)
                }
                .plCard(padding: 14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        case .match(let match, let coachName):
            // A shared match shows the match, not a sentence about it. The
            // thumbnail is the one the library already caches, so this
            // costs nothing the app has not already paid.
            NavigationLink(value: match) {
                HStack(spacing: 14) {
                    MatchThumb(matchId: match.id)
                        .frame(width: 104, height: 64)
                        .clipped()
                        .clipShape(RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                                .strokeBorder(PL.edge, lineWidth: 1)
                        )
                    VStack(alignment: .leading, spacing: 5) {
                        Text("SHARED WITH \(coachName.uppercased())")
                            .font(.system(size: 11, weight: .semibold))
                            .tracking(0.6)
                            .foregroundStyle(PL.text500)
                            .lineLimit(1)
                        Text(
                            MatchTitle.parts(
                                opponentName: match.opponentName, venue: match.venue,
                                playedAt: match.playedAt
                            ).primary
                        )
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(PL.text200)
                        .lineLimit(2)
                        Text(PGDate.shortDate(match.playedAt))
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PL.text600)
                }
                .plCard(padding: 14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    /// What a recap says under its title, from the list response rather
    /// than a per-row fetch.
    private func recapMeta(_ recap: LessonVideo) -> String {
        guard let edit = recap.edit, !edit.chapters.isEmpty else {
            return recap.statusLabel
        }
        let chapters = edit.chapters.count
        return "\(chapters) chapter\(chapters == 1 ? "" : "s") · \(edit.recapMinutes) min"
    }

    private func coachNoteBody(_ note: NoteFeedRow, title: String) -> some View {
        // A coach's note is about a rally, so it carries the picture of the
        // match it is about. Smaller than the thumb on a shared match: here
        // the words are the point and the picture is the place, where on a
        // shared match it is the other way round.
        HStack(alignment: .top, spacing: 12) {
            MatchThumb(matchId: note.matchId)
                .frame(width: 72, height: 46)
                .clipped()
                .clipShape(RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                        .strokeBorder(PL.edge, lineWidth: 1)
                )
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    Text(note.authorName ?? "Coach")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color(hex: 0xF0C420))
                    Text("· \(note.pointId == nil ? "Match note" : "Point note")")
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                        .lineLimit(1)
                }
                Text(note.body.isEmpty ? (note.audioPath != nil ? "Voice note" : "Drawing") : note.body)
                    .font(.plBody)
                    .foregroundStyle(PL.text200)
                    .lineLimit(3)
                Text("\(title) · \(PGDate.shortDate(note.createdAt))")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 14)
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: PL.rCard, bottomLeadingRadius: PL.rCard)
                .fill(Color(hex: 0xF0C420).opacity(0.6))
                .frame(width: 3)
        }
    }
}

/// One row of the coaching feed, whichever direction it travelled.
struct CoachingItem: Identifiable {
    enum Kind {
        case shared(CoachSharedEntry)
        case note(NoteFeedRow)
        case lesson(LessonRow)
        /// The saved recap and, once it is in the journal, its entry: the
        /// coach line, the shared state, and the way to the coach's chip.
        case recap(LessonVideo, LessonRow?)
        case match(MatchRow, String)
    }

    let kind: Kind
    let at: String
    /// The player_coaches row it answers to, or nil when it belongs to no
    /// coach the player has named.
    let coachRef: UUID?

    /// Whether the player made it. Only their own work can honestly sit
    /// under "No coach"; a note somebody else left always has an author,
    /// even when that author is not on the player's list.
    var ownsIt: Bool {
        switch kind {
        case .lesson, .recap: true
        default: false
        }
    }

    var id: String {
        switch kind {
        case .shared(let e): "shared-\(e.entryId)"
        case .note(let n): "note-\(n.id)"
        case .lesson(let l): "lesson-\(l.id)"
        case .recap(let r, _): "recap-\(r.id)"
        case .match(let m, _): "match-\(m.id)"
        }
    }
}

/// The three ways a player records a lesson. All three are here, unlike
/// the web, which cannot record an hour of somebody talking in a tab.
enum NewLessonChoice {
    case write
    case record
    case importVideo
}

struct NewLessonSheet: View {
    let onChoose: (NewLessonChoice) -> Void

    var body: some View {
        PLChooserSheet(title: "New lesson") {
            PLChooserRow(
                icon: "square.and.pencil",
                title: "Write a lesson note",
                detail: "What you worked on and who with. Type it, speak it, or paste it."
            ) { onChoose(.write) }
            PLChooserRow(
                icon: "waveform",
                title: "Audio record a lesson",
                detail: "Put your phone near the net. Your notes are prepared automatically."
            ) { onChoose(.record) }
            PLChooserRow(
                icon: "video.badge.plus",
                title: "Import a lesson video",
                detail: "Import a lesson you filmed. You get a short recap with chapters, ready to share."
            ) { onChoose(.importVideo) }
        }
    }
}

/// Where the coach card goes. A value rather than a String route, because
/// it carries which coach and there is only one screen behind it.
struct CoachPageRoute: Hashable {
    let coachRefId: UUID
}


extension CoachingScreen {
    fileprivate func loadRecaps() async {
        guard app.userId != nil else { return }
        // A player's own recaps only. A dual-role account also owns the
        // lessons it made FOR students, and those belong to the coaching
        // side, not to the feed of what this player is being taught.
        if let result: LessonVideoList = try? await API.get("api/lesson-video") {
            recaps = result.videos.filter { $0.student_id == nil }
        }
    }
}

/// The coach invite from the Coaching tab (the match-scoped variant lives
/// on the match page's Tools): all matches, or only the ones shared later
/// from a match page (161). The QR is for handing your phone to the coach
/// at the table — same link, no typing.
struct AllMatchesCoachInvite: View {
    @Environment(AppState.self) private var app
    @Environment(CoachingStore.self) private var coaching
    @Environment(\.dismiss) private var dismiss
    @State private var allMatches = true
    /// Who the invite is for (164). Optional, and it does two things: the
    /// waiting invite says a name instead of "Invite sent", and the
    /// journal can attribute entries to them before they accept.
    @State private var inviteName = ""
    /// What the coach finds waiting when they accept (169).
    @Environment(LibraryStore.self) private var library
    @State private var starter = StarterPackStore()
    @State private var link: URL?
    @State private var creating = false
    @State private var errorMessage: String?
    @State private var showQR = false
    @State private var copied = false

    var body: some View {
        NavigationStack {
            Form {
                if let link {
                    Section {
                        Text(link.absoluteString)
                            .font(.system(size: 13, design: .monospaced))
                            .foregroundStyle(PL.text300)
                            .lineLimit(2)
                        ShareLink(item: link) {
                            Text("Share the link")
                        }
                        Button(copied ? "Copied" : "Copy link") {
                            UIPasteboard.general.string = link.absoluteString
                            copied = true
                            Task {
                                try? await Task.sleep(for: .seconds(1.5))
                                copied = false
                            }
                        }
                        Toggle("Show QR", isOn: $showQR)
                        if showQR {
                            QRCodeView(url: link)
                                .listRowBackground(Color.clear)
                        }
                    } footer: {
                        Text(allMatches
                             ? "They can watch all your matches, point by point, and leave coach notes."
                             : "They can watch the matches you share with them, point by point, and leave coach notes.")
                    }
                } else {
                    Section {
                        // Naming them now is what lets the journal
                        // attribute lessons to this coach before they
                        // have accepted anything (164), and what makes
                        // the waiting invite say a name.
                        TextField("Their name (optional)", text: $inviteName)
                            .textInputAutocapitalization(.words)
                            .autocorrectionDisabled()
                        Picker("Access", selection: $allMatches) {
                            Text("All my matches").tag(true)
                            Text("Only matches I share").tag(false)
                        }
                        .pickerStyle(.segmented)
                        Button(creating ? "Creating…" : "Create invite link") {
                            Task { await create() }
                        }
                        .disabled(creating)
                        if let errorMessage {
                            Text(errorMessage)
                                .font(.plCaption)
                                .foregroundStyle(PL.dangerText)
                        }
                    } footer: {
                        Text(allMatches
                             ? "Every match, including future uploads. You can change this later under Your coaches."
                             : "You share each match from its page. You can change this later under Your coaches.")
                    }

                    InviteStarterPackSections(
                        store: starter,
                        // "All my matches" already covers every match.
                        offerMatches: !allMatches,
                        named: !inviteName.trimmingCharacters(in: .whitespaces).isEmpty
                    )
                }
            }
            .tint(PL.cyan)
            .navigationTitle("Share with coach")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
        }
        .preferredColorScheme(.dark)
        .task {
            guard let uid = app.userId, !starter.loaded else { return }
            await starter.load(userId: uid, library: library.matches)
        }
    }

    private func create() async {
        guard let uid = app.userId else { return }
        creating = true
        errorMessage = nil
        struct Insert: Encodable {
            let player_id: String
            let all_matches: Bool
        }
        struct TokenRow: Decodable { let id: UUID; let invite_token: String }
        do {
            let row: TokenRow = try await supa
                .from("coach_links")
                .insert(Insert(player_id: uid.uuidString.lowercased(), all_matches: allMatches))
                .select("id,invite_token")
                .single()
                .execute()
                .value
            await coaching.nameInvite(
                playerId: uid, inviteId: row.id, name: inviteName
            )
            await starter.apply(
                userId: uid, inviteId: row.id, includeMatches: !allMatches
            )
            link = URL(string: "https://www.ponglens.com/coach-invite/\(row.invite_token)")
            await coaching.load(userId: uid)
        } catch {
            errorMessage = "Couldn't create the link. Try again."
        }
        creating = false
    }
}
