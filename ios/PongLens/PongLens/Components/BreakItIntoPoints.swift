import SwiftUI

// The two ways to turn a video into points, as views shared by the raw
// match page ("Break it into points") and More options on a processed match
// (docs/superpowers/specs/2026-09-25-cut-again-design.md, 2b: "the same
// components as on the raw page, so both places look and behave the same").
// The raw page used to draw these inline in MatchDetailScreen.processCard;
// they moved here unchanged, with a slot for the Replace or Keep choice that
// only More options fills.

/// The radio mark of every choice in this feature (the two ways, Replace or
/// Keep): a ring, filled in the accent with a tick once chosen. Hidden from
/// VoiceOver; the cell says it is selected.
struct ChoiceMark: View {
    let on: Bool

    var body: some View {
        ZStack {
            Circle()
                .strokeBorder(on ? PL.cyan : PL.text600, lineWidth: 1)
                .background(Circle().fill(on ? PL.cyan : .clear))
            if on {
                Image(systemName: "checkmark")
                    .font(.system(size: 9, weight: .heavy))
                    .foregroundStyle(PL.ink)
            }
        }
        .frame(width: 18, height: 18)
        .accessibilityHidden(true)
    }
}

extension View {
    /// The field a choice cell sits in: lit in the accent when chosen,
    /// dimmed when it cannot be chosen, tappable across its whole area and
    /// never under 44pt.
    func choiceCell(on: Bool, enabled: Bool = true) -> some View {
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        return self
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(
                !enabled ? PL.ink.opacity(0.2) : on ? PL.cyan.opacity(0.1) : PL.ink.opacity(0.4),
                in: shape
            )
            .overlay(
                shape.strokeBorder(
                    !enabled ? PL.edge.opacity(0.6) : on ? PL.cyan.opacity(0.7) : PL.edge,
                    lineWidth: 1
                )
            )
            .opacity(enabled ? 1 : 0.5)
            .contentShape(shape)
    }
}

/// What a choice cell holds, laid out the same in every choice here (the
/// two ways, Replace or Keep): the radio on the left, level with the title;
/// under the title whatever lines the choice has; on the right anything it
/// trails, level with the title too. Each choice keeps its own line style.
struct ChoiceLabel<Below: View>: View {
    let on: Bool
    let title: String
    var trailing: String? = nil
    /// Between the title and the lines under it.
    var spacing: CGFloat = 2
    @ViewBuilder var below: () -> Below

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            // The ring's middle on the middle of the title's capitals, about
            // five points above its baseline at 14pt.
            ChoiceMark(on: on)
                .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 5 }
            VStack(alignment: .leading, spacing: spacing) {
                Text(title)
                    .font(.plRowTitle)
                    .foregroundStyle(on ? PL.cyan : PL.text100)
                below()
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            if let trailing {
                Text(trailing)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PL.text300)
                    .monospacedDigit()
            }
        }
    }
}

