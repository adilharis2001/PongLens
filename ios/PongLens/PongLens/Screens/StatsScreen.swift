import SwiftUI
import Supabase

/// /stats — "My game". All aggregation is client-side through the same
/// pure walks the match pages use; only fully-scored matches count toward
/// the record.
struct StatsScreen: View {
    var initialTab = "My stats"

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @Environment(LibraryStore.self) private var library
    @Environment(ScoresStore.self) private var scores
    @State private var tab = "My stats"
    @State private var tactics = TacticsStore()
    @State private var showAllResults = false

    private var ownMatches: [MatchRow] {
        guard let uid = app.userId else { return [] }
        return library.matches
            .filter { $0.userId == uid }
            .sorted {
                (PGDate.parse($0.playedAt) ?? .distantPast) > (PGDate.parse($1.playedAt) ?? .distantPast)
            }
    }

    private var fullMatches: [(MatchRow, ScoresStore.Entry)] {
        ownMatches.compactMap { match in
            guard let entry = scores.scores[match.id], entry.fullyScored else { return nil }
            return (match, entry)
        }
    }

    private var decided: [(MatchRow, ScoresStore.Entry)] {
        fullMatches.filter { $0.1.won != nil }
    }

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Button {
                        dismiss()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Back")
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())

                    Text("My game")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    HStack(spacing: 8) {
                        tabPill("My stats")
                        tabPill("Tactics")
                    }

