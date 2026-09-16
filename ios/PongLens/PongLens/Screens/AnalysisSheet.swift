import SwiftUI

/// The numbers every analysis card reads, computed once per render.
struct MatchAnalysisBundle {
    let stats: MatchStatsSummary
    let analysis: MatchAnalysisResult

    init(match: MatchRow, model: MatchDetailModel, score: MatchScore, customReasons: [UUID: String] = [:]) {
        let serving = computeServing(
            model.visible, firstServer: match.firstServer.flatMap(Winner.init(rawValue:))
        )
        stats = computeMatchStats(model.visible, serving: serving, score: score)
        analysis = computeMatchAnalysis(
            model.visible, serving: serving, customReasons: customReasons
        )
    }

    /// Some scored points still lack their follow-up answers.
    var incomplete: Bool { !stats.hasData || stats.detailed < stats.scored }
}

/// What the video cards need beyond the score bundle: the match and its
/// points, the rotation, and the owner's two actions (score, regenerate).
struct VideoCardsInput {
    let match: MatchRow
    let points: [MatchPoint]
    let userSide: String?
    let gameIndexByPoint: [UUID: Int]
    let serving: [UUID: ServeInfo]
    let pad: ClipPad
    let opponentLabel: String
    /// app_config placement_serves_only (132).
    let servesOnly: Bool
    /// The match type keeps a score; a practice gets the maps only.
    let scoredType: Bool
    /// Placement ran, or any point carries data.
    let showMaps: Bool
    /// Placement is ready: the video cards may read it.
    let placementTrusted: Bool
    let onScore: (() -> Void)?
    let onPlacementChanged: () -> Void
    /// Open one point from a heat-map zone's list. Nil leaves the zones
    /// as pictures.
    var onOpenPoint: ((MatchPoint) -> Void)? = nil
}

/// One card of the deck, boxed so a heterogeneous list can be paged and
/// counted. Nine cards at most; the box costs nothing that matters.
private struct DeckCard: Identifiable {
    let id: String
    let view: AnyView
}

/// The deck, shown inline on the match page for both owner and coach.
/// `coachView` turns "you" into "the player" throughout. One deck for
/// everything the match can say (Adil, 2026-09-15): the score's cards,
/// then the video's once 75% of the points are scored, with the serve
/// maps among them, then what is still to come. Swiped sideways, one card
/// per screen with the next one peeking, the same deck as the web.
struct AnalysisCards: View {
    let bundle: MatchAnalysisBundle
    var coachView = false
    var video: VideoCardsInput? = nil

    @State private var mapsWho: PlacementMapWho = .me
    @State private var mapsShot: PlacementMapShot = .serves
    @State private var activeCard: Int? = 0

