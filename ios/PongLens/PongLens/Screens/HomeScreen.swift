import SwiftUI

struct HomeScreen: View {
    @Environment(AppState.self) private var app
    @Environment(Router.self) private var router
    @Environment(LibraryStore.self) private var library
    @Environment(MediaStore.self) private var media
    @Environment(ScoresStore.self) private var scores
    @Environment(JournalStore.self) private var journal
    @State private var homeStore = HomeStore()
    @State private var firstStepsHidden = false

    private var ownMatches: [MatchRow] {
        guard let uid = app.userId else { return [] }
        return library.matches.filter { $0.userId == uid }
    }

    private var latestReady: MatchRow? {
        ownMatches.first { $0.status == .ready }
    }

    private var processingCount: Int {
        ownMatches.filter { $0.status == .processing }.count + library.activeJobs.count
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

            PLFab(label: "Upload", systemImage: "tray.and.arrow.up") { router.uploadOpen = true }
                .padding(20)
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
        } else if ownMatches.isEmpty && library.activeJobs.isEmpty {
            VStack(spacing: 12) {
                Text("🏓").font(.system(size: 40))
                Text("Upload your first match")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Text("PongLens cuts the dead time out of your footage and breaks the match into points, so you can review it point by point and add notes for yourself or a coach.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                Button("Upload a match") { router.uploadOpen = true }
                    .buttonStyle(PLPrimaryButtonStyle())
                    .padding(.top, 8)
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
                    MatchThumb(url: media.thumbURL(match.id))
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

    private struct Step {
        let label: String
        let done: Bool
    }

    private var steps: [Step] {
        let uid = app.userId
        let entries = ownMatches.compactMap { scores.scores[$0.id] }
        return [
            Step(label: "Create your account", done: true),
            Step(label: "Upload your first match", done: !ownMatches.isEmpty),
            Step(label: "Score a game", done: entries.contains { $0.gamesYou + $0.gamesThem > 0 }),
            Step(label: "Star a highlight", done: entries.contains(where: \.anyStarred)),
            Step(label: "Add a note to a point", done: journal.notes.contains { $0.pointId != nil && $0.authorId == uid }),
            Step(label: "Add what you're working on", done: !journal.cues.isEmpty),
            Step(label: "Share or export a match", done: homeStore.shareLinksCount > 0),
            Step(label: "Share a match with your coach", done: homeStore.coachLinksCount > 0),
            Step(label: "Watch the tutorial videos", done: app.metadataFlag("tutorial_started")),
        ]
    }

    @ViewBuilder
    private var firstSteps: some View {
        let all = steps
        let done = all.filter(\.done).count
        if ownMatches.count < 5, done < all.count, !firstStepsHidden,
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
                        HStack(spacing: 12) {
                            Image(systemName: step.done ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 18))
                                .foregroundStyle(step.done ? PL.cyan : PL.text600)
                            Text(step.label)
                                .font(.plBody)
                                .foregroundStyle(step.done ? PL.text500 : PL.text200)
                                .strikethrough(step.done, color: PL.text600)
                            Spacer()
                        }
                        .padding(.vertical, 9)
                        if i < all.count - 1 {
                            Rectangle().fill(PL.edge.opacity(0.4)).frame(height: 1)
                        }
                    }
                    Text("Every step has a guide in Learn.")
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                        .padding(.top, 8)
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
                    Button {
                        router.tab = .home // stats screen comes with its tab-less push
                    } label: {
                        HStack(spacing: 3) {
                            Text("My stats")
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .semibold))
                        }
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(PL.cyan)
                    }
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
        if !recentNotes.isEmpty {
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
            }
        } else if latestReady != nil, library.loaded {
            Text("Notes you add while reviewing a match collect in your Journal.")
                .font(.plCaption)
                .foregroundStyle(PL.text500)
        }
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
            Text(note.body)
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
                            thumbURL: media.thumbURL(match.id),
                            score: scores.scores[match.id]
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}
