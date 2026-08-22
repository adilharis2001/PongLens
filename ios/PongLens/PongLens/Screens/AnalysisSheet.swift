import SwiftUI

/// Match analysis: the point differential across the match, the numbers
/// underneath it, why the lost points were lost, and how the serves went.
/// Same three cards as the web deck, stacked rather than swiped — a
/// vertical sheet is what every other sheet in the app does, and a
/// carousel inside a sheet fights the sheet's own drag.
struct AnalysisSheet: View {
    let match: MatchRow
    let model: MatchDetailModel
    let score: MatchScore
    /// The owner's own reason pills, so custom counts read as words.
    var customReasons: [UUID: String] = [:]

    var body: some View {
        let serving = computeServing(
            model.visible, firstServer: match.firstServer.flatMap(Winner.init(rawValue:))
        )
        let stats = computeMatchStats(model.visible, serving: serving, score: score)
        let analysis = computeMatchAnalysis(
            model.visible, serving: serving, customReasons: customReasons
        )
        let incomplete = !stats.hasData || stats.detailed < stats.scored

        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Match analysis")
                        .font(.plCardTitle)
                        .foregroundStyle(PL.text100)
                    if incomplete {
                        Text("Score the points and answer the follow-ups to fill this in.")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                    }
                }

                overviewCard(stats, analysis.momentum)

                // Three self-reported reasons is where a pattern starts;
                // below that the card is absent rather than padded out.
                if analysis.mistakes.reasonsGiven >= 3 {
                    mistakesCard(analysis.mistakes)
                }
                if analysis.serve.described >= 3 {
                    serveCard(analysis.serve)
                }
            }
            .padding(20)
            .padding(.bottom, 40)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Overview

    private func overviewCard(
        _ stats: MatchStatsSummary, _ momentum: MatchAnalysisResult.Momentum
    ) -> some View {
        card("Overview") {
            VStack(alignment: .leading, spacing: 0) {
                if !momentum.steps.isEmpty {
                    eyebrow("Point differential")
                    MomentumChart(
                        steps: momentum.steps, peak: momentum.peak, trough: momentum.trough
                    )
                    .padding(.bottom, 14)
                }

                if !stats.hasData {
                    Text("Score a full game to see your stats.")
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 18)
                        .multilineTextAlignment(.center)
                } else {
                    if let run = momentum.bestRun {
                        statRow("Best run") {
                            (Text("\(run.len) in a row")
                                .foregroundStyle(run.who == .user ? PL.cyan : PL.magentaSoft)
                                + Text(run.who == .user ? "  you" : "  them")
                                .foregroundStyle(PL.text500))
                                .font(.system(size: 13, weight: .semibold))
                        }
                    }
                    if stats.serverKnown {
                        statRow("Serve win %") { pct(stats.serve) }
                        statRow("Receive win %") { pct(stats.receive) }
                    } else {
                        Text("Set who served first to see serve stats.")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                            .padding(.vertical, 8)
                    }
                    statRow("At 9+ in the game") { pct(stats.pressure) }
                    statRow("After losing a point") { pct(stats.bounceBack) }
                    statRow("Points won–lost") { pair(stats.won, stats.lost) }
                    statRow("Furthest ahead / behind") {
                        pair(momentum.peak, -momentum.trough)
                    }
                    statRow("Lead changes") {
                        Text("\(momentum.leadChanges)")
                            .font(.system(size: 13, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(PL.text200)
                    }
                    if stats.gamesYou + stats.gamesThem > 0 {
                        statRow("Games won") { pair(stats.gamesYou, stats.gamesThem) }
                    }
                }
            }
        }
    }

    // MARK: - Why you lost

    private func mistakesCard(_ mistakes: MatchAnalysisResult.Mistakes) -> some View {
        card("Why you lost", hint: "Only points you lost") {
            let top = Array(mistakes.reasons.prefix(8))
            let max = mistakes.reasons.map(\.count).max() ?? 1
            VStack(alignment: .leading, spacing: 10) {
                ForEach(top, id: \.label) { row in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(row.label)
                                .font(.plCaption)
                                .foregroundStyle(PL.text300)
                                .lineLimit(1)
                            Spacer()
                            Text("\(row.count)")
                                .font(.system(size: 11, weight: .semibold))
                                .monospacedDigit()
                                .foregroundStyle(PL.text400)
                        }
                        GeometryReader { geo in
                            Capsule().fill(PL.ink)
                                .overlay(alignment: .leading) {
                                    Capsule()
                                        .fill(PL.magenta.opacity(0.7))
                                        .frame(
                                            width: geo.size.width
                                                * Double(row.count) / Double(max)
                                        )
                                }
                        }
                        .frame(height: 6)
                    }
                }
                Text("Self-reported on \(mistakes.reasonsGiven) of \(mistakes.totalLost) lost points.")
                    .font(.system(size: 11))
                    .foregroundStyle(PL.text600)
                    .padding(.top, 2)
            }
        }
    }

    // MARK: - Serve

    private func serveCard(_ serve: MatchAnalysisResult.ServeCuts) -> some View {
        card("Serve", hint: "Share of those points you won") {
            VStack(alignment: .leading, spacing: 10) {
                if !serve.mineSpins.isEmpty {
                    eyebrow("My serves (\(serve.mineCount))")
                    ForEach(serve.mineSpins, id: \.label) { splitBar($0) }
                    if !serve.mineLengths.isEmpty {
                        Rectangle().fill(PL.edge.opacity(0.6))
                            .frame(height: 1)
                            .padding(.vertical, 4)
                        ForEach(serve.mineLengths, id: \.label) { splitBar($0) }
                    }
                }
                if !serve.theirSpins.isEmpty {
                    eyebrow("Their serves (\(serve.theirCount))")
                        .padding(.top, serve.mineSpins.isEmpty ? 0 : 8)
                    ForEach(serve.theirSpins, id: \.label) { splitBar($0) }
                }
                Text("One match is a small sample. The count beside each bar says how small.")
                    .font(.system(size: 11))
                    .foregroundStyle(PL.text600)
                    .padding(.top, 2)
            }
        }
    }

    /// Won against lost for one cut of the serve, as one bar.
    private func splitBar(_ tally: Tally) -> some View {
        let total = tally.won + tally.lost
        let share = total > 0 ? Double(tally.won) / Double(total) : 0
        return VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline) {
                Text(tally.label)
                    .font(.plCaption)
                    .foregroundStyle(PL.text300)
                    .lineLimit(1)
                Spacer()
                (Text("\(Int((share * 100).rounded()))%")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(PL.cyan)
                    + Text(" · \(total)")
                    .font(.system(size: 11))
                    .foregroundStyle(PL.text500))
                    .monospacedDigit()
            }
            GeometryReader { geo in
                HStack(spacing: 0) {
                    Rectangle().fill(PL.cyan)
                        .frame(width: geo.size.width * share)
                    Rectangle().fill(PL.magenta.opacity(0.7))
                }
                .clipShape(Capsule())
            }
            .frame(height: 6)
        }
    }

    // MARK: - Bits

    private func card(
        _ title: String, hint: String? = nil, @ViewBuilder content: () -> some View
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.plRowTitle)
                .foregroundStyle(PL.text100)
            if let hint {
                Text(hint)
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .padding(.top, 2)
            }
            content()
                .padding(.top, 12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
    }

    private func eyebrow(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .medium))
            .tracking(0.5)
            .foregroundStyle(PL.text500)
            .padding(.bottom, 6)
    }

    private func statRow(
        _ label: String, @ViewBuilder value: () -> some View
    ) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text(label)
                    .font(.plCaption)
                    .foregroundStyle(PL.text400)
                Spacer()
                value()
            }
            .padding(.vertical, 7)
            Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1)
        }
    }

    private func pct(_ rate: Rate) -> some View {
        Group {
            if let value = rate.pct {
                (Text("\(value)%").foregroundStyle(PL.cyan)
                    + Text("  \(rate.won)/\(rate.played)")
                    .font(.system(size: 11))
                    .foregroundStyle(PL.text500))
                    .font(.system(size: 13, weight: .semibold))
                    .monospacedDigit()
            } else {
                Text("—").font(.plBody).foregroundStyle(PL.text500)
            }
        }
    }

    private func pair(_ you: Int, _ them: Int) -> some View {
        (Text("\(you)").foregroundStyle(PL.cyan)
            + Text("–").foregroundStyle(PL.text600)
            + Text("\(them)").foregroundStyle(PL.magentaSoft))
            .font(.system(size: 13, weight: .semibold))
            .monospacedDigit()
    }
}

