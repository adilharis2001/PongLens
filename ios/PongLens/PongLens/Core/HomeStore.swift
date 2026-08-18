import Foundation
import Supabase

/// The small facts Home's First steps checklist needs that no other store
/// carries: whether any share link or coach link exists.
@Observable
final class HomeStore {
    var shareLinksCount = 0
    var coachLinksCount = 0
    var loaded = false

    func load(userId: UUID?) async {
        guard let userId else { return }
        let shares = try? await supa
            .from("share_links")
            .select("id", head: true, count: .exact)
            .is("revoked_at", value: nil)
            .execute()
        shareLinksCount = shares?.count ?? 0

        let coaches = try? await supa
            .from("coach_links")
            .select("id", head: true, count: .exact)
            .eq("player_id", value: userId.uuidString.lowercased())
            .neq("status", value: "revoked")
            .execute()
        coachLinksCount = coaches?.count ?? 0
        loaded = true
    }
}
