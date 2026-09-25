import SwiftUI

// The two ways to turn a video into points, as views shared by the raw
// match page ("Break it into points") and More options on a processed match
// (docs/superpowers/specs/2026-09-25-cut-again-design.md, 2b: "the same
// components as on the raw page, so both places look and behave the same").
// The raw page used to draw these inline in MatchDetailScreen.processCard;
// they moved here unchanged, with a slot for the Replace or Keep choice that
// only More options fills.

/// A row that opens in place: title, an optional line under it, the value
/// it trails (the minutes, "{N} marked"), and a chevron that turns over.
struct AccordionHeaderRow: View {
    let title: String
    var detail: String? = nil
    var trailing: String? = nil
    let open: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.plRowTitle)
                        .foregroundStyle(PL.text100)
                    if let detail {
                        Text(detail)
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                    }
                }
                Spacer(minLength: 8)
                if let trailing {
                    Text(trailing)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(PL.text300)
                        .monospacedDigit()
                }
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.text500)
                    .rotationEffect(.degrees(open ? 180 : 0))
            }
            .padding(20)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Automatically: what to process (the trim bar), cut strictness, then the
/// button with the price and the balance under it. `choice` sits between
/// the settings and the button; the raw page leaves it empty.
struct AutoProcessControls<Choice: View>: View {
    let durationS: Double?
    @Binding var trimStart: Double
    @Binding var trimEnd: Double?
    @Binding var strictness: String
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
                    RawTrimBar(
                        duration: duration,
                        start: $trimStart,
                        end: Binding(
                            get: { trimEnd ?? duration },
                            set: { trimEnd = $0 }
                        )
                    )
                }
            }

            Divider().overlay(PL.edge)

            VStack(alignment: .leading, spacing: 4) {
                Text("Cut strictness")
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                Text("How much room to leave around each point.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                HStack(spacing: 4) {
                    ForEach(["tight", "normal", "loose"], id: \.self) { level in
                        let active = strictness == level
                        Button(level.capitalized) {
                            withAnimation(.easeOut(duration: 0.15)) { strictness = level }
                        }
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(active ? PL.ink : PL.text400)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                        .background(
                            active ? PL.cyan : .clear,
                            in: RoundedRectangle(cornerRadius: PL.rSmall, style: .continuous)
                        )
                        .buttonStyle(.plain)
                    }
                }
                .padding(3)
                .background(PL.ink.opacity(0.5), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                .padding(.top, 8)
            }

            choice()

            if let error {
                Text(error)
                    .font(.plCaption)
                    .foregroundStyle(PL.warningText)
            }

            // Full width, with the balance under it rather than floating
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
                    Text(busy ? "Starting…" : ProcessCharge.label(minutes: minutes, again: again))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(PLPrimaryButtonStyle())
                .disabled(busy || !enough)
                if let balance {
                    Text(
                        enough
                            ? "\(balance) minutes left"
                            : "Not enough minutes. You have \(balance)."
                    )
                    .font(.plCaption)
                    .foregroundStyle(enough ? PL.text500 : PL.warningText)
                }
                if !enough {
                    AllowanceRecoveryView(resource: "minutes", retryLabel: "Check minutes") {
                        try await recheckMinutes()
                    }
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
        strictness: Binding<String>, error: String?, busy: Bool, balance: Int?,
        needsMoreMinutes: Bool, recheckMinutes: @escaping () async throws -> Void,
        onProcess: @escaping () -> Void
    ) {
        self.init(
            durationS: durationS, trimStart: trimStart, trimEnd: trimEnd,
            strictness: strictness, error: error, busy: busy, balance: balance,
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
/// rounded field lit in the accent when chosen, with a radio mark so both
/// read as a choice before either is picked. Under Replace, while it is
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
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        return Button {
            withAnimation(.easeOut(duration: 0.15)) { state.select(choice) }
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 12) {
                    Text(isReplace ? CutAgainCopy.replace : CutAgainCopy.keep)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(on ? PL.cyan : PL.text100)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
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
                }
                ForEach(lines, id: \.self) { line in
                    Text(line)
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
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
        .buttonStyle(.plain)
        .disabled(!enabled || disabled)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
