import SwiftUI

/// The cards the video adds to Match analysis once most of the match is
/// scored: a SwiftUI port of ScoredCards.tsx. The numbers come from
/// ScoredCards.swift, the port of the web module, so a card here and the
/// same card in the browser read the same match the same way.

/// The Beta chip that rides on every card the ball engine feeds. Never on
/// a heading: the score cards beside these are not beta.
struct BetaChip: View {
    var body: some View {
        Text("BETA")
            .font(.system(size: 10, weight: .semibold))
            .tracking(0.5)
            .foregroundStyle(PL.warningText.opacity(0.9))
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .background(PL.warning.opacity(0.1), in: Capsule())
            .overlay(Capsule().strokeBorder(PL.warning.opacity(0.25), lineWidth: 1))
    }
}

/// The shells every video card is built from. Mirrors the analysis deck's
/// own card so the two halves of the section cannot drift apart.
enum ScoredCardStyle {
    static func card(
        _ title: String, hint: String? = nil, beta: Bool = false,
        @ViewBuilder content: () -> some View
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(title)
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                if beta { BetaChip() }
            }
            if let hint {
                Text(hint)
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .padding(.top, 2)
            }
            content()
                .padding(.top, 12)
        }
        // Fills the deck row, so cards swiped side by side share one bottom
        // edge; the row is as tall as its tallest card.
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .plCard(padding: 16)
    }

    static func eyebrow(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .medium))
            .tracking(0.5)
            .foregroundStyle(PL.text500)
            .padding(.bottom, 6)
    }

    static func footnote(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundStyle(PL.text600)
            .padding(.top, 10)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// Won against lost for one cut, as one bar: cyan won, magenta lost.
    static func splitBar(_ label: String, won: Int, lost: Int) -> some View {
        let total = won + lost
        let share = total > 0 ? Double(won) / Double(total) : 0
        return VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline) {
                Text(label)
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
        .padding(.vertical, 5)
    }

    /// A plain count bar, sized against the biggest count in its group.
    static func countBar(_ label: String, count: Int, max: Int, tone: Color) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline) {
                Text(label)
                    .font(.plCaption)
                    .foregroundStyle(PL.text300)
                    .lineLimit(1)
                Spacer()
                Text("\(count)")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(PL.text400)
                    .monospacedDigit()
            }
            GeometryReader { geo in
                Rectangle().fill(tone)
                    .frame(width: geo.size.width * (max > 0 ? Double(count) / Double(max) : 0))
            }
            .frame(height: 6)
            .background(PL.ink, in: Capsule())
            .clipShape(Capsule())
        }
        .padding(.vertical, 5)
    }

    static func statRow(_ label: String, value: Text) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text(label)
                    .font(.plCaption)
                    .foregroundStyle(PL.text400)
                Spacer()
                value
                    .font(.system(size: 13, weight: .semibold))
                    .monospacedDigit()
            }
            .padding(.vertical, 7)
            Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1)
        }
    }
}

private func speedLabel(_ band: SpeedBand) -> String {
    let from = band.fromKmh.map { Int($0.rounded()) }
    let to = band.toKmh.map { Int($0.rounded()) }
    switch (from, to) {
    case (nil, let to?): return "\(band.label) · under \(to) km/h"
    case (let from?, nil): return "\(band.label) · over \(from) km/h"
    case (let from?, let to?): return "\(band.label) · \(from) to \(to) km/h"
    default: return band.label
    }
}

// MARK: - Point length

struct PointLengthCard: View {
    let result: PointLengthResult
    /// A coach reads the player's match: "the player" where the owner reads "you".
    var voice: CardVoice = .owner

    var body: some View {
        let mine = result.mine.filter { $0.won + $0.lost > 0 }
        let theirs = result.theirs.filter { $0.won + $0.lost > 0 }
        ScoredCardStyle.card("Point length", hint: "Share of those points \(voice.you) won", beta: true) {
            VStack(alignment: .leading, spacing: 0) {
                if !mine.isEmpty {
                    ScoredCardStyle.eyebrow("\(voice.myServes) (\(count(result.mine)))")
                    ForEach(mine, id: \.label) { ScoredCardStyle.splitBar($0.label, won: $0.won, lost: $0.lost) }
                }
                if !theirs.isEmpty {
                    ScoredCardStyle.eyebrow("\(voice.theirServes) (\(count(result.theirs)))")
                        .padding(.top, mine.isEmpty ? 0 : 14)
                    ForEach(theirs, id: \.label) { ScoredCardStyle.splitBar($0.label, won: $0.won, lost: $0.lost) }
                }
                ScoredCardStyle.footnote(
                    "Timed from the serve's first bounce to the end of the rally, on \(result.covered) of \(result.considered) scored points."
                )
            }
        }
    }

