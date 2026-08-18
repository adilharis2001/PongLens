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
