import SwiftUI

// MARK: - Arena background

/// The radial wash behind every signed-in screen. The app is never flat black.
struct ArenaBackground: View {
    var body: some View {
        ZStack {
            PL.ink
            EllipticalGradient(
                colors: [PL.cyan.opacity(0.12), .clear],
                center: UnitPoint(x: 0.5, y: -0.1),
                endRadiusFraction: 0.6
            )
            EllipticalGradient(
                colors: [PL.magenta.opacity(0.07), .clear],
                center: UnitPoint(x: 0.85, y: 0.15),
                endRadiusFraction: 0.45
            )
        }
        .ignoresSafeArea()
    }
}

// MARK: - Card

extension View {
    /// The canonical card: surface fill, 1px edge border, 16pt continuous radius,
    /// no shadow. Depth comes from the border against the arena wash.
    func plCard(padding: CGFloat = 20) -> some View {
        self
            .padding(padding)
            .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
    }

    /// Nested surface inside a card: ink at 40%, 12pt radius.
    func plInnerRow(padding: CGFloat = 14) -> some View {
        self
            .padding(padding)
            .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
    }
}

// MARK: - Chooser sheet

/// The half-sheet a create button opens when there is more than one way
/// to make the thing. Title, then rows, and nothing else — the choice is
/// the whole screen.
struct PLChooserSheet<Content: View>: View {
    let title: String
    @ViewBuilder var rows: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.plPageTitle)
                .tracking(-0.6)
                .foregroundStyle(PL.textBody)
                .padding(.bottom, 4)
            rows()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
    }
}

/// One option on a chooser sheet. Each row carries a line naming the
/// situation it suits rather than leaning on its verb alone: the reader is
/// picking between two circumstances, not two words.
struct PLChooserRow: View {
    let icon: String
    let title: String
    let detail: String
    /// Designed but not yet wired up. The row renders flat and does not
    /// respond, so the shape of the feature is visible while the tap that
    /// would lead nowhere is never offered.
    var pending = false
    var action: () -> Void = {}

    @ViewBuilder
    var body: some View {
        if pending {
            row.opacity(0.55)
        } else {
            Button(action: action) { row }
                .buttonStyle(.plain)
        }
    }

    private var row: some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundStyle(PL.cyan)
                .frame(width: 44, height: 44)
                .background(PL.cyan.opacity(0.1), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Text(detail)
                    .font(.plCaption)
                    .foregroundStyle(PL.text400)
                    // A detail that runs to two lines must grow the row
                    // rather than be cut off at the first.
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            if !pending {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PL.text500)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plInnerRow(padding: 14)
        .contentShape(Rectangle())
    }
}

// MARK: - Skeleton

/// One placeholder line. Bars stand in for the text that is coming, laid
/// out in roughly its shape, so the card is already the right size when
/// the real thing lands and nothing jumps.
struct PLSkeletonBar: View {
    /// Left-aligned and capped, so a block of bars has the ragged right
    /// edge that real sentences do. A row of identical full-width bars
    /// reads as a table.
    var maxWidth: CGFloat = .infinity
    var height: CGFloat = 12

    var body: some View {
        Capsule()
            // edge, not surface2: against a card already filled with
            // surface, surface2 is four values away and the bars read as
            // a smudge rather than as lines.
            .fill(PL.edge)
            .frame(maxWidth: maxWidth)
            .frame(height: height)
    }
}

extension View {
    /// A slow sweep of light across the placeholder bars, masked to the
    /// bars themselves so the gaps stay dark.
    ///
    /// Movement rather than a spinner. A spinner says something is
    /// happening somewhere; the sweep happens in the exact place the
    /// answer is going to appear, which is the difference between waiting
    /// and watching. Held at one sweep every 1.4s: fast enough to read as
    /// alive, slow enough not to nag on a wait that runs several seconds.
    func plShimmer() -> some View { modifier(PLShimmer()) }
}

