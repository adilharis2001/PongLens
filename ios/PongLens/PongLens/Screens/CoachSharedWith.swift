import SwiftUI

/// "What they can see" — everything one coach holds of yours, each line
/// removable (Adil, 2026-09-04).
///
/// The web twin is src/components/CoachSharedWith.tsx; keep them in step.
/// Before this, the phone listed the matches shared with a CONNECTED coach
/// and nothing else: the journal was invisible on both platforms, and an
/// invited coach's whole head start — the matches queued against the
/// invite (166) and the entries moved to them — could not be seen at all
/// from the moment the link was sent.
///
/// Entries that are attributed but NOT granted are shown too, offering
/// Share rather than being hidden. Moving an entry to a coach and letting
/// them read it are two separate things, and hiding the ungranted ones
/// would leave this list saying "nothing" while the journal carries the
/// coach's name — the contradiction one tap apart that this whole view
/// exists to remove. It is also the honest answer to "why can't my coach
/// see the journal I sent them".
struct CoachSharedWith: View {
    @Environment(CoachingStore.self) private var coaching
    @Environment(LibraryStore.self) private var library

    /// The player_coaches row, which is what entries hang off.
    let coachRefId: UUID?
    /// A waiting invite, whose queued matches count as "when they accept".
    let inviteId: UUID?
    /// Matches already granted, which the caller is holding anyway.
    let matchLinks: [CoachLinkRow]
    /// They see every match, so there are no individual ones to take back.
    let allMatches: Bool

    @State private var extras: [CoachShare] = []
    @State private var busy: String?
    @State private var loaded = false

    private func matchTitle(_ id: UUID) -> String {
        guard let match = library.matches.first(where: { $0.id == id }) else { return "Match" }
        if let opponent = match.opponentName, !opponent.isEmpty { return "vs \(opponent)" }
        if let name = match.originalName, !name.isEmpty { return name }
        return match.matchType == "practice" ? "Practice" : "Match"
    }

    private var rows: [CoachShare] {
        var out: [CoachShare] = []
        if !allMatches {
            for link in matchLinks {
                guard let matchId = link.scopeMatchId else { continue }
                out.append(CoachShare(
                    id: link.id.uuidString, kind: .match,
                    title: matchTitle(matchId), linkId: link.id, matchId: matchId
                ))
            }
            for share in extras where share.kind == .queuedMatch {
                guard let matchId = share.matchId else { continue }
                out.append(CoachShare(
                    id: share.id, kind: .queuedMatch,
                    title: matchTitle(matchId), linkId: nil, matchId: matchId
                ))
            }
        }
        out.append(contentsOf: extras.filter { $0.kind == .entry || $0.kind == .unsharedEntry })
        return out
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !loaded || (allMatches && rows.isEmpty) {
                // A coach on "all matches" is told so by the line right
                // above this. Saying it again here would print one
                // sentence twice, two lines apart.
                EmptyView()
            } else if rows.isEmpty {
                Text("You haven't shared anything with them yet.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            } else {
                Text(allMatches ? "JOURNAL SHARED WITH THEM" : "WHAT THEY CAN SEE")
                    .font(.plSection)
                    .tracking(0.6)
                    .foregroundStyle(PL.text500)
                    .padding(.bottom, 6)

                ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
                    line(row)
                    if i < rows.count - 1 {
                        Rectangle().fill(PL.edge.opacity(0.5)).frame(height: 1)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: reloadKey) { await reload() }
    }

    /// Refetch when the coach changes, never on every redraw.
    private var reloadKey: String {
        "\(coachRefId?.uuidString ?? "-"):\(inviteId?.uuidString ?? "-")"
    }

    private func reload() async {
        extras = await coaching.sharedWith(coachRefId: coachRefId, inviteId: inviteId)
        loaded = true
    }

    private func line(_ row: CoachShare) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text(row.title)
                    .font(.system(size: 15))
                    .foregroundStyle(PL.text200)
                    .lineLimit(1)
                if let sub = subtitle(row) {
                    Text(sub)
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if row.kind == .unsharedEntry {
                Button(busy == row.id ? "Sharing…" : "Share") {
                    act(row) { await coaching.setEntryShared(UUID(uuidString: row.id) ?? UUID(), shared: true) }
                }
                .buttonStyle(PLCyanGhostButtonStyle())
                .disabled(busy == row.id)
            } else {
                Button(busy == row.id ? "Removing…" : "Remove") { remove(row) }
                    .buttonStyle(PLSoftDestructiveButtonStyle())
                    .disabled(busy == row.id)
            }
        }
        .padding(.vertical, 8)
    }

    private func subtitle(_ row: CoachShare) -> String? {
        switch row.kind {
        case .match: return nil
        case .queuedMatch: return "When they accept"
        case .entry: return "Journal entry"
        case .unsharedEntry: return "Journal entry · not shared yet"
        }
    }

    private func remove(_ row: CoachShare) {
        switch row.kind {
        case .match:
            guard let link = matchLinks.first(where: { $0.id == row.linkId }) else { return }
            act(row) { await coaching.revokeLink(link, onlyThis: true); return true }
        case .queuedMatch:
            guard let inviteId, let matchId = row.matchId else { return }
            act(row) { await coaching.unqueueMatch(inviteId: inviteId, matchId: matchId) }
        case .entry, .unsharedEntry:
            guard let id = UUID(uuidString: row.id) else { return }
            act(row) { await coaching.setEntryShared(id, shared: false) }
        }
    }

    private func act(_ row: CoachShare, _ work: @escaping () async -> Bool) {
        busy = row.id
        Task {
            _ = await work()
            // revokeLink already drops the row from coaching.coachLinks,
            // so the granted matches shrink on their own; this refetch is
            // for the queued matches and the entries, which are ours.
            await reload()
            busy = nil
        }
    }
}
