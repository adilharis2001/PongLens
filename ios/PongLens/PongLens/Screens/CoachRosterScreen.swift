import SwiftUI

/// Where the roster is pushed from. Declared beside CoachPageRoute and
/// registered in MainTabView, deliberately NOT in AppRouteDestination: that
/// registrar is shared with the coach workspace root, and a player roster
/// resolving inside coach mode is the same class of bug as the territory
/// one that has been fixed twice.
struct CoachRosterRoute: Hashable {}

/// Every coach the player has, in one list.
///
/// Built on `player_coaches_list()`, not on coach_links, and that is the
/// whole point. The old web list was links: accepted grants plus pending
/// invites. A coach the player had only written down while filing a lesson
/// has neither, so that coach appeared nowhere on the page that is supposed
/// to be the list of coaches. The phone had no such page at all.
///
/// In the Coaching tab's grammar rather than a Form, because that is what
/// this is a part of.
struct CoachRosterScreen: View {
    @Environment(AppState.self) private var app
    @Environment(CoachingStore.self) private var coaching
    @Environment(JournalStore.self) private var journal
    @Environment(\.dismiss) private var dismiss

    @State private var inviteOpen = false
    @State private var showRemoved = false
    @State private var busy: UUID?
    @State private var message: String?

    private var unnamedInvites: [CoachLinkRow] {
        let named = Set(coaching.playerCoaches.compactMap(\.inviteId))
        return coaching.coachLinks.filter {
            $0.status == "pending" && !named.contains($0.id)
        }
    }

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Button {
                        dismiss()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 13, weight: .semibold))
                            Text("Coaching")
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())

                    Text("Your coaches")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    // The label is sized before the style is applied, so
                    // the visible button and its hit area both fill the row.
                    Button {
                        inviteOpen = true
                    } label: {
                        Text("Add a coach")
                            .frame(maxWidth: .infinity, minHeight: 28)
                    }
                    .buttonStyle(PLPrimaryButtonStyle())

                    if coaching.playerCoaches.isEmpty && unnamedInvites.isEmpty {
                        Text("No coaches yet.")
                            .font(.plBody)
                            .foregroundStyle(PL.text500)
                    }

                    ForEach(sortedCoaches) { coach in
                        NavigationLink(value: CoachPageRoute(coachRefId: coach.id)) {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(coach.displayName)
                                        .font(.plCardTitle)
                                        .foregroundStyle(PL.text100)
                                    Text(CoachActions.standingWords(coach.status))
                                        .font(.plCaption)
                                        .foregroundStyle(PL.text500)
                                }
                                Spacer(minLength: 8)
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

                    // Links nobody named. Before this screen they were
                    // invisible on the phone entirely, so a link sent and
                    // not saved was gone for good. Copy link is on the row
                    // for exactly that reason.
                    ForEach(unnamedInvites) { invite in
                        UnnamedInviteCard(invite: invite)
                    }

                    if !coaching.archivedCoaches.isEmpty {
                        Button {
                            showRemoved.toggle()
                        } label: {
                            HStack {
                                Text("Removed coaches")
                                    .font(.plRowTitle)
                                    .foregroundStyle(PL.text300)
                                Spacer()
                                Text("\(coaching.archivedCoaches.count)")
                                    .font(.plCaption)
                                    .foregroundStyle(PL.text500)
                                Image(systemName: showRemoved ? "chevron.up" : "chevron.down")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(PL.text500)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .plCard(padding: 16)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)

                        if showRemoved {
                            ForEach(coaching.archivedCoaches) { coach in
                                HStack(spacing: 12) {
                                    Text(coach.displayName)
                                        .font(.plBody)
                                        .foregroundStyle(PL.text400)
                                    Spacer(minLength: 8)
                                    Button {
                                        putBack(coach)
                                    } label: {
                                        Text(busy == coach.id ? "Putting back…" : "Put back")
                                    }
                                    .buttonStyle(PLSecondaryButtonStyle())
                                    .disabled(busy != nil)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .plCard(padding: 16)
                            }
                        }
                    }

                    if let message {
                        Text(message)
                            .font(.plCaption)
                            .foregroundStyle(PL.text400)
                    }
                }
                .padding(20)
                .padding(.bottom, 60)
            }
        }
        .navigationBarBackButtonHidden(true)
        .task {
            await coaching.reloadCoaches()
            await coaching.loadArchivedCoaches()
        }
        .sheet(isPresented: $inviteOpen) {
            AllMatchesCoachInvite(title: "Add a coach")
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    private var sortedCoaches: [PlayerCoach] {
        coaching.playerCoaches.sorted { a, b in
            let rank = ["connected": 0, "invited": 1, "offline": 2, "past": 3]
            let ra = rank[a.status] ?? 4
            let rb = rank[b.status] ?? 4
            if ra != rb { return ra < rb }
            return a.displayName.localizedCaseInsensitiveCompare(b.displayName)
                == .orderedAscending
        }
    }

    private func putBack(_ coach: PlayerCoach) {
        busy = coach.id
        message = nil
        Task {
            let outcome = await coaching.restoreCoach(coach.id)
            busy = nil
            switch outcome {
            case "merged":
                message = "Their lessons moved onto the coach already on your list."
            case nil:
                message = "Couldn't put them back. Try again."
            default:
                break
            }
            await journal.loadCoaches()
        }
    }
}

/// One pending link with nobody's name on it.
private struct UnnamedInviteCard: View {
    let invite: CoachLinkRow

    @Environment(CoachingStore.self) private var coaching
    @State private var copied = false
    @State private var busy = false

    private var url: URL? {
        guard let token = invite.inviteToken else { return nil }
        return URL(string: "https://www.ponglens.com/coach-invite/\(token)")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Unnamed invite")
                .font(.plCardTitle)
                .foregroundStyle(PL.text500)
            Text("Invite waiting")
                .font(.plCaption)
                .foregroundStyle(PL.text500)

            if let url {
                Button {
                    UIPasteboard.general.string = url.absoluteString
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
                busy = true
                Task {
                    await coaching.revokeLink(invite)
                    await coaching.reloadCoaches()
                    busy = false
                }
            } label: {
                Text(busy ? "Revoking…" : "Revoke")
                    .frame(maxWidth: .infinity, minHeight: 28)
            }
            .buttonStyle(PLSoftDestructiveButtonStyle())
            .disabled(busy)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
    }
}
