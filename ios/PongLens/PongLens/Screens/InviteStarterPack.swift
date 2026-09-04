import SwiftUI
import Supabase

/// What a coach finds waiting the day they accept (169).
///
/// An invite used to hand over an empty room: the coach signed in and saw
/// a name. Everything the player had already recorded — matches they had
/// scored, lessons they had written up — was there the whole time and
/// nobody was shown it. The moment you invite somebody is the one point
/// in the flow where you are already thinking about that person, so it is
/// the cheapest place to ask.
///
/// Nothing here grants anything on its own. Matches become
/// coach_invite_matches rows, which the accept turns into real shares
/// (166); entries are attributed to the coach's row and marked shared,
/// which student_shared_lessons only honours once there is an accepted
/// link. Revoke the invite and all of it goes with it.
///
/// The web twin is src/components/InviteStarterPack.tsx.

struct StarterMatch: Identifiable, Hashable {
    let id: UUID
    let title: String
    let subtitle: String
    let score: MatchScoreChip?
}

struct StarterEntry: Identifiable, Hashable {
    let id: UUID
    let title: String
    let subtitle: String
    /// Already attributed to a DIFFERENT coach, so it cannot move. An
    /// entry records who taught it, and that is one person.
    let takenBy: String?
}

@MainActor
@Observable
final class StarterPackStore {
    var matches: [StarterMatch] = []
    var entries: [StarterEntry] = []
    var pickedMatches: Set<UUID> = []
    var pickedEntries: Set<UUID> = []
    var loaded = false

    private static let limit = 10

    func load(userId: UUID, library: [MatchRow]) async {
        // Matches come from the library the app already holds, so this
        // costs one query for the scores rather than a second listing.
        let recent = library
            .filter { $0.userId == userId && $0.status == .ready }
            .sorted { $0.playedAt > $1.playedAt }
            .prefix(Self.limit)
        let scores = await CoachMatchScores.load(matchIds: recent.map(\.id))
        matches = recent.map { m in
            StarterMatch(
                id: m.id,
                title: m.opponentName.map { "vs \($0)" }
                    ?? m.originalName
                    ?? (m.matchType == "practice" ? "Practice" : "Match"),
                subtitle: [PGDate.shortDate(m.playedAt), m.venue]
                    .compactMap { $0 }
                    .filter { !$0.isEmpty }
                    .joined(separator: " · "),
                score: scores[m.id]
            )
        }

        struct LessonLite: Decodable {
            let id: UUID
            let transcript: String
            let takeaways: LessonTakeaways?
            let created_at: String
            let coach_ref_id: UUID?
        }
        let rows: [LessonLite]? = try? await supa
            .from("lessons")
            .select("id,transcript,takeaways,created_at,coach_ref_id")
            .neq("kind", value: "coach")
            .order("created_at", ascending: false)
            .limit(Self.limit)
            .execute().value
        let coaches: [PlayerCoach]? = try? await supa
            .rpc("player_coaches_list").execute().value
        let names = Dictionary(
            (coaches ?? []).map { ($0.id, $0.displayName) },
            uniquingKeysWith: { a, _ in a }
        )
        entries = (rows ?? []).map { l in
            let words = l.transcript
                .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces)
            // The distilled title when there is one, else the opening
            // words — the same rule the journal's own cards use.
            let distilled = l.takeaways?.title?.trimmingCharacters(in: .whitespaces)
            let opening = words.count > 60 ? String(words.prefix(60)) + "…" : words
            let name = (distilled?.isEmpty == false ? distilled! : opening)
            return StarterEntry(
                id: l.id,
                title: name.isEmpty ? "Entry" : name,
                subtitle: PGDate.shortDate(l.created_at),
                takenBy: l.coach_ref_id.flatMap { names[$0] }
            )
        }
        loaded = true
    }

    /// Write the picks against a freshly created invite. Matches are
    /// queued; entries need the coach's row, which only exists when the
    /// invite was named, so they are skipped rather than written
    /// somewhere nobody can read them.
    func apply(userId: UUID, inviteId: UUID, includeMatches: Bool) async {
        if includeMatches, !pickedMatches.isEmpty {
            struct Queue: Encodable { let invite_id: String; let match_id: String }
            _ = try? await supa
                .from("coach_invite_matches")
                .insert(pickedMatches.map {
                    Queue(
                        invite_id: inviteId.uuidString.lowercased(),
                        match_id: $0.uuidString.lowercased()
                    )
                })
                .execute()
        }
        guard !pickedEntries.isEmpty else { return }
        struct CoachRow: Decodable { let id: UUID }
        let rows: [CoachRow]? = try? await supa
            .from("player_coaches")
            .select("id")
            .eq("player_id", value: userId.uuidString.lowercased())
            .eq("invite_id", value: inviteId.uuidString.lowercased())
            .execute().value
        guard let coachRefId = rows?.first?.id else { return }
        struct Attach: Encodable {
            let coach_ref_id: String
            let shared_with_coach_at: String
        }
        _ = try? await supa
            .from("lessons")
            .update(Attach(
                coach_ref_id: coachRefId.uuidString.lowercased(),
                shared_with_coach_at: ISO8601DateFormatter().string(from: Date())
            ))
            .in("id", values: pickedEntries.map { $0.uuidString.lowercased() })
            .execute()
    }

    func reset() {
        pickedMatches = []
        pickedEntries = []
    }
}