    private func count(_ bands: [Tally]) -> Int { bands.reduce(0) { $0 + $1.won + $1.lost } }
}

// MARK: - Serve speed

struct ServeSpeedCard: View {
    let mine: [SpeedBand]
    let theirs: [SpeedBand]
    var voice: CardVoice = .owner

    var body: some View {
        ScoredCardStyle.card("Serve speed", hint: "Share of those points \(voice.you) won", beta: true) {
            VStack(alignment: .leading, spacing: 0) {
                if !mine.isEmpty {
                    ScoredCardStyle.eyebrow("\(voice.myServes) (\(count(mine)))")
                    ForEach(mine, id: \.label) { ScoredCardStyle.splitBar(speedLabel($0), won: $0.won, lost: $0.lost) }
                }
                if !theirs.isEmpty {
                    ScoredCardStyle.eyebrow("\(voice.theirServes) (\(count(theirs)))")
                        .padding(.top, mine.isEmpty ? 0 : 14)
                    ForEach(theirs, id: \.label) { ScoredCardStyle.splitBar(speedLabel($0), won: $0.won, lost: $0.lost) }
                }
                ScoredCardStyle.footnote(
                    "Speed along the table between the serve's two bounces. Slow, medium and fast are each a third of that player's serves."
                )
            }
        }
    }

    private func count(_ bands: [SpeedBand]) -> Int { bands.reduce(0) { $0 + $1.won + $1.lost } }
}

// MARK: - Where points ended

/// One table, both halves: endings on the opponent's half are points the
/// uploader won (cyan), endings on their own half are points they lost
/// (magenta). Shaded against one shared maximum so the halves read on the
/// same scale.
struct EndingsCard: View {
    let endings: EndingsResult
    let opponentLabel: String
    var voice: CardVoice = .owner

    var body: some View {
        ScoredCardStyle.card("Where points ended", hint: "The last bounce before the point was scored", beta: true) {
            VStack(alignment: .leading, spacing: 0) {
                canvas
                    .aspectRatio(PlacementTable.viewW / PlacementTable.viewH, contentMode: .fit)
                    .frame(maxWidth: 220)
                    .frame(maxWidth: .infinity)
                ScoredCardStyle.statRow(
                    "Points \(voice.you) won, on \(voice.their) side",
                    value: Text("\(endings.won)").foregroundStyle(PL.cyan)
                )
                ScoredCardStyle.statRow(
                    "Points \(voice.you) lost, on \(voice.your) side",
                    value: Text("\(endings.lost)").foregroundStyle(PL.magentaSoft)
                )
                ScoredCardStyle.footnote(
                    "Only points whose last bounce agrees with the score: \(endings.agreed) of \(endings.considered)."
                )
            }
        }
    }

