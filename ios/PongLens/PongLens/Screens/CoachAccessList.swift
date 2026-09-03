import SwiftUI

/// The player's coaches, modelled as PEOPLE, not links, the way the web's
/// Coaches section is: one card per accepted coach, no matter how many
/// coach_links back it. Each card carries the coach's access — all
/// matches, or only the ones shared from a match page — switchable either
/// way without removing them (161), the per-match shares, and Remove
/// coach. Invites nobody has opened yet follow, with their link.
///
/// Used by the Coaching tab and by Account's Manage sheet, so the rule
/// lives once on this platform.
struct CoachAccessList: View {
    @Environment(AppState.self) private var app
    @Environment(CoachingStore.self) private var coaching
    @Environment(LibraryStore.self) private var library

    @State private var busyCoach: UUID?

    private struct CoachGroup: Identifiable {
        let id: UUID
        let name: String
        let email: String?
        let links: [CoachLinkRow]
        var watchesAll: Bool { links.contains { $0.watchesAll } }
        var matchLinks: [CoachLinkRow] { links.filter { $0.scopeMatchId != nil } }
    }

    private var groups: [CoachGroup] {
        var byCoach: [UUID: [CoachLinkRow]] = [:]
        for link in coaching.coachLinks where link.status == "accepted" {
            guard let coachId = link.coachId else { continue }
            byCoach[coachId, default: []].append(link)
        }
        return byCoach.map { coachId, links in
            CoachGroup(
                id: coachId,
                name: links.compactMap(\.coachName).first
                    ?? links.compactMap(\.coachEmail).first
                    ?? "Coach",
                email: links.compactMap(\.coachEmail).first,
                links: links
            )
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private var pending: [CoachLinkRow] {
        coaching.coachLinks.filter { $0.status == "pending" && $0.coachId == nil }
    }

    var body: some View {
        VStack(spacing: 10) {
            ForEach(groups) { group in
                coachCard(group)
            }
            ForEach(pending) { link in
                pendingRow(link)
            }
        }
    }

    private func matchTitle(_ id: UUID) -> String {
        guard let match = library.matches.first(where: { $0.id == id }) else { return "Match" }
        if let opponent = match.opponentName, !opponent.isEmpty { return "vs \(opponent)" }
        if let name = match.originalName, !name.isEmpty { return name }
        return match.matchType == "practice" ? "Practice" : "Match"
    }

    private func setAccess(_ group: CoachGroup, all: Bool) {
        guard let uid = app.userId, group.watchesAll != all else { return }
        busyCoach = group.id
        Task {
            _ = await coaching.setAccess(userId: uid, coachId: group.id, allMatches: all)
            busyCoach = nil
        }
    }

    private func coachCard(_ group: CoachGroup) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(group.name)
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                if let email = group.email {
                    Text(email)
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                        .lineLimit(1)
                }
            }

            Picker("Access", selection: Binding(
                get: { group.watchesAll },
                set: { setAccess(group, all: $0) }
            )) {
                Text("All matches").tag(true)
                Text("Only matches I share").tag(false)
            }
            .pickerStyle(.segmented)
            .disabled(busyCoach == group.id)

            Text(group.watchesAll
                 ? "Watches all your matches, including future uploads."
                 : group.matchLinks.isEmpty
                    ? "Sees only the matches you share with them from a match page. Nothing shared yet."
                    : "Sees only the matches you share with them from a match page.")
                .font(.plCaption)
                .foregroundStyle(PL.text400)

            if !group.watchesAll && !group.matchLinks.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(group.matchLinks.enumerated()), id: \.element.id) { i, link in
                        HStack {
                            Text(link.scopeMatchId.map(matchTitle) ?? "Match")
                                .font(.system(size: 15))
                                .foregroundStyle(PL.text200)
                                .lineLimit(1)
                            Spacer()
                            Button("Remove") {
                                Task { await coaching.revokeLink(link, onlyThis: true) }
                            }
                            .buttonStyle(PLSoftDestructiveButtonStyle())
                        }
                        .padding(.vertical, 8)
                        if i < group.matchLinks.count - 1 {
                            Rectangle().fill(PL.edge.opacity(0.5)).frame(height: 1)
                        }
                    }
                }
            }

            Button("Remove coach") {
                if let first = group.links.first {
                    Task { await coaching.revokeLink(first) }
                }
            }
            .buttonStyle(PLSoftDestructiveButtonStyle())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plInnerRow()
    }

    private func pendingRow(_ link: CoachLinkRow) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Invite pending")
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                Text(link.scopeMatchId != nil
                     ? "One match"
                     : link.allMatches ? "All matches" : "Only matches you share")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            Spacer()
            if let token = link.inviteToken,
               let url = URL(string: "https://www.ponglens.com/coach-invite/\(token)") {
                ShareLink(item: url) {
                    Text("Copy link")
                        .font(.plButtonSecondary)
                        .foregroundStyle(PL.text300)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                }
            }
            Button("Remove") {
                Task { await coaching.revokeLink(link) }
            }
            .buttonStyle(PLSoftDestructiveButtonStyle())
        }
        .plInnerRow()
    }
}