/// The picker itself, as Form sections so it belongs in both invite
/// sheets without a second layout to keep in step.
struct InviteStarterPackSections: View {
    let store: StarterPackStore
    /// "All my matches" already covers every match, so offering to pick
    /// individual ones would be noise.
    let offerMatches: Bool
    /// An entry has to be attributed to somebody, and an unnamed invite
    /// has no row to attribute it to.
    let named: Bool

    var body: some View {
        if offerMatches, !store.matches.isEmpty {
            Section {
                ForEach(store.matches) { m in
                    row(
                        picked: store.pickedMatches.contains(m.id),
                        title: m.title,
                        subtitle: m.subtitle,
                        trailing: m.score.map { "\($0.you)–\($0.them)" },
                        blocked: nil
                    ) {
                        toggle(&store.pickedMatches, m.id)
                    }
                }
            } header: {
                Text("Give them a head start")
            } footer: {
                Text("Anything you pick is waiting for them the moment they accept.")
            }
        }

        if !store.entries.isEmpty {
            Section {
                if named {
                    ForEach(store.entries) { e in
                        row(
                            picked: store.pickedEntries.contains(e.id),
                            title: e.title,
                            subtitle: e.subtitle,
                            trailing: nil,
                            blocked: e.takenBy.map { "Already with \($0)" }
                        ) {
                            toggle(&store.pickedEntries, e.id)
                        }
                    }
                } else {
                    Text("Name them above to send some of your journal too.")
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                }
            } header: {
                Text(offerMatches && !store.matches.isEmpty
                     ? "Recent journal entries"
                     : "Give them a head start")
            }
        }
    }

    private func toggle(_ set: inout Set<UUID>, _ id: UUID) {
        if set.contains(id) { set.remove(id) } else { set.insert(id) }
    }

    @ViewBuilder
    private func row(
        picked: Bool,
        title: String,
        subtitle: String,
        trailing: String?,
        blocked: String?,
        onTap: @escaping () -> Void
    ) -> some View {
        Button(action: { if blocked == nil { onTap() } }) {
            HStack(spacing: 12) {
                Image(systemName: picked ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(picked ? PL.cyan : PL.text600)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.plBody)
                        .foregroundStyle(blocked == nil ? PL.text100 : PL.text500)
                        .lineLimit(1)
                    Text(blocked ?? subtitle)
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                if let trailing {
                    Text(trailing)
                        .font(.system(size: 13, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(PL.text300)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(blocked != nil)
    }
}
