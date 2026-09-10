import SwiftUI

/// One coach, and everything between you and them.
///
/// Reached from the coaching feed once it is narrowed to a coach. The
/// coaches list (CoachAccessList) answers "who has what"; this page answers
/// "what about this person", so it reuses that list's parts rather than
/// restating them. CoachSharedWith is the very same view the list opens
/// under every coach, and every write goes through CoachingStore, because a
/// second statement of a sharing rule is a second thing to get wrong.
///
/// The web twin is /coaching/coach/[id] — SharingSection in focus mode with
/// the lessons slotted in between what the coach can see and Manage. Keep
/// the two in step.
struct CoachPageScreen: View {
    let coachRefId: UUID

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @Environment(JournalStore.self) private var journal
    @Environment(CoachingStore.self) private var coaching

    /// The entry being corrected, in its own presentation the way the
    /// journal does it: the composer makes entries and this fixes them.
    private struct EditRequest: Identifiable {
        let id = UUID()
        let lesson: LessonRow
    }

    @State private var lessons: [LessonRow] = []
    @State private var lessonsLoaded = false
    /// Bumped after matches are shared, which remounts the shared list so
    /// it fetches again. Its own reload key is the pair of ids, and those
    /// do not change when the contents do — without this a match queued
    /// against a waiting invite would not appear until the next visit.
    @State private var sharedToken = 0
    @State private var renameOpen = false
    @State private var renameDraft = ""
    @State private var mergeAsk = false
    @State private var removeAsk = false
    @State private var endAccessAsk = false
    @State private var removedOk = false
    @State private var inviteOpen = false
    @State private var busy = false
    @State private var copied = false
    @State private var errorMessage: String?
    @State private var editing: EditRequest?

    private var coach: PlayerCoach? {
        coaching.playerCoaches.first { $0.id == coachRefId }
    }

    private var removeConfirm: CoachActions.Confirm? {
        coach.map {
            CoachActions.removeConfirm(name: $0.displayName, status: $0.status)
        }
    }

    private var endAccessConfirm: CoachActions.Confirm? {
        coach.map { CoachActions.endAccessConfirm(name: $0.displayName) }
    }

    /// Their accepted links, which exist only once an account is behind
    /// them. A coach the player merely wrote down has none, and neither has
    /// one whose invite is still out.
    private var links: [CoachLinkRow] {
        guard let coach, coach.status == "connected", let accountId = coach.coachId else {
            return []
        }
        return coaching.coachLinks.filter {
            $0.coachId == accountId && $0.status == "accepted"
        }
    }

    /// The invite nobody has opened yet.
    private var invite: CoachLinkRow? {
        guard let coach, coach.status == "invited", let inviteId = coach.inviteId else {
            return nil
        }
        return coaching.coachLinks.first { $0.id == inviteId && $0.status == "pending" }
    }

    private var watchesAll: Bool {
        if !links.isEmpty { return links.contains(where: \.watchesAll) }
        if let invite { return invite.watchesAll }
        return false
    }

    /// The matches granted one at a time, which the shared list makes
    /// removable. An invite written from a match page carries its one match
    /// in its own scope rather than in the queue.
    private var matchLinks: [CoachLinkRow] {
        if !links.isEmpty { return links.filter { $0.scopeMatchId != nil } }
        if let invite, invite.scopeMatchId != nil { return [invite] }
        return []
    }

    /// Which rows may fold into this one. Two bound accounts are two
    /// different people and are never offered: folding them would hand one
    /// coach the other's entries. Mirrors mergeCandidates() on the web.
    private var mergeCandidates: [PlayerCoach] {
        guard let coach else { return [] }
        return coaching.playerCoaches.filter {
            $0.id != coach.id && (coach.coachId == nil || $0.coachId == nil)
        }
    }

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Button {
                        dismiss()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Coaching")
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())