    private var canvas: some View {
        Canvas { context, size in
            let s = size.width / PlacementTable.viewW
            drawPlacementTable(context, scale: s, topLabel: opponentLabel, bottomLabel: voice.mePill)
            let maxCount = max(1, (endings.wonCounts.values.max() ?? 0), (endings.lostCounts.values.max() ?? 0))
            let net = TABLE_L / 2
            let depthStep = net / 3
            let lateralStep = TABLE_W / 3
            let halves: [([PlacementZone: Int], Bool, Color)] = [
                (endings.wonCounts, false, PL.cyan),
                (endings.lostCounts, true, PL.magenta),
            ]
            for (counts, incoming, tone) in halves {
                for depth in PlacementDepth.allCases {
                    for lateral in PlacementLateral.allCases {
                        let zone = PlacementZone(depth: depth, lateral: lateral)
                        let count = counts[zone] ?? 0
                        let u0 = Double(lateral.rawValue) * lateralStep
                        let u1 = lateral == .right ? TABLE_W : Double(lateral.rawValue + 1) * lateralStep
                        let d = Double(depth.rawValue)
                        let v0: Double
                        let v1: Double
                        if incoming {
                            v0 = depth == .deep ? 0 : net - (d + 1) * depthStep
                            v1 = depth == .short ? net : net - d * depthStep
                        } else {
                            v0 = depth == .deep ? TABLE_L - depthStep : net + d * depthStep
                            v1 = depth == .deep ? TABLE_L : net + (d + 1) * depthStep
                        }
                        let x = PlacementTable.x + PlacementTable.w * u0 / TABLE_W
                        let y = PlacementTable.y + PlacementTable.h * (1 - v1 / TABLE_L)
                        let w = PlacementTable.w * (u1 - u0) / TABLE_W
                        let h = PlacementTable.h * (v1 - v0) / TABLE_L
                        let rect = CGRect(x: x * s, y: y * s, width: w * s, height: h * s)
                        var layer = context
                        layer.opacity = count == 0 ? 0.06 : 0.12 + 0.68 * (Double(count) / Double(maxCount))
                        layer.fill(Path(rect), with: .color(tone))
                        context.stroke(
                            Path(rect),
                            with: .color(Color(hex: 0x94A3B8).opacity(0.32)),
                            lineWidth: 0.75 * s
                        )
                        guard count > 0 else { continue }
                        context.draw(
                            Text("\(count)")
                                .font(.system(size: 11 * s, weight: .bold))
                                .foregroundStyle(Color(hex: 0xF8FAFC)),
                            at: CGPoint(x: rect.midX, y: rect.midY)
                        )
                    }
                }
            }
        }
    }
}

// MARK: - What's next

/// The one card that says what is still to do, always the last card until
/// nothing is left: which end the owner played from (the maps cannot be
/// oriented without it), scoring (the overview and the video cards need
/// 75% of the points, the bar the highlights use, so the rallies behind
/// them are confirmed), who served first on a scored match (the maps read
/// whose serve each dot is from the rotation, and without it every point
/// is skipped), and the detailed analysis. The steps are in order,
/// not side by side (Adil, 2026-09-15): scoring confirms the cuts, the
/// servers and the winners, and the worker reads the corrected windows
/// when it runs, so generating is offered only once the match is scored.
/// An analysis that already exists, or is running, shows as a status row
/// at any time. The web's NextStepCard.
struct NextStepCard: View {
    let match: MatchRow
    let gate: ScoredCardsGate
    let scoredType: Bool
    let sideMissing: Bool
    /// The analysis is on the way and nobody has said who served first.
    var askFirstServer = false
    let onScore: (() -> Void)?
    /// Re-read the match once the side or the analysis request changed.
    let onChanged: () -> Void
    /// The cut video, for the still the side question is answered from.
    var videoURL: URL? = nil
    /// Record who served first; resolves to whether the write landed.
    var onSetFirstServer: ((Winner) async -> Bool)? = nil

    @State private var analysisSheetOpen = false
    @State private var sideSheetOpen = false
    @State private var savingServer = false

    private var status: String { match.placementStatus ?? "not_requested" }
    private var generating: Bool { status == "processing" || status == "retrying" }
    /// Generate (or try again) comes after scoring; a practice match has
    /// nothing to score and gets it straight away.
    private var offerAnalysis: Bool { !scoredType || gate.open }
    /// Once the bar is met the scoring row steps aside: the one thing left
    /// to do is the analysis.
    private var showScoring: Bool { scoredType && !gate.open }
    /// One step at a time: the Generate button waits for the answer.
    private var showFirstServer: Bool {
        askFirstServer && onSetFirstServer != nil && offerAnalysis
    }
    private var showAnalysis: Bool {
        status != "ready" && (generating || (offerAnalysis && !showFirstServer))
    }
    private var analysisReason: String? {
        switch status {
        case "processing", "retrying", "final_failed": nil
        case "retry_available": "The table was hard to detect."
        default: "Unlocks the serve maps, point length, serve speed and where points ended."
        }
    }


    private var analysisAction: String? {
        switch status {
        case "retry_available": "Try again"
        case "ready", "processing", "retrying", "final_failed": nil
        default: "Generate detailed analysis"
        }
    }