/// The two ways as one choice (owner's option A, 2026-09-25): two cells,
/// neither selected until the player taps one (no default, 2026-09-25),
/// then only the selected way's controls. Used as is by the raw page's
/// Break it into points and by More options, so both read the same. A
/// player who cannot mark by hand never sees this: the caller draws the
/// automatic controls on their own.
struct CutWayPicker<Automatic: View, Marking: View>: View {
    /// Nil until a tap: nothing shows under the pair.
    let selected: CutWay?
    /// "{N} marked" on Mark the points yourself. Automatically trails
    /// nothing: its cost is the line under its button.
    let markingTrailing: String?
    /// False greys Mark the points yourself (no original to mark).
    var markingEnabled = true
    let onSelect: (CutWay) -> Void
    @ViewBuilder var automatic: () -> Automatic
    @ViewBuilder var marking: () -> Marking

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(spacing: 10) {
                cell(.automatic)
                cell(.byHand)
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            // The chosen way's controls carry their own padding; with none
            // chosen the card still closes 20 under the cells.
            .padding(.bottom, selected == nil ? 20 : 0)
            switch selected {
            case .automatic: automatic()
            case .byHand: marking()
            case nil: EmptyView()
            }
        }
    }

    private func cell(_ way: CutWay) -> some View {
        let isAuto = way == .automatic
        let enabled = isAuto || markingEnabled
        let on = selected == way
        let trailing = isAuto ? nil : markingTrailing
        return Button {
            withAnimation(.easeOut(duration: 0.15)) { onSelect(way) }
        } label: {
            ChoiceLabel(
                on: on,
                title: isAuto ? CutAgainCopy.automatically : CutAgainCopy.markYourself,
                trailing: trailing
            ) {
                Text(isAuto ? CutAgainCopy.automaticallyDetail : CutAgainCopy.markYourselfDetail)
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            .choiceCell(on: on, enabled: enabled)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Automatically: what to process (the trim with its preview), then the
/// button with what it uses under it. `choice` sits between the trim and
/// the button; the raw page leaves it empty. Cut strictness is gone from
/// here (owner, 2026-09-25): every request sends "normal".
struct AutoProcessControls<Choice: View>: View {
    let durationS: Double?
    @Binding var trimStart: Double
    @Binding var trimEnd: Double?
    /// The video under the trim: the phone's own copy or the original's
    /// link. Nil leaves the bar on its own.
    let previewURL: URL?
    /// The link is on its way.
    var previewLoading = false
    let error: String?
    let busy: Bool
    let balance: Int?
    let needsMoreMinutes: Bool
    /// "Check minutes" in the allowance card: re-read the balance.
    let recheckMinutes: () async throws -> Void
    let onProcess: () -> Void
    /// More options: the button reads "Process again".
    var again = false
    @ViewBuilder var choice: () -> Choice

    private var trimmed: Bool {
        ProcessCharge.trimmed(durationS: durationS, trimStart: trimStart, trimEnd: trimEnd)
    }
    private var minutes: Int? {
        ProcessCharge.minutes(durationS: durationS, trimStart: trimStart, trimEnd: trimEnd)
    }
    private var enough: Bool {
        ProcessCharge.enough(minutes: minutes, balance: balance, needsMore: needsMoreMinutes)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let duration = durationS, duration > 10 {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("What to process")
                            .font(.plRowTitle)
                            .foregroundStyle(PL.text100)
                        Spacer()
                        if trimmed {
                            Button("Reset") {
                                trimStart = 0
                                trimEnd = nil
                            }
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(PL.cyan)
                            .buttonStyle(.plain)
                        }
                    }
                    TrimPreview(
                        source: previewURL,
                        loading: previewLoading,
                        duration: duration,
                        start: $trimStart,
                        end: $trimEnd
                    )
                }
            }

            choice()

            if let error {
                Text(error)
                    .font(.plCaption)
                    .foregroundStyle(PL.warningText)
            }

            // Full width, with what it uses under it rather than floating
            // alongside. A hugging pill beside a loose sentence was the
            // single scrappiest thing on the raw page.
            VStack(spacing: 8) {
                Button {
                    onProcess()
                } label: {
                    // The width has to be on the LABEL, not on the Button:
                    // PLPrimaryButtonStyle paints its capsule around whatever
                    // the label measures, so a frame outside the style
                    // stretches the tap target and leaves the pill hugging in
                    // the middle.
                    Text(busy ? "Starting…" : ProcessCharge.label(again: again))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(PLPrimaryButtonStyle())
                .disabled(busy || !enough)
                if !enough {
                    if let balance {
                        Text(ProcessCharge.notEnoughLine(balance: balance))
                            .font(.plCaption)
                            .foregroundStyle(PL.warningText)
                    }
                    AllowanceRecoveryView(resource: "minutes", retryLabel: "Check minutes") {
                        try await recheckMinutes()
                    }
                } else if let uses = ProcessCharge.usesLine(minutes: minutes, balance: balance) {
                    // Follows the trim as a handle moves.
                    Text(uses)
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                        .monospacedDigit()
                }
            }
            .padding(.top, 2)
        }
        .padding(20)
    }
}

extension AutoProcessControls where Choice == EmptyView {
    init(
        durationS: Double?, trimStart: Binding<Double>, trimEnd: Binding<Double?>,
        previewURL: URL?, previewLoading: Bool = false,
        error: String?, busy: Bool, balance: Int?,
        needsMoreMinutes: Bool, recheckMinutes: @escaping () async throws -> Void,
        onProcess: @escaping () -> Void
    ) {
        self.init(
            durationS: durationS, trimStart: trimStart, trimEnd: trimEnd,
            previewURL: previewURL, previewLoading: previewLoading,
            error: error, busy: busy, balance: balance,
            needsMoreMinutes: needsMoreMinutes, recheckMinutes: recheckMinutes,
            onProcess: onProcess, choice: { EmptyView() }
        )
    }
}

/// Mark the points yourself: the switch that decides whether the pass
/// also scores, one line under it that changes with it, and the button that
/// opens the marker at its gate.
struct MarkYourselfControls: View {
    /// Practice and drills: cut only, the switch greyed and fixed.
    let practice: Bool
    let mode: HandCutMode
    let onMode: (HandCutMode) -> Void
    /// A draft exists: "Keep marking" rather than "Start marking".
    let resuming: Bool
    let opening: Bool
    /// The original is there to mark.
    let enabled: Bool
    let onStart: () -> Void

    var body: some View {
        let on = mode == .score && !practice
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(MarkerCopy.scoreLabel(on: on, practice: practice))
                        .font(.plRowTitle)
                        .foregroundStyle(practice ? PL.text500 : PL.text100)
                    Text(MarkerCopy.scoreDetail(on: on, practice: practice))
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityHidden(true)
                Spacer(minLength: 8)
                Toggle(MarkerCopy.scoreLabel(on: on, practice: practice), isOn: Binding(
                    get: { on },
                    set: { onMode($0 ? .score : .cut) }
                ))
                .labelsHidden()
                .tint(PL.cyan)
                .disabled(practice)
                .accessibilityHint(MarkerCopy.scoreDetail(on: on, practice: practice))
            }
            Button {
                onStart()
            } label: {
                // The width on the label, as the Process button does it.
                HStack(spacing: 8) {
                    if opening { ProgressView().controlSize(.small).tint(PL.ink) }
                    Text(resuming ? "Keep marking" : "Start marking")
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: 20)
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .disabled(opening || !enabled)
        }
        .padding(20)
    }
}

