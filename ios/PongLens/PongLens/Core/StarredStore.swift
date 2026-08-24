import Foundation
import Supabase

/// Reads and writes for the Starred shelf. The shaping lives next door in
/// Starred.swift, which imports Foundation and nothing else so the
/// grouping and the labels can be tested without a network client.

@MainActor
@Observable
final class StarredStore {
    var rows: [StarredPointRow] = []
    /// The owner's own "why I lost it" pills, so `custom:<id>` resolves to
    /// words instead of an id.
    var customReasons: [CustomReason] = []
    var loaded = false
    var loadError: String?
    /// The last star removed, for the undo pill.
    var undo: StarredPointRow?

    var groups: [StarredGroup] { groupStarred(rows) }

    func load(userId: UUID?) async {
        do {
            async let starred: [StarredPointRow] =
                supa.rpc("starred_points").execute().value
            async let reasons: [CustomReason] = {
                guard let userId else { return [] }
                return try await supa
                    .from("loss_reason_labels")
                    .select("id,label")
                    .eq("owner_id", value: userId.uuidString.lowercased())
                    .execute()
                    .value
            }()
            let (r, c) = try await (starred, reasons)
            rows = r
            customReasons = c
            loadError = nil
        } catch {
            #if DEBUG
            loadError = String(describing: error)
            #else
            loadError = "Couldn't load your starred points. Pull to refresh."
            #endif
        }
        loaded = true
    }

    /// Take the star off. The row leaves the shelf immediately and comes
    /// back if the write fails — the database is the truth, and a page
    /// showing a set it disagrees with is worse than a flicker.
    func unstar(_ row: StarredPointRow) async {
        rows.removeAll { $0.id == row.id }
        undo = row
        if await !write(row, starred: false) {
            undo = nil
            reinsert(row)
        }
    }

    func putBack(_ row: StarredPointRow) async {
        undo = nil
        reinsert(row)
        _ = await write(row, starred: true)
    }

    private func reinsert(_ row: StarredPointRow) {
        guard !rows.contains(where: { $0.id == row.id }) else { return }
        rows.append(row)
        // The RPC's order, rebuilt locally: newest match first, then the
        // point's position within it.
        rows.sort {
            let a = PGDate.parse($0.playedAt) ?? .distantPast
            let b = PGDate.parse($1.playedAt) ?? .distantPast
            if a != b { return a > b }
            return $0.displayNo < $1.displayNo
        }
    }

    private func write(_ row: StarredPointRow, starred: Bool) async -> Bool {
        do {
            try await supa
                .from("points")
                .update(["starred": starred])
                .eq("id", value: row.id.uuidString.lowercased())
                .execute()
            return true
        } catch {
            return false
        }
    }
}
