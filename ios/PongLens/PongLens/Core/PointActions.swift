import Foundation
import Supabase

// The point detail view's write surface — all column-scoped patches,
// optimistic with rollback, mirroring PointScorecard.tsx's writes.
extension MatchDetailModel {
    func setServerOverride(_ point: MatchPoint, _ side: Winner) async {
        await patch(point, fields: ["server_override": .string(side.rawValue)]) {
            $0.serverOverride = side
        }
    }

    /// Loss reasons are multi-select. The web's Why overlay writes a single
    /// reason; the scorecard toggles within the array.
    func toggleReason(_ point: MatchPoint, _ value: String) async {
        var reasons = point.lossReasons ?? []
        if reasons.contains(value) {
            reasons.removeAll { $0 == value }
        } else {
            reasons.append(value)
        }
        let payload = reasons
        await patch(point, fields: ["loss_reasons": .array(payload.map { .string($0) })]) {
            $0.lossReasons = payload
        }
    }

    func setMisreadKind(_ point: MatchPoint, _ value: String?) async {
        await patch(point, fields: ["misread_kind": value.map { .string($0) } ?? .null]) {
            $0.misreadKind = value
        }
    }

    func setDirection(_ point: MatchPoint, _ value: String?) async {
        await patch(point, fields: ["direction": value.map { .string($0) } ?? .null]) {
            $0.direction = value
        }
    }

    func setServeSpin(_ point: MatchPoint, _ value: String?) async {
        await patch(point, fields: ["serve_spin": value.map { .string($0) } ?? .null]) {
            $0.serveSpin = value
        }
    }

    func setServeSidespin(_ point: MatchPoint, _ value: Bool) async {
        await patch(point, fields: ["serve_sidespin": .bool(value)]) {
            $0.serveSidespin = value
        }
    }

    func setServeLength(_ point: MatchPoint, _ value: String?) async {
        await patch(point, fields: ["serve_length": value.map { .string($0) } ?? .null]) {
            $0.serveLength = value
        }
    }

    func togglePlacementFlag(_ point: MatchPoint) async {
        let next = !(point.placementFlagged ?? false)
        await patch(point, fields: ["placement_flagged": .bool(next)]) {
            $0.placementFlagged = next
        }
    }

    /// One button, web semantics: the label names what the tap DOES.
    /// Reopening an end clears the named winner in the same write.
    func setBoundary(_ point: MatchPoint, next: GameEndOverride?) async {
        var fields: [String: AnyJSON] = [
            "game_end_override": next.map { .string($0.rawValue) } ?? .null
        ]
        if next != .end {
            fields["game_winner_override"] = .null
        }
        await patch(point, fields: fields) {
            $0.gameEndOverride = next
            if next != .end { $0.gameWinnerOverride = nil }
        }
    }
}

/// The game-boundary control's offer for one point (gameScore.ts port):
/// the label names what the tap does, never what is true.
func boundaryAction(
    override: GameEndOverride?, walkEndsHere: Bool
) -> (label: String, next: GameEndOverride?) {
    let endsHere = override == .end ? true : override == .continue ? false : walkEndsHere
    if endsHere {
        return ("Didn't end", override == .end ? nil : .continue)
    }
    return ("Game ended", override == .continue ? nil : .end)
}

/// Notes for one match, plus author display names.
@Observable
final class NotesStore {
    var notes: [NoteRow] = []
    var authorNames: [UUID: String] = [:]
    var loaded = false

    func load(matchId: UUID) async {
        do {
            notes = try await supa
                .from("notes")
                .select("id,match_id,point_id,author_id,body,audio_path,image_path,created_at")
                .eq("match_id", value: matchId.uuidString.lowercased())
                .order("created_at", ascending: true)
                .execute()
                .value
            let authors: [NoteAuthor] = try await supa
                .rpc("match_note_authors", params: ["p_match_id": matchId.uuidString.lowercased()])
                .execute()
                .value
            authorNames = Dictionary(
                uniqueKeysWithValues: authors.compactMap { a in
                    a.name.map { (a.authorId, $0) }
                }
            )
        } catch {
            // The section shows its empty state; a retry comes with refresh.
        }
        loaded = true
    }

    func add(matchId: UUID, pointId: UUID?, authorId: UUID, body: String) async -> Bool {
        struct Insert: Encodable {
            let match_id: String
            let point_id: String?
            let author_id: String
            let body: String
        }
        do {
            let inserted: NoteRow = try await supa
                .from("notes")
                .insert(Insert(
                    match_id: matchId.uuidString.lowercased(),
                    point_id: pointId?.uuidString.lowercased(),
                    author_id: authorId.uuidString.lowercased(),
                    body: body
                ))
                .select("id,match_id,point_id,author_id,body,audio_path,image_path,created_at")
                .single()
                .execute()
                .value
            notes.append(inserted)
            return true
        } catch {
            return false
        }
    }
}