                    if tab == "My stats" {
                        myStats
                    } else {
                        tacticsBody
                    }
                }
                .padding(20)
                .padding(.bottom, 60)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .onAppear { tab = initialTab }
        .task { await tactics.load() }
    }

    private func tabPill(_ name: String) -> some View {
        let active = tab == name
        return Button(name) { tab = name }
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(active ? .white : PL.text500)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(active ? PL.surface2 : .clear, in: Capsule())
            .overlay(Capsule().strokeBorder(active ? PL.edge : .clear, lineWidth: 1))
            .buttonStyle(.plain)
    }

    // MARK: - My stats

    @ViewBuilder
    private var myStats: some View {
        let agg = scores.aggregate
        let entries = ownMatches.compactMap { scores.scores[$0.id] }
        let scored = agg.pointsWon + agg.pointsLost

        if scored == 0 {
            VStack(spacing: 10) {
                Text("Nothing to count yet.")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Text("Score the points in your matches and this page builds itself: serve and receive, pressure points, patterns across every match.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
            }
            .frame(maxWidth: .infinity)
            .plCard(padding: 32)
        } else {
            HStack(spacing: 10) {
                let wins = decided.filter { $0.1.won == true }.count
                hero("Matches", "\(wins)–\(decided.count - wins)")
                let gy = fullMatches.map(\.1.gamesYou).reduce(0, +)
                let gt = fullMatches.map(\.1.gamesThem).reduce(0, +)
                hero("Games", "\(gy)–\(gt)")
                hero("Points won", "\(Int((Double(agg.pointsWon) / Double(scored) * 100).rounded()))%")
            }

            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    SectionHeading("Winning points")
                    Spacer()
                    Text("Across \(fullMatches.count) scored match\(fullMatches.count == 1 ? "" : "es")")
                        .font(.plCaption)
                        .foregroundStyle(PL.text600)
                }
                VStack(spacing: 0) {
                    let served = entries.map(\.served).reduce(0, +)
                    let serveWon = entries.map(\.serveWon).reduce(0, +)
                    let received = entries.map(\.received).reduce(0, +)
                    let receiveWon = entries.map(\.receiveWon).reduce(0, +)
                    if served + received == 0 {
                        Text("Set who served first in your matches to split points by serve and receive.")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                            .padding(14)
                    } else {
                        statLine("Serve win %", pct(serveWon, served), detail: "\(serveWon)/\(served)")
                        divider
                        statLine("Receive win %", pct(receiveWon, received), detail: "\(receiveWon)/\(received)")
                        divider
                    }
                    statLine("At 9+ in the game", pct(scores.aggregate.at9Won, scores.aggregate.at9Total), detail: "\(agg.at9Won)/\(agg.at9Total)")
                    divider
                    statLine("After losing a point", pct(agg.afterLossWon, agg.afterLossTotal), detail: "\(agg.afterLossWon)/\(agg.afterLossTotal)")
                    divider
                    statLine("Games past 10-10", agg.deuceGamesTotal == 0 ? "—" : "\(agg.deuceGamesWon)/\(agg.deuceGamesTotal)", detail: nil)
                    divider
                    statLine("Best run of points", "\(agg.bestRun) in a row", detail: nil)
                    divider
                    statLine("Points won–lost", "\(agg.pointsWon)–\(agg.pointsLost)", detail: nil)
                }
                .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                        .strokeBorder(PL.edge, lineWidth: 1)
                )
            }

            resultsSection
            opponentsSection
        }
    }

    private var resultsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionHeading("Results")
                Spacer()
                Text("Fully scored matches, most recent first")
                    .font(.plCaption)
                    .foregroundStyle(PL.text600)
            }
            if decided.isEmpty {
                Text("Finish scoring a match — every point decided — and its result lands here.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                    .frame(maxWidth: .infinity)
                    .plCard(padding: 20)
            } else {
                HStack(spacing: 5) {
                    ForEach(Array(decided.prefix(10).enumerated()), id: \.offset) { _, pair in
                        Circle()
                            .fill(pair.1.won == true ? PL.cyan : PL.magenta)
                            .frame(width: 9, height: 9)
                    }
                    Text("last \(min(10, decided.count))")
                        .font(.plCaption)
                        .foregroundStyle(PL.text600)
                        .padding(.leading, 4)
                }
                VStack(spacing: 8) {
                    let shown = showAllResults ? decided : Array(decided.prefix(5))
                    ForEach(shown, id: \.0.id) { match, entry in
                        NavigationLink(value: match) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(MatchTitle.parts(for: match).primary)
                                        .font(.plRowTitle)
                                        .foregroundStyle(PL.text100)
                                        .lineLimit(1)
                                    Text(PGDate.shortDate(match.playedAt))
                                        .font(.plCaption)
                                        .foregroundStyle(PL.text500)
                                }
                                Spacer()
                                ScorePill(you: entry.gamesYou, them: entry.gamesThem)
                                Text("\(entry.serveWon + entry.receiveWon)–\(entry.confirmedCount - entry.serveWon - entry.receiveWon) pts")
                                    .font(.plCaption)
                                    .monospacedDigit()
                                    .foregroundStyle(PL.text500)
                            }
                            .plInnerRow()
                        }
                        .buttonStyle(.plain)
                    }
                }
                if decided.count > 5, !showAllResults {
                    Button("Show all \(decided.count)") { showAllResults = true }
                        .buttonStyle(PLSecondaryButtonStyle())
                }
            }
        }
    }

    private var opponentsSection: some View {
        let byOpponent = Dictionary(grouping: decided) { pair in
            pair.0.opponentName ?? "Unknown"
        }
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionHeading("Opponents")
                Spacer()
                Text("Fully scored matches only")
                    .font(.plCaption)
                    .foregroundStyle(PL.text600)
            }
            VStack(spacing: 0) {
                let rows = byOpponent.sorted { $0.value.count > $1.value.count }
                ForEach(Array(rows.enumerated()), id: \.offset) { i, row in
                    let wins = row.value.filter { $0.1.won == true }.count
                    HStack {
                        Text(row.key)
                            .font(.plBody)
                            .foregroundStyle(PL.text200)
                        Spacer()
                        Text("\(wins)–\(row.value.count - wins)")
                            .font(.system(size: 14, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(PL.text100)
                    }
                    .padding(14)
                    if i < rows.count - 1 { divider }
                }
            }
            .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
        }
    }

    // MARK: - Tactics

    @ViewBuilder
    private var tacticsBody: some View {
        if !tactics.loaded {
            ProgressView().tint(PL.cyan).frame(maxWidth: .infinity)
        } else if tactics.lossReasonCounts.isEmpty && tactics.myServeSpins.isEmpty {
            VStack(spacing: 10) {
                Text("No patterns yet.")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Text("Tactics build from the follow-ups on scored points: how each point ended, the serve's spin and length, and where the deciding ball went. Answer those on a few matches and the patterns show up here.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
            }
            .frame(maxWidth: .infinity)
            .plCard(padding: 28)
        } else {
            if !tactics.myServeSpins.isEmpty {
                countGroup("My serves", hint: "Serves described on decided points", tactics.myServeSpins)
            }
            if !tactics.theirServeSpins.isEmpty {
                countGroup("Against their serves", hint: "The spins that decided points", tactics.theirServeSpins)
            }
            if !tactics.lossReasonCounts.isEmpty {
                countGroup("Why you lose", hint: "Only points you lost, across every match", tactics.lossReasonCounts)
            }
        }
    }

    private func countGroup(_ title: String, hint: String, _ rows: [(String, Int)]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionHeading(title)
                Spacer()
                Text(hint).font(.plCaption).foregroundStyle(PL.text600)
            }
            VStack(spacing: 0) {
                let maxCount = rows.map(\.1).max() ?? 1
                ForEach(Array(rows.enumerated()), id: \.offset) { i, row in
                    HStack(spacing: 12) {
                        Text(row.0)
                            .font(.plBody)
                            .foregroundStyle(PL.text200)
                            .frame(width: 130, alignment: .leading)
                        GeometryReader { geo in
                            Capsule()
                                .fill(PL.cyan.opacity(0.6))
                                .frame(
                                    width: max(4, geo.size.width * Double(row.1) / Double(maxCount)),
                                    height: 6
                                )
                                .frame(maxHeight: .infinity)
                        }
                        Text("\(row.1)")
                            .font(.system(size: 13, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(PL.text100)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    if i < rows.count - 1 { divider }
                }
            }
            .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
        }
    }

    // MARK: - Bits

    private func hero(_ label: String, _ value: String) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.system(size: 22, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(PL.text100)
            Text(label)
                .font(.plCaption)
                .foregroundStyle(PL.text500)
        }
        .frame(maxWidth: .infinity)
        .plCard(padding: 14)
    }

    private func statLine(_ label: String, _ value: String, detail: String?) -> some View {
        HStack {
            Text(label).font(.plBody).foregroundStyle(PL.text300)
            Spacer()
            if let detail {
                Text(detail)
                    .font(.plCaption)
                    .monospacedDigit()
                    .foregroundStyle(PL.text600)
            }
            Text(value)
                .font(.system(size: 14, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(PL.text100)
        }
        .padding(14)
    }

    private var divider: some View {
        Rectangle().fill(PL.edge.opacity(0.5)).frame(height: 1).padding(.leading, 14)
    }

    private func pct(_ won: Int, _ total: Int) -> String {
        guard total > 0 else { return "—" }
        return "\(Int((Double(won) / Double(total) * 100).rounded()))%"
    }
}

/// Tactics reads the described follow-ups across every point the user
/// answered — spins, lengths, loss reasons.
@Observable
final class TacticsStore {
    var myServeSpins: [(String, Int)] = []
    var theirServeSpins: [(String, Int)] = []
    var lossReasonCounts: [(String, Int)] = []
    var loaded = false

    struct Row: Decodable {
        let serveSpin: String?
        let serveSidespin: Bool?
        let lossReasons: [String]?
        let confirmedWinner: String?
        let server: String?
        let serverOverride: String?

        enum CodingKeys: String, CodingKey {
            case server
            case serveSpin = "serve_spin"
            case serveSidespin = "serve_sidespin"
            case lossReasons = "loss_reasons"
            case confirmedWinner = "confirmed_winner"
            case serverOverride = "server_override"
        }
    }

    func load() async {
        let rows: [Row]? = try? await supa
            .from("points")
            .select("serve_spin,serve_sidespin,loss_reasons,confirmed_winner,server,server_override")
            .eq("deleted", value: false)
            .not("confirmed_winner", operator: .is, value: AnyJSON.null)
            .limit(2000)
            .execute().value

        var mine: [String: Int] = [:]
        var theirs: [String: Int] = [:]
        var reasons: [String: Int] = [:]
        for row in rows ?? [] {
            if let spin = row.serveSpin {
                let label = spinLabel(spin, sidespin: row.serveSidespin ?? false)
                let servedByMe = (row.serverOverride ?? row.server) == "user"
                if servedByMe { mine[label, default: 0] += 1 }
                else { theirs[label, default: 0] += 1 }
            }
            if row.confirmedWinner == "opponent" {
                for reason in row.lossReasons ?? [] {
                    let label = LOSS_REASON_LABELS[reason]
                        ?? (reason.hasPrefix("custom:") ? "Your own reasons" : reason)
                    reasons[label, default: 0] += 1
                }
            }
        }
        myServeSpins = mine.sorted { $0.value > $1.value }.map { ($0.key, $0.value) }
        theirServeSpins = theirs.sorted { $0.value > $1.value }.map { ($0.key, $0.value) }
        lossReasonCounts = reasons.sorted { $0.value > $1.value }.map { ($0.key, $0.value) }
        loaded = true
    }

    private func spinLabel(_ spin: String, sidespin: Bool) -> String {
        if sidespin {
            return spin == "back" ? "Side-under" : spin == "top" ? "Side-top" : "Sidespin"
        }
        return SERVE_SPINS.first { $0.value == spin }?.label ?? spin
    }
}
