import SwiftUI

/// The web TrimBar, sized for a thumb: a track for the whole raw video
/// with two handles bounding the window that gets processed. The web
/// pairs its bar with "Start here / End here" stamps read off an inline
/// player; this page plays video in a full-screen takeover instead, so
/// here the handles are the whole interface and the clocks under the bar
/// do the orienting.
///
/// The window never closes below five seconds — same floor as the web —
/// and each handle only pushes its own edge, so a fast drag cannot fling
/// start past end.
struct RawTrimBar: View {
    let duration: Double
    @Binding var start: Double
    @Binding var end: Double

    /// Which handle a drag began on. Resolved once at drag start from
    /// proximity, so a finger that wanders past the other handle keeps
    /// the one it grabbed.
    @State private var dragging: Edge?

    private enum Edge { case start, end }
    private let minWindow: Double = 5

    var body: some View {
        VStack(spacing: 6) {
            GeometryReader { geo in
                let w = geo.size.width
                let x0 = w * (start / duration)
                let x1 = w * (end / duration)
                ZStack(alignment: .leading) {
                    // Whole video.
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(PL.ink.opacity(0.6))
                    // The kept window.
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(PL.cyan.opacity(0.18))
                        .overlay(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .strokeBorder(PL.cyan.opacity(0.55), lineWidth: 1)
                        )
                        .frame(width: max(0, x1 - x0))
                        .offset(x: x0)
                    handle(at: x0)
                    handle(at: x1)
                }
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            if dragging == nil {
                                let mid = (x0 + x1) / 2
                                dragging = value.startLocation.x < mid ? .start : .end
                            }
                            let t = duration * min(1, max(0, value.location.x / w))
                            switch dragging {
                            case .start:
                                start = min(t, end - minWindow)
                                start = max(0, start)
                            case .end:
                                end = max(t, start + minWindow)
                                end = min(duration, end)
                            case nil:
                                break
                            }
                        }
                        .onEnded { _ in dragging = nil }
                )
            }
            .frame(height: 34)

            HStack {
                Text(clock(start))
                Spacer()
                Text("\(clock(end - start)) kept")
                    .foregroundStyle(PL.text300)
                Spacer()
                Text(clock(end))
            }
            .font(.plCaption)
            .monospacedDigit()
            .foregroundStyle(PL.text500)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "Trim. Keeping \(clock(end - start)) from \(clock(start)) to \(clock(end))."
        )
    }

    private func handle(at x: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 3, style: .continuous)
            .fill(PL.cyan)
            .frame(width: 12, height: 34)
            .overlay(
                RoundedRectangle(cornerRadius: 1, style: .continuous)
                    .fill(PL.ink.opacity(0.7))
                    .frame(width: 2, height: 14)
            )
            .offset(x: x - 6)
    }

    private func clock(_ seconds: Double) -> String {
        let t = max(0, Int(seconds.rounded()))
        let h = t / 3600
        let m = (t % 3600) / 60
        let sec = t % 60
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, sec)
            : String(format: "%d:%02d", m, sec)
    }
}
