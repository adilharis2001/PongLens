import SwiftUI

struct HomeScreen: View {
    @Environment(AppState.self) private var app
    @Environment(Router.self) private var router
    @Environment(LibraryStore.self) private var library
    @Environment(ScoresStore.self) private var scores
    @Environment(JournalStore.self) private var journal
    @State private var homeStore = HomeStore()
    @State private var firstStepsHidden = false
    @State private var cameraSheetOpen = false
    @State private var coachEntryOpen: CoachSharedEntry?

    private var ownMatches: [MatchRow] {
        guard let uid = app.userId else { return [] }
        return library.matches.filter { $0.userId == uid }
    }

    /// Matches someone else owns and shared — a coach's students' footage.
    private var sharedMatches: [MatchRow] {
        guard let uid = app.userId else { return [] }
        return library.matches.filter { $0.userId != uid }
    }

    /// Nothing to show at all. Shared matches count: a coach whose students
    /// have sent them footage is not an empty account, and telling them to
    /// "Add your first match" is answering a question they did not ask.
    /// Web draws the same line (`recentPool` falls back to shared).
    private var isEmpty: Bool {
        ownMatches.isEmpty && sharedMatches.isEmpty && library.activeJobs.isEmpty
    }

    private var latestReady: MatchRow? {
        ownMatches.first { $0.status == .ready }
    }