                    if let coach {
                        page(coach)
                    } else if coaching.loaded {
                        // Revoking a waiting invite deletes the roster row
                        // outright when no lesson hangs off it (165), so
                        // this page can lose its subject while somebody is
                        // standing on it. Saying so beats a page of nothing.
                        Text("This coach is no longer on your list.")
                            .font(.plBody)
                            .foregroundStyle(PL.text400)
                    } else {
                        placeholder(height: 120)
                    }
                }
                .padding(20)
                .padding(.bottom, 60)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task(id: coachRefId) { await loadLessons() }
        .alert("Rename in your journal", isPresented: $renameOpen) {
            TextField("Their name", text: $renameDraft)
            Button("Save") { rename() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This is the name on every entry you have taken with them. Their own account is not changed.")
        }
        .confirmationDialog(
            "Which coach are they?", isPresented: $mergeAsk, titleVisibility: .visible
        ) {
            ForEach(mergeCandidates) { other in
                Button(other.displayName) { merge(with: other) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your lessons with them come along, and the two become one coach.")
        }
        // Both questions come from CoachActions, so the phone and the web
        // ask the same thing in the same words. "Your lessons keep their
        // name" replaces "Your lessons are kept": what a player is afraid
        // of losing is the name on the card, not the card, and the name is
        // what the database actually promises to keep.
        .confirmationDialog(
            removeConfirm?.title ?? "Remove from your list?",
            isPresented: $removeAsk, titleVisibility: .visible
        ) {
            Button(removeConfirm?.confirmLabel ?? "Remove", role: .destructive) { remove() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(removeConfirm?.body ?? "")
        }
        .confirmationDialog(
            endAccessConfirm?.title ?? "End their access?",
            isPresented: $endAccessAsk, titleVisibility: .visible
        ) {
            Button(endAccessConfirm?.confirmLabel ?? "End access", role: .destructive) {
                endAccess()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(endAccessConfirm?.body ?? "")
        }
        .sheet(isPresented: $inviteOpen) {
            AllMatchesCoachInvite(coachRefId: coachRefId, title: "Send an invite")
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $editing) { request in
            JournalNoteEditor(lesson: request.lesson, store: journal)
                .presentationDetents([.large])
        }
    }

    @ViewBuilder
    private func page(_ coach: PlayerCoach) -> some View {
        Text(coach.displayName)
            .font(.plPageTitle)
            .tracking(-0.6)
            .foregroundStyle(PL.textBody)

        accessCard(coach)
        lessonsSection
        manageSection(coach)

        if let errorMessage {
            Text(errorMessage)
                .font(.plCaption)
                .foregroundStyle(PL.dangerText)
        }
    }

    // MARK: - Status and access

    /// Where they stand, what they can see, and how to change either. One
    /// card, because from the player's side it is one question about one
    /// person; the coaches list builds its row the same way.
    private func accessCard(_ coach: PlayerCoach) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(standing(coach))
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text200)
                if let email = coach.coachEmail {
                    Text(email)
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                        .lineLimit(1)
                }
            }

            // The action this page was missing. A coach the player wrote
            // down, or one they have parted with, had no way to be invited:
            // the composer always started from a blank name, so the only
            // route was typing their name again and hoping the
            // find-or-create matched it. This binds the new link to THIS
            // row by id.
            if CoachActions.canSendInvite(status: coach.status) {
                Button {
                    inviteOpen = true
                } label: {
                    Text("Send an invite")
                        .frame(maxWidth: .infinity, minHeight: 28)
                }
                .buttonStyle(PLPrimaryButtonStyle())
                .disabled(busy)

                // Removal revokes an outstanding invite and Put back does
                // not revive it, so a coach who comes back from the removed
                // list reads "Not on PongLens" with no account of where
                // their link went. This is that account.
                if let note = CoachActions.restoreNotice(status: coach.status),
                   coach.inviteId != nil {
                    Text(note)
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                }
            }

            if let invite {
                inviteActions(invite)
            }

            if !links.isEmpty {
                accessPicker(all: watchesAll) { setAccess(coach, all: $0) }
                Text(watchesAll
                     ? "Watches all your matches, including future uploads."
                     : "Sees only the matches you share with them.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text400)
            } else if let invite, invite.scopeMatchId == nil {
                accessPicker(all: invite.allMatches) { setInviteAccess(invite, all: $0) }
            }

            // Their matches and their journal entries, each line removable.
            // Only for a coach who can actually read something: offering to
            // take an entry back from a name in a notebook would be a
            // control over nothing.
            if !links.isEmpty || invite != nil {
                CoachSharedWith(
                    coachRefId: coach.id,
                    inviteId: invite?.id,
                    matchLinks: matchLinks,
                    allMatches: watchesAll
                )
                .id(sharedToken)

                if !watchesAll {
                    ShareMatchesInline(
                        coachId: links.isEmpty ? nil : coach.coachId,
                        invite: invite,
                        onShared: { sharedToken += 1 }
                    )
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
    }

    /// Their standing in one phrase. These four are the words the coaching
    /// feed's card says on the way in and the words the web says on the
    /// same page, so a coach must never change standing one tap apart.
    private func standing(_ coach: PlayerCoach) -> String {
        switch coach.status {
        case "connected": "Connected"
        case "invited": "Invite waiting"
        case "past": "No longer connected"
        default: "Not on PongLens"
        }
    }

    /// All matches, or only the ones you share. The segmented pair the
    /// coaches list already uses, so two surfaces cannot end up with
    /// different pressed states.
    private func accessPicker(all: Bool, onPick: @escaping (Bool) -> Void) -> some View {
        Picker("Access", selection: Binding(get: { all }, set: { onPick($0) })) {
            Text("All matches").tag(true)
            Text("Only matches I share").tag(false)
        }
        .pickerStyle(.segmented)
        .disabled(busy)
    }

    private func inviteActions(_ invite: CoachLinkRow) -> some View {
        VStack(spacing: 10) {
            if let token = invite.inviteToken {
                Button {
                    UIPasteboard.general.string =
                        "https://www.ponglens.com/coach-invite/\(token)"
                    copied = true
                    Task {
                        try? await Task.sleep(for: .seconds(1.5))
                        copied = false
                    }
                } label: {
                    Text(copied ? "Copied" : "Copy link")
                        .frame(maxWidth: .infinity, minHeight: 28)
                }
                .buttonStyle(PLSecondaryButtonStyle())
            }
            Button {
                revoke(invite)
            } label: {
                Text(busy ? "Revoking…" : "Revoke")
                    .frame(maxWidth: .infinity, minHeight: 28)
            }
            .buttonStyle(PLSoftDestructiveButtonStyle())
            .disabled(busy)
        }
    }

    // MARK: - Lessons

    @ViewBuilder
    private var lessonsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading("Lessons")
            if !lessonsLoaded {
                placeholder(height: 72)
            } else if lessons.isEmpty {
                Text("No lessons with them yet.")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
            } else {
                ForEach(lessons) { row in
                    if let entry = live(row) {
                        if let videoId = row.lessonVideoId {
                            recapRow(entry, videoId: videoId)
                        } else {
                            LessonCardView(lesson: entry, store: journal, onEdit: {
                                editing = EditRequest(lesson: entry)
                            })
                        }
                    }
                }
            }
        }
    }

    /// A filmed lesson, drawn as the recap it is rather than as its
    /// transcript, and opening the recap rather than the words.
    private func recapRow(_ lesson: LessonRow, videoId: UUID) -> some View {
        NavigationLink {
            LessonVideoDetailScreen(id: videoId)
        } label: {
            VStack(alignment: .leading, spacing: 5) {
                Text("LESSON RECAP")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.6)
                    .foregroundStyle(PL.cyan)
                Text(entryTitle(lesson))
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                    .lineLimit(2)
                Text(PGDate.shortDate(lesson.createdAt)
                     + (lesson.sharedWithCoachAt != nil ? " · Shared" : ""))
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .plCard(padding: 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// The distilled title when there is one, else the opening words. The
    /// same fallback the shared list higher up the page uses, so one entry
    /// cannot carry two different names on one screen.
    private func entryTitle(_ lesson: LessonRow) -> String {
        if let title = lesson.takeaways?.title?.trimmingCharacters(in: .whitespaces),
           !title.isEmpty {
            return title
        }
        let words = lesson.transcript
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if words.isEmpty { return "Entry" }
        return words.count > 64 ? String(words.prefix(64)) + "…" : words
    }

    /// The journal store's copy of an entry, which is what the card writes
    /// back to. This page's own list is a snapshot: without this an entry
    /// edited or deleted on the card here would keep drawing the words it
    /// was fetched with until the next visit.
    private func live(_ row: LessonRow) -> LessonRow? {
        guard journal.loaded else { return row }
        return journal.lessons.first { $0.id == row.id }
    }

    // MARK: - Manage

    private func manageSection(_ coach: PlayerCoach) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading("Manage")

            Button {
                renameDraft = coach.displayName
                renameOpen = true
            } label: {
                Text("Rename in your journal")
                    .frame(maxWidth: .infinity, minHeight: 28)
            }
            .buttonStyle(PLSecondaryButtonStyle())
            .disabled(busy)

            if !mergeCandidates.isEmpty {
                Button {
                    mergeAsk = true
                } label: {
                    Text("Same as an existing coach")
                        .frame(maxWidth: .infinity, minHeight: 28)
                }
                .buttonStyle(PLSecondaryButtonStyle())
                .disabled(busy)
            }

            // Ending access is not removal and the two cannot both be
            // called Remove. This one stops them watching and keeps them on
            // the list; the one below takes them off it.
            if CoachActions.canEndAccess(status: coach.status) {
                Button {
                    endAccessAsk = true
                } label: {
                    Text("End their access")
                        .frame(maxWidth: .infinity, minHeight: 28)
                }
                .buttonStyle(PLSecondaryButtonStyle())
                .disabled(busy)
            }

            // Every standing, with no gate. Until 2026-09-10 this was wired
            // to leave_coach and so hidden for a coach the player had only
            // written down, which made that row permanent.
            Button {
                removeAsk = true
            } label: {
                Text(busy ? "Removing…" : "Remove from your list")
                    .frame(maxWidth: .infinity, minHeight: 28)
            }
            .buttonStyle(PLSoftDestructiveButtonStyle())
            .disabled(busy)
        }
    }

    private func placeholder(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
            .fill(PL.surface)
            .frame(height: height)
            .opacity(0.6)
    }

    // MARK: - Actions

    private func loadLessons() async {
        lessons = await coaching.lessonsWith(coachRefId: coachRefId)
        lessonsLoaded = true
    }

    private func setAccess(_ coach: PlayerCoach, all: Bool) {
        guard let uid = app.userId, let accountId = coach.coachId, watchesAll != all else {
            return
        }
        busy = true
        errorMessage = nil
        Task {
            if await coaching.setAccess(
                userId: uid, coachId: accountId, allMatches: all
            ) == false {
                errorMessage = "Couldn't change it. Try again."
            }
            busy = false
        }
    }

    private func setInviteAccess(_ invite: CoachLinkRow, all: Bool) {
        guard let uid = app.userId, invite.allMatches != all else { return }
        busy = true
        errorMessage = nil
        Task {
            if await coaching.setInviteAccess(
                userId: uid, inviteId: invite.id, allMatches: all
            ) == false {
                errorMessage = "Couldn't change it. Try again."
            }
            busy = false
        }
    }

    private func revoke(_ invite: CoachLinkRow) {
        busy = true
        errorMessage = nil
        Task {
            await coaching.revokeLink(invite)
            // revokeLink drops the link but leaves the roster untouched,
            // and revoking an invite can delete that row outright (165) —
            // so the standing at the top of this page has to be read again.
            await coaching.load(userId: app.userId)
            busy = false
        }
    }

    private func rename() {
        guard let uid = app.userId else { return }
        let name = renameDraft
        busy = true
        errorMessage = nil
        Task {
            if await coaching.renameCoach(
                userId: uid, coachRefId: coachRefId, name: name
            ) {
                // A trigger stamps the new name onto every entry taken with
                // them, so both lists holding those entries are stale the
                // moment it lands — this page's, and the journal one tab
                // away.
                await loadLessons()
                await journal.load(userId: uid)
            } else {
                errorMessage = "Couldn't rename them. Try again."
            }
            busy = false
        }
    }

    private func merge(with other: PlayerCoach) {
        guard let uid = app.userId else { return }
        busy = true
        errorMessage = nil
        Task {
            if await coaching.mergeCoaches(
                userId: uid, into: coachRefId, from: other.id
            ) {
                // The other coach's entries are now these, under this name.
                await loadLessons()
                await journal.load(userId: uid)
            } else {
                errorMessage = "Couldn't join them up. Try again."
            }
            busy = false
        }
    }

    /// Stop them watching, and keep them on the list.
    ///
    /// One call ends the lot: leave_coach revokes every link with them and
    /// clears the roster binding, so the entries they were reading stop as
    /// well as the matches. Since 2026-09-10 it no longer removes the row
    /// as a side effect, which is why this and Remove are separate buttons.
    private func endAccess() {
        guard let link = links.first else { return }
        busy = true
        errorMessage = nil
        Task {
            await coaching.revokeLink(link)
            await coaching.reloadCoaches()
            busy = false
        }
    }

    /// Take them off the list, whatever their standing.
    ///
    /// Archives rather than deletes, and pops back to the roster because
    /// that is where Put back is. Both stores hold their own copy of the
    /// coach list, so both are reloaded: refreshing one leaves a removed
    /// coach sitting in the lesson picker.
    private func remove() {
        busy = true
        errorMessage = nil
        Task {
            let ok = await coaching.removeCoach(coachRefId)
            busy = false
            guard ok else {
                errorMessage = "Couldn't remove them. Try again."
                return
            }
            await journal.loadCoaches()
            dismiss()
        }
    }
}

/// Share several matches with one coach at once.
///
/// The match page's sheet answers "who should have THIS match?", one coach
/// at a time. Standing on a coach's page the question is the other way
/// round — "which of my matches should Jonathan have?" — and answering it
/// there means walking the library and opening a sheet on every row. The
/// web twin is ShareMatches.tsx.
///
/// Nothing new is written. The store makes the same grant the sheet makes:
/// an accepted, match-scoped link for a coach who has joined, a queued row
/// for one who has not (166). Matches they already hold are left out of the
/// list rather than offered twice.
private struct ShareMatchesInline: View {
    /// Their account, when they have accepted.
    let coachId: UUID?
    /// Their waiting invite, when they have not.
    let invite: CoachLinkRow?
    let onShared: () -> Void

    @Environment(AppState.self) private var app
    @Environment(LibraryStore.self) private var library
    @Environment(CoachingStore.self) private var coaching

    @State private var queued: Set<UUID> = []
    @State private var open = false
    @State private var showAll = false
    @State private var picked: Set<UUID> = []
    @State private var saving = false
    @State private var errorMessage: String?

    /// How many rows before the list folds. Six fits a phone under the list
    /// it sits below; the rest are one tap away.
    private let preview = 6

    /// The player's own matches, newest first. A match still being
    /// processed has nothing to watch yet, so offering it would hand the
    /// coach an empty page.
    private var mine: [MatchRow] {
        guard let uid = app.userId else { return [] }
        return library.matches
            .filter { $0.userId == uid && $0.status == .ready }
            .sorted {
                (PGDate.parse($0.playedAt) ?? .distantPast)
                    > (PGDate.parse($1.playedAt) ?? .distantPast)
            }
    }

    /// What they already have: the matches granted to their account, the
    /// ones queued against their invite, and the single match an invite
    /// written from a match page carries in its own scope. That last one
    /// matters — the queue's key is (invite, match), so offering it again
    /// would fail the insert and lose every other pick with it.
    private var held: Set<UUID> {
        var out = Set(
            coaching.coachLinks
                .filter { $0.coachId != nil && $0.coachId == coachId && $0.status == "accepted" }
                .compactMap(\.scopeMatchId)
        )
        out.formUnion(queued)
        if let scoped = invite?.scopeMatchId { out.insert(scoped) }
        return out
    }

    var body: some View {
        let available = mine.filter { !held.contains($0.id) }
        VStack(alignment: .leading, spacing: 12) {
            if available.isEmpty {
                Text(mine.isEmpty ? "No matches to share yet." : "They have all your matches.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            } else if open {
                picker(available)
            } else {
                Button {
                    open = true
                } label: {
                    Text("Share a match")
                        .frame(maxWidth: .infinity, minHeight: 28)
                }
                .buttonStyle(PLSecondaryButtonStyle())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: invite?.id) { await loadQueued() }
    }

    @ViewBuilder
    private func picker(_ available: [MatchRow]) -> some View {
        if invite != nil {
            Text("They get these the moment they accept your invite.")
                .font(.plCaption)
                .foregroundStyle(PL.text400)
        }

        let shown = showAll ? available : Array(available.prefix(preview))
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(shown.enumerated()), id: \.element.id) { i, match in
                matchRow(match)
                if i < shown.count - 1 {
                    Rectangle().fill(PL.edge.opacity(0.5)).frame(height: 1)
                }
            }
        }
        .plInnerRow(padding: 0)

        if available.count > preview {
            Button(showAll ? "Show fewer" : "Show all \(available.count) matches") {
                showAll.toggle()
            }
            .buttonStyle(PLSecondaryButtonStyle())
        }

        Text(picked.isEmpty
             ? "Nothing selected."
             : "\(picked.count) \(picked.count == 1 ? "match" : "matches") selected.")
            .font(.plCaption)
            .foregroundStyle(PL.text400)

        Button {
            share()
        } label: {
            Text(saving ? "Sharing…" : "Share")
                .frame(maxWidth: .infinity, minHeight: 28)
        }
        .buttonStyle(PLPrimaryButtonStyle())
        .disabled(saving || picked.isEmpty)

        Button {
            open = false
            picked = []
            errorMessage = nil
        } label: {
            Text("Cancel")
                .frame(maxWidth: .infinity, minHeight: 28)
        }
        .buttonStyle(PLSecondaryButtonStyle())
        .disabled(saving)

        if let errorMessage {
            Text(errorMessage)
                .font(.plCaption)
                .foregroundStyle(PL.dangerText)
        }
    }

    private func matchRow(_ match: MatchRow) -> some View {
        let on = picked.contains(match.id)
        let parts = MatchTitle.parts(
            opponentName: match.opponentName, venue: match.venue, playedAt: match.playedAt
        )
        return Button {
            if on { picked.remove(match.id) } else { picked.insert(match.id) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(on ? PL.cyan : PL.text600)
                VStack(alignment: .leading, spacing: 2) {
                    Text(parts.primary)
                        .font(.plBody)
                        .foregroundStyle(PL.text100)
                        .lineLimit(1)
                    Text(parts.secondary)
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(saving)
    }

    /// The queued matches, read the same way the shared list reads them.
    /// Asking for no coach row keeps this to the queue itself.
    private func loadQueued() async {
        guard let inviteId = invite?.id else {
            queued = []
            return
        }
        let rows = await coaching.sharedWith(coachRefId: nil, inviteId: inviteId)
        queued = Set(rows.compactMap { $0.kind == .queuedMatch ? $0.matchId : nil })
    }

    private func share() {
        guard let uid = app.userId, !picked.isEmpty else { return }
        let ids = Array(picked)
        saving = true
        errorMessage = nil
        Task {
            let ok = await coaching.shareMatches(
                userId: uid, coachId: coachId, inviteId: invite?.id, matchIds: ids
            )
            if ok {
                picked = []
                open = false
                await loadQueued()
                onShared()
            } else {
                errorMessage = ids.count == 1
                    ? "Couldn't share it. Try again."
                    : "Couldn't share them. Try again."
            }
            saving = false
        }
    }
}