    var body: some View {
        ScoredCardStyle.card("What's next") {
            VStack(alignment: .leading, spacing: 0) {
                if sideMissing {
                    row("Which end did you play from?", done: false) {
                        secondaryButton("Choose your end") { sideSheetOpen = true }
                    }
                }
                if showScoring {
                    row("Score the match", done: false) {
                        Text(status == "ready"
                            ? "Unlocks the overview, point length, serve speed and where points ended."
                            : "Unlocks the overview and the detailed analysis.")
                            .font(.plCaption)
                            .foregroundStyle(PL.text400)
                            .fixedSize(horizontal: false, vertical: true)
                        GeometryReader { geo in
                            Rectangle().fill(PL.cyan)
                                .frame(width: geo.size.width * min(1, gate.share))
                        }
                        .frame(height: 6)
                        .background(PL.ink, in: Capsule())
                        .clipShape(Capsule())
                        .padding(.top, 8)
                        (Text("\(gate.scored) of \(gate.eligible) points scored")
                            .foregroundStyle(PL.text300)
                            + Text(gate.open ? "" : " · \(gate.required) needed").foregroundStyle(PL.text500))
                            .font(.plCaption)
                            .monospacedDigit()
                            .padding(.top, 8)
                        if let onScore {
                            primaryButton(gate.scored == 0 ? "Score the match" : "Keep scoring", action: onScore)
                        }
                    }
                }
                if showFirstServer, let onSetFirstServer {
                    row("Who served first?", done: false) {
                        HStack(spacing: 8) {
                            secondaryButton("Me") { saveFirstServer(.user, onSetFirstServer) }
                            secondaryButton("Them") { saveFirstServer(.opponent, onSetFirstServer) }
                        }
                        .disabled(savingServer)
                    }
                }
                if showAnalysis {
                    row("Detailed analysis", done: false) {
                        if status == "final_failed" {
                            Text("Not available for this video.")
                                .font(.plCaption)
                                .foregroundStyle(PL.text400)
                                .fixedSize(horizontal: false, vertical: true)
                        } else if let analysisReason {
                            Text(analysisReason)
                                .font(.plCaption)
                                .foregroundStyle(PL.text400)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if generating {
                            HStack(spacing: 8) {
                                ProgressView().tint(PL.cyan)
                                Text(status == "retrying" ? "Retrying…" : "Generating…")
                                    .font(.plCaption)
                                    .foregroundStyle(PL.text300)
                            }
                            .padding(.top, 10)
                        }
                        if offerAnalysis, !showFirstServer, let analysisAction {
                            primaryButton(analysisAction) { analysisSheetOpen = true }
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $analysisSheetOpen) {
            PlacementRequestSheet(match: match, onChanged: onChanged)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $sideSheetOpen) {
            YourSideSheet(match: match, videoURL: videoURL, onSaved: onChanged)
        }
    }

    /// The screen re-reads the match once the write lands, and the row
    /// steps aside for the analysis.
    private func saveFirstServer(_ value: Winner, _ save: @escaping (Winner) async -> Bool) {
        guard !savingServer else { return }
        savingServer = true
        Task {
            _ = await save(value)
            savingServer = false
        }
    }

    /// One row: the title with a check once it is done, then its detail
    /// and its action, divided like the stat rows above it.
    private func row<Content: View>(
        _ title: String, done: Bool, @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Text(title)
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                Spacer()
                if done {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(PL.cyan)
                        .frame(width: 20, height: 20)
                        .background(PL.cyan.opacity(0.15), in: Circle())
                }
            }
            content()
            Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1)
                .padding(.top, 12)
        }
        .padding(.bottom, 12)
    }

    private func primaryButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.plButton)
                .foregroundStyle(PL.ink)
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .background(PL.cyan, in: Capsule())
        .padding(.top, 12)
    }

    private func secondaryButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.plButton)
                .foregroundStyle(PL.text100)
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
        .padding(.top, 12)
    }
}


// MARK: - What is still to come

/// The deck ends on what is still to come. A placeholder card rather than
/// a line of copy, so the list reaches a real last card and the promise
/// sits where the next card will. Dashed border: it is a space, not a
/// result.
struct ComingSoonCard: View {
    var body: some View {
        VStack(spacing: 18) {
            HStack(alignment: .bottom, spacing: 6) {
                ForEach([18, 30, 12, 24, 20], id: \.self) { height in
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(PL.cyan.opacity(0.2))
                        .frame(width: 8, height: CGFloat(height))
                }
            }
            .frame(height: 30, alignment: .bottom)
            Text("More match analysis cards coming soon.")
                .font(.plRowTitle)
                .foregroundStyle(PL.text100)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, 40)
        .padding(.horizontal, 24)
        .background(PL.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.edge, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
        )
    }
}