    var body: some View {
        let cards = deck()

        VStack(spacing: 10) {
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(Array(cards.enumerated()), id: \.element.id) { index, card in
                        card.view
                            .containerRelativeFrame(.horizontal) { width, _ in width * 0.86 }
                            .id(index)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            .scrollPosition(id: $activeCard)
            .scrollIndicators(.hidden)
            .scrollClipDisabled()

            // Dots: where you are in the deck.
            HStack(spacing: 6) {
                ForEach(0..<cards.count, id: \.self) { index in
                    Capsule()
                        .fill(index == (activeCard ?? 0) ? PL.cyan : PL.edge)
                        .frame(width: index == (activeCard ?? 0) ? 16 : 6, height: 6)
                        .animation(.easeOut(duration: 0.15), value: activeCard)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    /// The cards in their fixed order, so the swipe is predictable: what
    /// the score says, then what the video says (serve cards, the maps,
    /// the endings), then the lifecycle and gate cards, then the teaser.
    private func deck() -> [DeckCard] {
        let stats = bundle.stats
        let analysis = bundle.analysis
        var cards: [DeckCard] = []
        let scoredType = video?.scoredType ?? true
        let gate = video.map { scoredCardsGate($0.points) }

        if scoredType {
            // The overview draws the momentum of whatever is scored, and half
            // a match's worth reads as a staircase, so it waits for the same
            // bar as the video cards.
            if gate?.open ?? true {
                cards.append(DeckCard(id: "overview", view: AnyView(overviewCard(stats, analysis.momentum))))
            }
            // Three self-reported reasons is where a pattern starts;
            // below that the card is absent rather than padded out.
            if analysis.mistakes.reasonsGiven >= 3 {
                cards.append(DeckCard(id: "mistakes", view: AnyView(mistakesCard(analysis.mistakes))))
            }
            if analysis.serve.described >= 3 {
                cards.append(DeckCard(id: "serve", view: AnyView(serveCard(analysis.serve))))
            }
        }

        guard let video, let gate else { return cards }
        let result: ScoredCardsResult? = video.scoredType && gate.open
            ? computeScoredCards(
                points: video.points,
                userSide: video.userSide,
                gameIndexByPoint: video.gameIndexByPoint,
                serving: video.serving,
                prePad: { effectivePad(video.pad, tightStart: $0.tightStart, tightEnd: $0.tightEnd).pre },
                placementTrusted: video.placementTrusted
            )
            : nil
        if let result {
            if result.pointLength.covered >= SCORED_CARDS_MIN_SAMPLES {
                cards.append(DeckCard(id: "length", view: AnyView(PointLengthCard(result: result.pointLength, coachView: coachView))))
            }
            if !result.serveSpeedMine.isEmpty || !result.serveSpeedTheirs.isEmpty {
                cards.append(DeckCard(id: "speed", view: AnyView(
                    ServeSpeedCard(mine: result.serveSpeedMine, theirs: result.serveSpeedTheirs, coachView: coachView)
                )))
            }
        }
        // The maps are the worker's own evidence and need no score, only an
        // end to be drawn from and three placed points, the floor the share
        // page uses: a table with two dots on it reads as broken, not empty.
        let mapped: Int = {
            guard video.showMaps, video.userSide != nil else { return 0 }
            let collect = video.servesOnly
                ? collectServePlacementObservations
                : collectTrustedPlacementObservations
            return trustedPlacementPointCount(
                collect(unflaggedPlacementPoints(video.points), video.userSide, video.gameIndexByPoint, video.serving)
            )
        }()
        if mapped >= 3 {
            for page in [PlacementMapPage.landings, .heat] {
                cards.append(DeckCard(id: page == .landings ? "landings" : "heat", view: AnyView(
                    PlacementMapCard(
                        page: page,
                        points: video.points,
                        userSide: video.userSide,
                        gameIndexByPoint: video.gameIndexByPoint,
                        serving: video.serving,
                        opponentLabel: video.opponentLabel,
                        coachView: coachView,
                        servesOnly: video.servesOnly,
                        who: $mapsWho,
                        shot: $mapsShot,
                        onOpenPoint: video.onOpenPoint,
                        serverEstimated: scoredType && !gate.open
                    )
                )))
            }
        }
        if let result, result.endings.shown {
            cards.append(DeckCard(id: "endings", view: AnyView(
                EndingsCard(endings: result.endings, opponentLabel: video.opponentLabel, coachView: coachView)
            )))
        }

        // What is still to do, for the owner: an end to name, points to
        // score, an analysis to generate or retry. While any of it is open
        // the deck ends on the next-step card; once none is, and only then,
        // on the teaser. A coach gets the teaser only for a complete match
        // and never the card.
        let sideMissing = video.userSide == nil && video.showMaps
        let status = video.match.placementStatus ?? "not_requested"
        let handCut = video.match.cutSource == "manual"
        let analysisPending = !handCut && status != "ready" && status != "final_failed"
        // Scoring is a step only up to the bar; past it the deck has what
        // it needs and the card asks for nothing more about the score.
        let nextStep = !coachView
            && ((scoredType && !gate.open) || sideMissing || analysisPending)
        let complete = coachView
            ? gate.open && (handCut || status == "ready")
            : !nextStep
        if nextStep {
            cards.append(DeckCard(id: "next", view: AnyView(
                NextStepCard(
                    match: video.match,
                    gate: gate,
                    scoredType: scoredType,
                    sideMissing: sideMissing,
                    onScore: video.onScore,
                    onChanged: video.onPlacementChanged
                )
            )))
        }
        if scoredType, complete {
            cards.append(DeckCard(id: "teaser", view: AnyView(ComingSoonCard())))
        }
        return cards
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
                    Text(coachView
                        ? "Stats appear once a full game is scored."
                        : "Score a full game to see your stats.")
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
                                + Text(run.who == .user
                                    ? (coachView ? "  player" : "  you")
                                    : (coachView ? "  opponent" : "  them"))
                                .foregroundStyle(PL.text500))
                                .font(.system(size: 13, weight: .semibold))
                        }
                    }
                    if stats.serverKnown {
                        statRow("Serve win %") { pct(stats.serve) }
                        statRow("Receive win %") { pct(stats.receive) }
                    } else {
                        Text(coachView
                            ? "Serve stats appear once the player sets who served first."
                            : "Set who served first to see serve stats.")
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
        card(
            coachView ? "Why the player lost" : "Why you lost",
            hint: coachView ? "Only points the player lost" : "Only points you lost"
        ) {
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
        card("Serve", hint: coachView ? "Share of those points the player won" : "Share of those points you won") {
            VStack(alignment: .leading, spacing: 10) {
                if !serve.mineSpins.isEmpty {
                    eyebrow(coachView ? "Player's serves (\(serve.mineCount))" : "My serves (\(serve.mineCount))")
                    ForEach(serve.mineSpins, id: \.label) { splitBar($0) }
                    if !serve.mineLengths.isEmpty {
                        Rectangle().fill(PL.edge.opacity(0.6))
                            .frame(height: 1)
                            .padding(.vertical, 4)
                        ForEach(serve.mineLengths, id: \.label) { splitBar($0) }
                    }
                }
                if !serve.theirSpins.isEmpty {
                    eyebrow(coachView ? "Opponent's serves (\(serve.theirCount))" : "Their serves (\(serve.theirCount))")
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
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