/// The running point differential, one bar per scored point: cyan above
/// the line, magenta below, dashed where a game ended. A port of the
/// web's MomentumChart, which is the one picture in the analysis.
struct MomentumChart: View {
    let steps: [MomentumStep]
    let peak: Int
    let trough: Int

    var body: some View {
        Canvas { context, size in
            let n = Swift.max(steps.count, 1)
            let span = Swift.max(Swift.max(peak, -trough), 1)
            let barW = size.width / CGFloat(n)
            let midY = size.height / 2
            let unit = midY / CGFloat(span)

            for (i, step) in steps.enumerated() where step.diff != 0 {
                let h = CGFloat(abs(step.diff)) * unit
                let rect = CGRect(
                    x: CGFloat(i) * barW,
                    y: step.diff > 0 ? midY - h : midY,
                    width: Swift.max(barW, 0.7),
                    height: h
                )
                context.fill(
                    Path(rect),
                    with: .color(step.diff > 0 ? PL.cyan.opacity(0.7) : PL.magenta.opacity(0.6))
                )
            }

            var zero = Path()
            zero.move(to: CGPoint(x: 0, y: midY))
            zero.addLine(to: CGPoint(x: size.width, y: midY))
            context.stroke(zero, with: .color(PL.text600), lineWidth: 1)

            for (i, step) in steps.enumerated() where step.endsGame && i < steps.count - 1 {
                var line = Path()
                let x = CGFloat(i + 1) * barW
                line.move(to: CGPoint(x: x, y: 0))
                line.addLine(to: CGPoint(x: x, y: size.height))
                context.stroke(
                    line, with: .color(PL.edge),
                    style: StrokeStyle(lineWidth: 1, dash: [3, 3])
                )
            }
        }
        .frame(height: 112)
        .accessibilityLabel("Point differential across \(steps.count) points")
    }
}