/// Replace this match, or keep it and add a new one: two cells, one
/// selected, Keep by default. The web's RecutChoice, cell for cell: a
/// rounded field lit in the accent when chosen, with a radio mark on the
/// left so both read as a choice before either is picked, laid out like
/// the two ways above it (ChoiceLabel). Under Replace's title, while it is
/// chosen, what it deletes; a greyed Replace says why only when the reason
/// is the player's to know (a coach review).
struct RecutChoiceView: View {
    @Binding var state: RecutChoiceState
    var disabled = false

    var body: some View {
        VStack(spacing: 10) {
            cell(.replace)
            cell(.keep)
        }
    }

    private func cell(_ choice: RecutChoice) -> some View {
        let isReplace = choice == .replace
        let enabled = !isReplace || state.replaceAllowed
        let on = state.selected == choice && enabled
        let lines: [String] = isReplace
            ? (enabled ? state.replaceLines : state.replaceBlockedLine.map { [$0] } ?? [])
            : []
        return Button {
            withAnimation(.easeOut(duration: 0.15)) { state.select(choice) }
        } label: {
            ChoiceLabel(
                on: on,
                title: isReplace ? CutAgainCopy.replace : CutAgainCopy.keep,
                spacing: 6
            ) {
                ForEach(lines, id: \.self) { line in
                    Text(line)
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                }
            }
            .choiceCell(on: on, enabled: enabled)
        }
        .buttonStyle(.plain)
        .disabled(!enabled || disabled)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