    private var processingCount: Int {
        // A match counts as working when its own row says so OR a job of its
        // own is still queued or running; a job tied to no visible row (a
        // YouTube download, a commerce upload the worker hasn't linked yet)
        // counts once on its own. Counting rows and jobs separately made one
        // video read as "2 matches are processing" — the bug the web's
        // HomeOverview fixed the same way.
        let ownJobIds = Set(ownMatches.compactMap(\.jobId))
        let ownIds = Set(ownMatches.map { $0.id.uuidString.lowercased() })
        let orphanJobs = library.activeJobs.filter { job in
            !ownJobIds.contains(job.id)
                && !ownIds.contains(job.options?.matchId?.lowercased() ?? "")
        }
        let working = ownMatches.filter {
            $0.status == .processing || library.liveJob(for: $0) != nil
        }
        return working.count + orphanJobs.count
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            ScrollView {
                VStack(alignment: .leading, spacing: 36) {
                    Text("Hey \(app.firstName) 👋")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    if let error = library.lastError {
                        Text(error)
                            .font(.plCaption)
                            .foregroundStyle(PL.dangerText)
                            .plCard(padding: 14)
                    }

                    nextAction

                    // A coach's entry, only while it is new: opening the
                    // Journal marks it seen and the card goes. Adil's call
                    // over a fourth tab — what a coach sends arrives here.
                    if let fresh = journal.unseenCoachShare(userId: app.userId) {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionHeading("From your coach")
                            Button {
                                coachEntryOpen = fresh
                            } label: {
                                CoachSharedEntryCard(entry: fresh)
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    firstSteps

                    if !ownMatches.isEmpty {
                        recentMatches
                    }

                    yourGame

                    workingOn

                    latestActivity
                }
                .padding(20)
                .padding(.top, 12)
                .padding(.bottom, 120)
            }
            .refreshable { await library.load() }
            .task { await homeStore.load(userId: app.userId) }

            // The pill is on every other screen, so it is on this one too.
            // Adil's call: one create door, in the same place always, beats
            // a card-shaped button that only exists before the first match.
            // The card carries no button of its own, so there is nothing
            // here to duplicate.
            PLFabStack()
                .padding(20)
        }
        .sheet(isPresented: $cameraSheetOpen) {
            CameraPlacementSheet()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $coachEntryOpen, onDismiss: {
            journal.markCoachSharesSeen(userId: app.userId)
        }) { entry in
            CoachSharedEntrySheet(entry: entry)
        }
    }

    @ViewBuilder
    private var nextAction: some View {
        if !library.loaded {
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .fill(PL.surface)
                .frame(height: 128)
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                        .strokeBorder(PL.edge, lineWidth: 1)
                )
                .opacity(0.6)
        } else if isEmpty {
            VStack(spacing: 12) {
                Text("🏓").font(.system(size: 40))
                Text("Add your first match")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Text("PongLens cuts the dead time out of your footage and breaks the match into points, so you can review it point by point and add notes for yourself or a coach.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                // This is the screen someone sees BEFORE they go to the
                // club, which is the only moment camera advice can still
                // change the recording. On Upload it is already too late
                // for today's footage, and the in-app ghost only helps
                // people who film on the phone. Web places it here for the
                // same reason.
                Button {
                    cameraSheetOpen = true
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "video")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(PL.cyan)
                        Text("How to record")
                            .font(.plBody)
                            .foregroundStyle(PL.text200)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(PL.text600)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(PL.surface2.opacity(0.5),
                                in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                            .strokeBorder(PL.edge, lineWidth: 1)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.top, 12)
            }
            .frame(maxWidth: .infinity)
            .plCard(padding: 40)
        } else if processingCount > 0 {
            VStack(alignment: .leading, spacing: 10) {
                StatusChip(status: .processing)
                Text(processingCount == 1 ? "Your match is processing" : "\(processingCount) matches are processing")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Text("Most videos finish in under 30 minutes. We'll email you when it's ready.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                if let ready = latestReady {
                    NavigationLink(value: ready) {
                        HStack(spacing: 4) {
                            Text("Meanwhile: review \(MatchTitle.parts(for: ready).primary)")
                            Image(systemName: "arrow.right")
                        }
                        .font(.plBody)
                        .foregroundStyle(PL.cyan)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .plCard()
        } else if let match = latestReady {
            NavigationLink(value: match) {
                let parts = MatchTitle.parts(for: match)
                HStack(spacing: 14) {
                    MatchThumb(matchId: match.id)
                        .frame(width: 128, height: 80)
                        .clipShape(RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                                .strokeBorder(PL.edge, lineWidth: 1)
                        )
                    VStack(alignment: .leading, spacing: 5) {
                        Text(continueEyebrow(for: match))
                            .font(.plSection)
                            .tracking(0.6)
                            .foregroundStyle(PL.cyan)
                            .textCase(.uppercase)
                        Text(parts.primary)
                            .font(.plCardTitle)
                            .foregroundStyle(PL.text100)
                            .lineLimit(1)
                        Text(parts.secondary)
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                            .lineLimit(1)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(PL.text600)
                }
                .plCard(padding: 16)
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - First steps

    /// Where a step happens. Web makes every incomplete row a link; the
    /// iOS equivalents are a mix of pushes, tab switches and the new-match
    /// chooser, so the destination is modelled rather than being a URL.
    private enum StepGo {
        /// The "+ New match" chooser — iOS's door to /upload.
        case newMatch
        case tab(MainTab)
        /// A pushed String route ("learn-videos", "guide:score-keeper", …).
        case route(String)
        case match(MatchRow)
    }

    private struct Step {
        let label: String
        let done: Bool
        /// Falls back to the step's guide until a match exists to point at,
        /// which is what web does with `matchHref ?? "/learn/…"`.
        let go: StepGo?
    }

    private var steps: [Step] {
        let uid = app.userId
        let entries = ownMatches.compactMap { scores.scores[$0.id] }
        let onMatch: (String) -> StepGo = { guideSlug in
            if let ready = latestReady { return .match(ready) }
            return .route("guide:\(guideSlug)")
        }
        return [
            Step(label: "Create your account", done: true, go: nil),
            Step(label: "Upload your first match", done: !ownMatches.isEmpty,
                 go: .newMatch),
            Step(label: "Score a game",
                 done: entries.contains { $0.gamesYou + $0.gamesThem > 0 },
                 go: onMatch("score-keeper")),
            Step(label: "Star a highlight", done: entries.contains(where: \.anyStarred),
                 go: onMatch("score-points")),
            Step(label: "Add a note to a point",
                 done: journal.notes.contains { $0.pointId != nil && $0.authorId == uid },
                 go: onMatch("score-points")),
            Step(label: "Add what you're working on", done: !journal.cues.isEmpty,
                 go: .tab(.journal)),
            Step(label: "Share or export a match", done: homeStore.shareLinksCount > 0,
                 go: onMatch("share-a-link")),
            Step(label: "Share a match with your coach", done: homeStore.coachLinksCount > 0,
                 go: onMatch("invite-a-coach")),
            Step(label: "Watch the tutorial videos", done: app.metadataFlag("tutorial_started"),
                 go: .route("learn-videos")),
        ]
    }


    /// One row of the checklist. Incomplete rows are tappable and carry a
    /// chevron; completed ones are inert text, matching web.
    @ViewBuilder
    private func stepRow(_ step: Step) -> some View {
        let content = HStack(spacing: 12) {
            Image(systemName: step.done ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 18))
                .foregroundStyle(step.done ? PL.cyan : PL.text600)
            Text(step.label)
                .font(.plBody)
                .foregroundStyle(step.done ? PL.text500 : PL.text200)
                .strikethrough(step.done, color: PL.text600)
            Spacer()
            if !step.done, step.go != nil {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PL.text600)
            }
        }
        .padding(.vertical, 9)
        .contentShape(Rectangle())

        if step.done {
            content
        } else {
            switch step.go {
            case .route(let route):
                NavigationLink(value: route) { content }.buttonStyle(.plain)
            case .match(let match):
                NavigationLink(value: match) { content }.buttonStyle(.plain)
            case .newMatch:
                Button { router.newMatchOpen = true } label: { content }
                    .buttonStyle(.plain)
            case .tab(let tab):
                Button { router.tab = tab } label: { content }
                    .buttonStyle(.plain)
            case nil:
                content
            }
        }
    }

    @ViewBuilder
    private var firstSteps: some View {
        let all = steps
        let done = all.filter(\.done).count
        // Coach-only accounts never see it — the steps are a player's. Web
        // excludes them explicitly; iOS gated on own-match count alone, so
        // a coach whose only matches are students' shared ones was told to
        // "Upload your first match" and "Star a highlight".
        let coachOnly = ownMatches.isEmpty && !sharedMatches.isEmpty
        if ownMatches.count < 5, done < all.count, !firstStepsHidden, !coachOnly,
           !app.metadataFlag("first_steps_dismissed"), library.loaded {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    SectionHeading("First steps")
                    Spacer()
                    Text("\(done) of \(all.count)")
                        .font(.plCaption)
                        .monospacedDigit()
                        .foregroundStyle(PL.text500)
                    Button("Hide") {
                        firstStepsHidden = true
                        Task { await app.setMetadataFlag("first_steps_dismissed", true) }
                    }
                    .font(.plCaption)
                    .foregroundStyle(PL.text400)
                    .buttonStyle(.plain)
                }
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(all.enumerated()), id: \.offset) { i, step in
                        stepRow(step)
                        if i < all.count - 1 {
                            Rectangle().fill(PL.edge.opacity(0.4)).frame(height: 1)
                        }
                    }
                    NavigationLink(value: "learn") {
                        HStack(spacing: 4) {
                            Text("Every step has a guide in")
                                .foregroundStyle(PL.text500)
                            Text("Learn")
                                .foregroundStyle(PL.cyan)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(PL.cyan)
                        }
                        .font(.plCaption)
                        .padding(.top, 8)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                .plCard(padding: 16)
            }
        }
    }

    // MARK: - Your game

    @ViewBuilder
    private var yourGame: some View {
        let entries = ownMatches
            .sorted {
                (PGDate.parse($0.playedAt) ?? .distantPast) > (PGDate.parse($1.playedAt) ?? .distantPast)
            }
            .compactMap { scores.scores[$0.id] }
        let full = entries.filter(\.fullyScored)
        let decided = full.filter { $0.won != nil }
        if !full.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    SectionHeading("Your game")
                    Spacer()
                    NavigationLink(value: "stats") {
                        HStack(spacing: 3) {
                            Text("My stats")
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .semibold))
                        }
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(PL.cyan)
                    }
                    .buttonStyle(.plain)
                }
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 12) {
                        HStack(spacing: 5) {
                            ForEach(Array(decided.prefix(10).enumerated()), id: \.offset) { _, entry in
                                Circle()
                                    .fill(entry.won == true ? PL.cyan : PL.magenta)
                                    .frame(width: 9, height: 9)
                            }
                        }
                        Spacer()
                        let wins = decided.filter { $0.won == true }.count
                        (Text("\(wins)–\(decided.count - wins)").foregroundColor(PL.text100)
                            + Text(" matches").foregroundColor(PL.text500))
                            .font(.system(size: 13, weight: .semibold))
                            .monospacedDigit()
                        let gy = full.map(\.gamesYou).reduce(0, +)
                        let gt = full.map(\.gamesThem).reduce(0, +)
                        (Text("\(gy)–\(gt)").foregroundColor(PL.text100)
                            + Text(" games").foregroundColor(PL.text500))
                            .font(.system(size: 13, weight: .semibold))
                            .monospacedDigit()
                    }
                    let served = entries.map(\.served).reduce(0, +)
                    let serveWon = entries.map(\.serveWon).reduce(0, +)
                    let received = entries.map(\.received).reduce(0, +)
                    let receiveWon = entries.map(\.receiveWon).reduce(0, +)
                    if served + received >= 20 {
                        Rectangle().fill(PL.edge.opacity(0.5)).frame(height: 1)
                        HStack(spacing: 20) {
                            if served > 0 {
                                (Text("Serve ").foregroundColor(PL.text400)
                                    + Text("\(Int((Double(serveWon) / Double(served) * 100).rounded()))%").foregroundColor(PL.cyan).fontWeight(.semibold)
                                    + Text("  \(serveWon)/\(served)").foregroundColor(PL.text600))
                                    .font(.system(size: 13))
                                    .monospacedDigit()
                            }
                            if received > 0 {
                                (Text("Receive ").foregroundColor(PL.text400)
                                    + Text("\(Int((Double(receiveWon) / Double(received) * 100).rounded()))%").foregroundColor(PL.cyan).fontWeight(.semibold)
                                    + Text("  \(receiveWon)/\(received)").foregroundColor(PL.text600))
                                    .font(.system(size: 13))
                                    .monospacedDigit()
                            }
                            Spacer()
                        }
                    }
                }
                .plCard(padding: 16)
            }
        }
    }

    // MARK: - Working on

    @ViewBuilder
    private var workingOn: some View {
        if !journal.activeCues.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    SectionHeading("Working on")
                    Spacer()
                    Button {
                        router.tab = .journal
                    } label: {
                        HStack(spacing: 3) {
                            Text("Journal")
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .semibold))
                        }
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(PL.cyan)
                    }
                }
                Button {
                    router.tab = .journal
                } label: {
                    FlowLayout(spacing: 8) {
                        ForEach(journal.activeCues) { cue in
                            HStack(spacing: 7) {
                                Circle().fill(PL.cyan).frame(width: 5, height: 5)
                                Text(cue.label)
                                    .font(.system(size: 13))
                                    .foregroundStyle(PL.text300)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .plCard(padding: 16)
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Latest activity

    @ViewBuilder
    private var latestActivity: some View {
        let recentNotes = journal.notes
            .sorted {
                (PGDate.parse($0.createdAt) ?? .distantPast) > (PGDate.parse($1.createdAt) ?? .distantPast)
            }
            .prefix(2)
        let recentReels = homeStore.reels.prefix(3)
        if !recentNotes.isEmpty || !recentReels.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    SectionHeading("Latest activity")
                    Spacer()
                    Button {
                        router.tab = .journal
                    } label: {
                        HStack(spacing: 3) {
                            Text("Journal")
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .semibold))
                        }
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(PL.cyan)
                    }
                }
                ForEach(Array(recentNotes)) { note in
                    activityRow(note)
                }
                ForEach(Array(recentReels)) { reel in
                    exportRow(reel)
                }
            }
        } else if latestReady != nil, library.loaded {
            Text("Notes you add while reviewing a match collect in your Journal.")
                .font(.plCaption)
                .foregroundStyle(PL.text500)
        }
    }

    // MARK: - Exports in the activity feed

    /// A rendered export rides along under the notes: what it is, then how
    /// it is doing — Rendering, Failed, or its length once ready.
    private func exportRow(_ reel: ReelFeedRow) -> some View {
        let target = library.matches.first { $0.id == reel.matchId }
        return Group {
            if let target {
                NavigationLink(value: target) { exportBody(reel, match: target) }
                    .buttonStyle(.plain)
            } else {
                exportBody(reel, match: nil)
            }
        }
    }

    private func exportBody(_ reel: ReelFeedRow, match: MatchRow?) -> some View {
        let you = (reel.manifest?.youName ?? "").trimmingCharacters(in: .whitespaces)
        let them = (reel.manifest?.themName ?? "").trimmingCharacters(in: .whitespaces)
        let opponent = (match?.opponentName ?? "").trimmingCharacters(in: .whitespaces)
        let base = !you.isEmpty && !them.isEmpty
            ? "\(you) vs \(them)"
            : (!opponent.isEmpty ? "vs \(opponent)" : "Match export")
        let kind = reel.scope == "full" ? "Full match" : "Starred points"
        return VStack(alignment: .leading, spacing: 5) {
            Text("\(base) · \(kind)")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(PL.text200)
                .lineLimit(1)
            HStack(spacing: 0) {
                Text("\(PGDate.shortDate(match?.playedAt ?? reel.updatedAt)) · ")
                    .foregroundStyle(PL.text500)
                if reel.rendering {
                    Text("Rendering…").foregroundStyle(PL.warningText)
                } else if reel.status == "failed" {
                    Text("Failed").foregroundStyle(PL.dangerText)
                } else if let seconds = reel.durationS {
                    Text(Self.fmtDuration(seconds))
                        .monospacedDigit()
                        .foregroundStyle(PL.text500)
                } else {
                    Text("Ready").foregroundStyle(PL.text500)
                }
            }
            .font(.plCaption)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 14)
    }

    private static func fmtDuration(_ seconds: Double) -> String {
        let total = Int(seconds.rounded())
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    private func activityRow(_ note: NoteFeedRow) -> some View {
        let mine = note.authorId == app.userId
        let title = MatchTitle.parts(
            opponentName: note.opponentName, venue: note.venue, playedAt: note.playedAt
        ).primary
        let target = library.matches.first { $0.id == note.matchId }
        return Group {
            if let target {
                NavigationLink(value: target) { activityBody(note, title: title, mine: mine) }
                    .buttonStyle(.plain)
            } else {
                activityBody(note, title: title, mine: mine)
            }
        }
    }

    private func activityBody(_ note: NoteFeedRow, title: String, mine: Bool) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("\(mine ? "You" : (note.authorName ?? "Coach")) · \(title) · \(PGDate.shortDate(note.createdAt))")
                .font(.plCaption)
                .foregroundStyle(PL.text500)
                .lineLimit(1)
            let body = note.body.trimmingCharacters(in: .whitespacesAndNewlines)
            Text(body.isEmpty && note.audioPath != nil ? "Voice note" : body)
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 14)
        .overlay(alignment: .leading) {
            if !mine {
                UnevenRoundedRectangle(topLeadingRadius: PL.rCard, bottomLeadingRadius: PL.rCard)
                    .fill(Color(hex: 0xF0C420).opacity(0.6))
                    .frame(width: 3)
            }
        }
    }

    private func continueEyebrow(for match: MatchRow) -> String {
        // "Score it" asks a practice for the one thing practice removed;
        // its next step is watching, so the card says so. Same word the
        // web hero uses.
        guard MatchTitle.tracksServe(match.matchType) else { return "Review" }
        guard let entry = scores.scores[match.id] else { return "Continue" }
        if entry.unscoredCount > 0 && entry.confirmedCount == 0 { return "Score it" }
        if entry.unscoredCount > 0 { return "Keep scoring" }
        return "Continue"
    }

    private var recentMatches: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                SectionHeading("Recent matches")
                Spacer()
                Button {
                    router.tab = .matches
                } label: {
                    HStack(spacing: 3) {
                        Text("View all")
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .semibold))
                    }
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(PL.cyan)
                }
            }
            VStack(spacing: 10) {
                ForEach(ownMatches.prefix(3)) { match in
                    NavigationLink(value: match) {
                        MatchListRow(
                            match: match,
                            score: scores.scores[match.id],
                            liveJob: library.liveJob(for: match)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}
