import SwiftUI

/// Draw on a paused clip frame — the web Annotator's flow, native: freehand
/// strokes over the frame, a small palette, undo, and Save renders the
/// composite JPEG for the note being written.
struct AnnotatorView: View {
    let frame: UIImage
    let onCancel: () -> Void
    let onSave: (Data) async -> Bool

    private struct Stroke: Identifiable {
        let id = UUID()
        var points: [CGPoint] // normalized 0…1 in image space
        let color: Color
    }

    @State private var strokes: [Stroke] = []
    @State private var current: Stroke?
    @State private var color: Color = Color(hex: 0x22D3EE)
    @State private var saving = false
    @State private var failed = false

    private let palette: [Color] = [
        Color(hex: 0x22D3EE), Color(hex: 0xF43F5E), Color(hex: 0xFACC15), .white,
    ]

    var body: some View {
        ZStack {
            PL.ink.ignoresSafeArea()
            VStack(spacing: 14) {
                HStack {
                    Button("Cancel") { onCancel() }
                        .buttonStyle(PLSecondaryButtonStyle())
                    Spacer()
                    Text("Draw on this frame")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(PL.textBody)
                    Spacer()
                    Button(saving ? "Saving…" : "Save") {
                        Task { await save() }
                    }
                    .buttonStyle(PLPrimaryButtonStyle())
                    .disabled(saving)
                }
                .padding(.horizontal, 16)

                GeometryReader { geo in
                    let fit = fittedRect(in: geo.size)
                    ZStack {
                        Image(uiImage: frame)
                            .resizable()
                            .scaledToFit()
                        Canvas { context, size in
                            let rect = fittedRect(in: size)
                            for stroke in strokes + (current.map { [$0] } ?? []) {
                                var path = Path()
                                let pts = stroke.points.map { p in
                                    CGPoint(
                                        x: rect.minX + p.x * rect.width,
                                        y: rect.minY + p.y * rect.height
                                    )
                                }
                                guard let first = pts.first else { continue }
                                path.move(to: first)
                                for p in pts.dropFirst() { path.addLine(to: p) }
                                context.stroke(
                                    path, with: .color(stroke.color),
                                    style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round)
                                )
                            }
                        }
                    }
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { value in
                                let p = CGPoint(
                                    x: (value.location.x - fit.minX) / max(1, fit.width),
                                    y: (value.location.y - fit.minY) / max(1, fit.height)
                                )
                                guard (0...1).contains(p.x), (0...1).contains(p.y) else { return }
                                if current == nil {
                                    current = Stroke(points: [p], color: color)
                                } else {
                                    current?.points.append(p)
                                }
                            }
                            .onEnded { _ in
                                if let current, current.points.count > 1 {
                                    strokes.append(current)
                                }
                                current = nil
                            }
                    )
                }
                .padding(.horizontal, 4)

                HStack(spacing: 14) {
                    ForEach(Array(palette.enumerated()), id: \.offset) { _, c in
                        Button {
                            color = c
                        } label: {
                            Circle()
                                .fill(c)
                                .frame(width: 26, height: 26)
                                .overlay(
                                    Circle().strokeBorder(
                                        color == c ? Color.white : PL.edge,
                                        lineWidth: color == c ? 2 : 1
                                    )
                                )
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer()
                    Button {
                        _ = strokes.popLast()
                    } label: {
                        Image(systemName: "arrow.uturn.backward")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(strokes.isEmpty ? PL.text600 : PL.text300)
                            .frame(width: 40, height: 40)
                            .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(strokes.isEmpty)
                }
                .padding(.horizontal, 20)

                if failed {
                    Text("Couldn't save the drawing. Try again.")
                        .font(.plCaption)
                        .foregroundStyle(PL.dangerText)
                }
            }
            .padding(.vertical, 16)
        }
    }

    /// Where the scaledToFit image actually sits inside the container.
    private func fittedRect(in size: CGSize) -> CGRect {
        let imageAspect = frame.size.width / max(1, frame.size.height)
        let boxAspect = size.width / max(1, size.height)
        if imageAspect > boxAspect {
            let h = size.width / imageAspect
            return CGRect(x: 0, y: (size.height - h) / 2, width: size.width, height: h)
        }
        let w = size.height * imageAspect
        return CGRect(x: (size.width - w) / 2, y: 0, width: w, height: size.height)
    }

    private func save() async {
        saving = true
        failed = false
        // Composite at the frame's own scale, capped like the web (1280).
        let scale = min(1, 1280 / max(1, frame.size.width))
        let size = CGSize(width: frame.size.width * scale, height: frame.size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { ctx in
            frame.draw(in: CGRect(origin: .zero, size: size))
            ctx.cgContext.setLineCap(.round)
            ctx.cgContext.setLineJoin(.round)
            ctx.cgContext.setLineWidth(4 * size.width / 700)
            for stroke in strokes {
                guard let first = stroke.points.first else { continue }
                ctx.cgContext.setStrokeColor(UIColor(stroke.color).cgColor)
                ctx.cgContext.beginPath()
                ctx.cgContext.move(to: CGPoint(x: first.x * size.width, y: first.y * size.height))
                for p in stroke.points.dropFirst() {
                    ctx.cgContext.addLine(to: CGPoint(x: p.x * size.width, y: p.y * size.height))
                }
                ctx.cgContext.strokePath()
            }
        }
        guard let jpeg = image.jpegData(compressionQuality: 0.85) else {
            saving = false
            failed = true
            return
        }
        let ok = await onSave(jpeg)
        saving = false
        failed = !ok
    }
}
