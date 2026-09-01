import SwiftUI

// The spoken score on the match screen: one slot, two weights.
//
// The scored result (Keep score) is the record — it feeds analysis,
// placement and the rotation, and it keeps the solid games total it has
// always had. The spoken score is testimony from the table, and it never
// wears the record's clothes: always muted, always labelled Spoken, and
// only as loud as the state needs. On an unscored match it holds the
// score slot and carries the nudge to score properly; once the match is
// scored it steps back to one row inside the score disclosure.

enum SpokenSummary {
    /// Games won either side, counting only fully-known rows.
    static func tally(_ rows: [SpokenGameScore]) -> (you: Int, them: Int) {
        var you = 0, them = 0
        for row in rows {
            guard let a = row.you, let b = row.them else { continue }
            if a > b { you += 1 } else if b > a { them += 1 }
        }
        return (you, them)
    }

    /// The per-game line, "12-10 · 7-11 · …", in game order.
    static func line(_ rows: [SpokenGameScore]) -> String {
        rows.sorted { $0.game < $1.game }
            .compactMap { row in
                guard let a = row.you, let b = row.them else { return nil }
                return "\(a)-\(b)"
            }
            .joined(separator: "  ·  ")
    }
}

/// The muted "Spoken 3 - 2" toggle that stands in the score slot while
/// no scored result exists. Deliberately quieter than the scored total:
/// which number is the record should be answered by weight before
/// anyone reads the label.
struct SpokenGamesToggle: View {
    let rows: [SpokenGameScore]
    let open: Bool
    let action: () -> Void

    var body: some View {
        let tally = SpokenSummary.tally(rows)
        Button(action: action) {
            HStack(spacing: 6) {
                Text("Spoken")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(PL.text500)
                (Text("\(tally.you)").foregroundColor(PL.cyan.opacity(0.65))
                    + Text(" - ").foregroundColor(PL.text600)
                    + Text("\(tally.them)").foregroundColor(PL.magentaSoft.opacity(0.65)))
                    .font(.system(size: 15, weight: .semibold))
                    .monospacedDigit()
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(PL.text500)
                    .rotationEffect(.degrees(open ? 180 : 0))
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            "Spoken score, \(tally.you) games to \(tally.them). Tap for the games.")
    }
}

/// The edit surface shared by every place a spoken score displays: the
/// board in its own theme, tap a game to fix it, add one the phone
/// never heard — including one missing from the middle.
struct SpokenScoreSheet: View {
    let youLabel: String
    let rows: [SpokenGameScore]
    let onSave: (Int, Int, Int) -> Void
    let onRemove: (Int) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var editing: SpokenEditTarget?

    var body: some View {
        PLSheetScaffold(title: "Spoken score") {
            Form {
                Section {
                    if !rows.isEmpty {
                        ScoreBoard(scores: rows,
                                   youLabel: youLabel,
                                   missed: nil,
                                   onTap: { game in
                                       editing = SpokenEditTarget(game: game)
                                   })
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .listRowInsets(EdgeInsets(top: 10, leading: 12,
                                                      bottom: 10, trailing: 12))
                            .listRowBackground(Color.clear)
                    }
                    if rows.count < SpokenScore.maxGame {
                        Button {
                            editing = SpokenEditTarget(game: nil)
                        } label: {
                            Text("Add a game")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(PL.cyan)
                        }
                    }
                } footer: {
                    Text("What was called out at the phone during the match. Tap a game to correct it. This is kept as a reference and never changes the scored result.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(PL.ink)
        }
        .presentationDetents([.medium])
        .presentationBackground(PL.ink)
        .sheet(item: $editing) { target in
            let existing = target.game.flatMap { g in rows.first { $0.game == g } }
            SpokenScoreEditor(
                youLabel: youLabel,
                fixedGame: target.game,
                freeGames: (1...SpokenScore.maxGame).filter { candidate in
                    !rows.contains { $0.game == candidate }
                },
                initialYou: existing?.you ?? 11,
                initialThem: existing?.them ?? 0,
                canRemove: existing != nil,
                onSave: onSave,
                onRemove: onRemove
            )
        }
    }
}