private struct PLShimmer: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var run = false

    @ViewBuilder
    func body(content: Content) -> some View {
        if reduceMotion {
            // Still legible as a placeholder standing still: the bars are
            // the message, the sweep is only the pulse.
            content
        } else {
            content
                .overlay {
                    GeometryReader { geo in
                        let w = geo.size.width
                        let band = max(w * 0.45, 80)
                        LinearGradient(
                            colors: [.clear, PL.cyan.opacity(0.22), .clear],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                        .frame(width: band)
                        .offset(x: run ? w : -band)
                    }
                }
                .mask { content }
                .onAppear {
                    withAnimation(
                        .linear(duration: 1.4).repeatForever(autoreverses: false)
                    ) { run = true }
                }
        }
    }
}

// MARK: - Buttons

struct PLPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.plButton)
            .foregroundStyle(PL.ink)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(PL.cyan, in: Capsule())
            .overlay(Capsule().strokeBorder(PL.cyan.opacity(0.4), lineWidth: 1))
            .shadow(color: PL.cyan.opacity(configuration.isPressed ? 0.5 : 0.35), radius: 12)
            .shadow(color: PL.cyan.opacity(0.18), radius: 20, y: 4)
            .opacity(configuration.isPressed ? 0.9 : 1)
    }
}

struct PLSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.plButtonSecondary)
            .foregroundStyle(configuration.isPressed ? .white : PL.text300)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(configuration.isPressed ? PL.surface2 : .clear, in: Capsule())
            .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
    }
}

struct PLCyanGhostButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.plButton)
            .foregroundStyle(PL.cyan)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(PL.cyan.opacity(0.1), in: Capsule())
            .overlay(Capsule().strokeBorder(PL.cyan.opacity(0.5), lineWidth: 1))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

/// Cancel, decline, discard. Presses toward amber, never red.
struct PLSoftDestructiveButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.plButtonSecondary)
            .foregroundStyle(configuration.isPressed ? PL.warning : PL.text400)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .overlay(
                Capsule().strokeBorder(
                    configuration.isPressed ? PL.warning.opacity(0.4) : PL.edge,
                    lineWidth: 1
                )
            )
    }
}

struct PLDestructiveButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(PL.dangerText)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(PL.dangerFill.opacity(0.1), in: Capsule())
            .overlay(Capsule().strokeBorder(PL.dangerFill.opacity(configuration.isPressed ? 0.7 : 0.4), lineWidth: 1))
    }
}

// MARK: - Section heading

/// 12pt semibold uppercase, wide tracking, caption grey.
struct SectionHeading: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased())
            .font(.plSection)
            .tracking(0.6)
            .foregroundStyle(PL.text500)
    }
}

// MARK: - Status chip

enum PLStatus {
    case notProcessed, queued, processing, ready, failed

    var label: String {
        switch self {
        case .notProcessed: "Not processed"
        case .queued: "Queued"
        case .processing: "Processing"
        case .ready: "Ready"
        case .failed: "Failed"
        }
    }

    var tint: Color {
        switch self {
        case .notProcessed: PL.text500
        case .queued: PL.cyan
        case .processing: PL.warning
        case .ready: PL.success
        case .failed: PL.danger
        }
    }

    var textColor: Color {
        switch self {
        case .notProcessed: PL.text300
        case .queued: PL.cyan
        case .processing: PL.warningText
        case .ready: PL.successText
        case .failed: PL.dangerText
        }
    }
}

struct StatusChip: View {
    let status: PLStatus
    @State private var pulsing = false

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(status.tint)
                .frame(width: 6, height: 6)
                .opacity(status == .queued && pulsing ? 0.7 : 1)
            Text(status.label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(status.textColor)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 3)
        .background(status.tint.opacity(0.1), in: Capsule())
        .overlay(Capsule().strokeBorder(status.tint.opacity(0.4), lineWidth: 1))
        .onAppear {
            guard status == .queued else { return }
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                pulsing = true
            }
        }
    }
}

// MARK: - Score pill

struct ScorePill: View {
    let you: Int
    let them: Int

    var body: some View {
        HStack(spacing: 3) {
            Text("\(you)").foregroundStyle(PL.cyan)
            Text("\u{2013}").foregroundStyle(PL.text600)
            Text("\(them)").foregroundStyle(PL.magentaSoft)
        }
        .font(.system(size: 11, weight: .semibold))
        .monospacedDigit()
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .background(PL.ink.opacity(0.5), in: Capsule())
        .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
    }
}

// MARK: - Text field treatment

extension View {
    func plField() -> some View {
        self
            .font(.plBody)
            .foregroundStyle(PL.text100)
            .tint(PL.cyan)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(PL.surface2.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
    }
}

// MARK: - Keyboard dismissal

/// The hide-keyboard button, shared by every screen that types: a circle
/// riding the keyboard's top edge that resigns first responder.
struct PLKeyboardDismissButton: View {
    var body: some View {
        Button {
            UIApplication.shared.sendAction(
                #selector(UIResponder.resignFirstResponder),
                to: nil, from: nil, for: nil
            )
        } label: {
            Image(systemName: "keyboard.chevron.compact.down")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(PL.text300)
                .frame(width: 40, height: 40)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Hide keyboard")
    }
}

/// Two ways to put the keyboard away wherever text is typed: drag the
/// scroll view past it, or tap the chevron floating above it. The chevron
/// is a keyboard-tracking inset rather than a ToolbarItemGroup(.keyboard)
/// because the paged TabView swallows keyboard toolbar items — declared
/// inside its pages or above it — and sheets presented from those pages
/// lose them too. The inset bar behaves the same everywhere.
private struct PLKeyboardDismiss: ViewModifier {
    @State private var keyboardVisible = false

    func body(content: Content) -> some View {
        content
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if keyboardVisible {
                    HStack {
                        Spacer()
                        PLKeyboardDismissButton()
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 8)
                }
            }
            .onReceive(NotificationCenter.default.publisher(
                for: UIResponder.keyboardWillShowNotification
            )) { _ in keyboardVisible = true }
            .onReceive(NotificationCenter.default.publisher(
                for: UIResponder.keyboardWillHideNotification
            )) { _ in keyboardVisible = false }
    }
}

extension View {
    /// Apply at the screen level. Sheets and full-screen covers present in
    /// their own context, so they need their own copy — the host screen's
    /// does not reach them.
    func plKeyboardDismiss() -> some View {
        modifier(PLKeyboardDismiss())
    }
}

// MARK: - Logo

struct LogoMark: View {
    var size: CGFloat = 32

    var body: some View {
        // Strokes and paddings scale with the mark, so a splash-sized ring
        // keeps the 32pt proportions instead of going spindly.
        let s = size / 32
        ZStack {
            Circle()
                .stroke(PL.cyan.opacity(0.95), lineWidth: 2.5 * s)
                .padding(2 * s)
            Circle()
                .trim(from: 0.55, to: 0.72)
                .stroke(PL.cyan.opacity(0.5), style: StrokeStyle(lineWidth: 2 * s, lineCap: .round))
                .padding(7 * s)
        }
        .frame(width: size, height: size)
    }
}

struct LogoWordmark: View {
    var body: some View {
        HStack(spacing: 10) {
            LogoMark()
            HStack(spacing: 0) {
                Text("Pong").foregroundStyle(.white)
                Text("Lens").foregroundStyle(PL.cyan)
            }
            .font(.system(size: 18, weight: .semibold))
            .tracking(-0.4)
        }
    }
}

// MARK: - Toast

struct PLToast: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.plCaption)
            .foregroundStyle(PL.text300)
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .background(PL.ink.opacity(0.85), in: Capsule())
            .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
    }
}
