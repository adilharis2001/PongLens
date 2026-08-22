import SwiftUI

/// Development-only visual QA screen: every token and component in one scroll,
/// compared side by side against the web app during the port.
struct ThemeGallery: View {

    /// The verified reference quad, walked left until corner A sits on
    /// the border: a table that carries on past the edge of the frame.
    static let clippedQuad: [SIMD2<Double>] = [
        SIMD2(1.9, 90.6), SIMD2(46.7, 114.0),
        SIMD2(118.2, 95.1), SIMD2(73.1, 83.2),
    ]
    @State private var fieldText = ""
    @State private var toggleOn = true

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 32) {
                    LogoWordmark()

                    Text("Theme gallery")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeading("Typography")
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Page title").font(.plPageTitle).tracking(-0.6).foregroundStyle(PL.textBody)
                            Text("Card title").font(.plCardTitle).foregroundStyle(PL.text100)
                            Text("Body text runs at fourteen points.").font(.plBody).foregroundStyle(PL.text300)
                            Text("Muted body for supporting lines.").font(.plBody).foregroundStyle(PL.text400)
                            Text("Caption metadata").font(.plCaption).foregroundStyle(PL.text500)
                            Text("0:54 · 11 – 8 · 2.4s").font(.plMicro).monospacedDigit().foregroundStyle(PL.text300)
                        }
                        .plCard()
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeading("Record placement ghost")
                        TableGhost(level: 0)
                            .frame(height: 200)
                            .frame(maxWidth: .infinity)
                            .background(Color.black)
                            .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeading("Live check, detected state")
                        // The verified reference detection from the macOS
                        // harness (match 22859ef1), rendered exactly as a
                        // live find at a table would be.
                        TableGhost(level: 0, previewDetection: [
                            SIMD2(127.9, 90.6), SIMD2(172.7, 114.0),
                            SIMD2(244.2, 95.1), SIMD2(199.1, 83.2),
                        ])
                        .frame(height: 200)
                        .frame(maxWidth: .infinity)
                        .background(Color.black)
                        .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
                        Text(TableFinderEngine.selfTest())
                            .font(.plCaption)
                            .foregroundStyle(PL.text400)

                        SectionHeading("Live check, table in view")
                        // The model's corners in amber, over the teal
                        // target. Both quads on screen at once is the
                        // instruction: walk until they sit on top of
                        // each other. Previously this state drew nothing
                        // at all and read as a dead feature.
                        TableGhost(level: 0, previewDebug: [
                            SIMD2(127.9, 90.6), SIMD2(172.7, 114.0),
                            SIMD2(244.2, 95.1), SIMD2(199.1, 83.2),
                        ])
                        .frame(height: 200)
                        .frame(maxWidth: .infinity)
                        .background(Color.black)
                        .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
                        SectionHeading("Live check, table off the frame")
                        // The same quad walked left until it touches the
                        // border. Corners pinned to an edge are how a
                        // table that continues past the frame comes back,
                        // and the caption is the real framingCue answer
                        // rather than a written-in string — so this row
                        // fails if that function ever stops working.
                        TableGhost(
                            level: 0,
                            previewDebug: Self.clippedQuad,
                            previewNote: TableFinderEngine
                                .framingCue(Self.clippedQuad))
                        .frame(height: 200)
                        .frame(maxWidth: .infinity)
                        .background(Color.black)
                        .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))

                        SectionHeading("Live check, nothing found")
                        // Ten quiet seconds. The placement line stays the
                        // caption until then; this is what replaces it,
                        // and the dark-room line renders the same way.
                        TableGhost(level: 0,
                                   previewNote: TableFinderEngine.stalledNote)
                        .frame(height: 200)
                        .frame(maxWidth: .infinity)
                        .background(Color.black)
                        .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))

                        // The whole engine — preprocess, model, gate,
                        // vote — on a bundled PingPod frame. That frame's
                        // camera stood 1.1 m behind the end line, so the
                        // expected outcome is "Step back a little".
                        GhostPipelineBench()
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeading("Buttons")
                        VStack(alignment: .leading, spacing: 14) {
                            HStack(spacing: 12) {
                                Button("Upload a match") {}.buttonStyle(PLPrimaryButtonStyle())
                                Button("Cancel") {}.buttonStyle(PLSecondaryButtonStyle())
                            }
                            HStack(spacing: 12) {
                                Button("Get more minutes") {}.buttonStyle(PLCyanGhostButtonStyle())
                                Button("Discard") {}.buttonStyle(PLSoftDestructiveButtonStyle())
                                Button("Delete match") {}.buttonStyle(PLDestructiveButtonStyle())
                            }
                        }
                        .plCard()
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeading("Status")
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 8) {
                                StatusChip(status: .queued)
                                StatusChip(status: .processing)
                                StatusChip(status: .ready)
                            }
                            HStack(spacing: 8) {
                                StatusChip(status: .notProcessed)
                                StatusChip(status: .failed)
                                ScorePill(you: 3, them: 1)
                            }
                        }
                        .plCard()
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeading("Card")
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text("Marco · LYTTC").font(.plRowTitle).foregroundStyle(PL.text100)
                                Spacer()
                                ScorePill(you: 3, them: 2)
                            }
                            Text("Aug 14 · 62 points").font(.plCaption).foregroundStyle(PL.text500)
                            HStack(spacing: 10) {
                                Text("Point 12 · 4.2s").font(.plCaption).foregroundStyle(PL.text500)
                                Spacer()
                                Text("Updating clip").font(.plCaption).foregroundStyle(PL.text400)
                            }
                            .plInnerRow()
                            .padding(.top, 8)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .plCard()
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeading("Loading")
                        VStack(alignment: .leading, spacing: 14) {
                            HStack(spacing: 7) {
                                Image(systemName: "sparkles")
                                    .font(.system(size: 13))
                                    .foregroundStyle(PL.cyan)
                                Text("Reading your journal…")
                                    .font(.plCaption)
                                    .foregroundStyle(PL.text400)
                            }
                            VStack(alignment: .leading, spacing: 10) {
                                PLSkeletonBar()
                                PLSkeletonBar()
                                PLSkeletonBar(maxWidth: 300)
                                PLSkeletonBar(maxWidth: 190)
                            }
                            .plShimmer()
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .plCard(padding: 16)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeading("Input")
                        VStack(alignment: .leading, spacing: 12) {
                            TextField("Opponent name", text: $fieldText)
                                .plField()
                            Toggle("Placement maps", isOn: $toggleOn)
                                .font(.plBody)
                                .foregroundStyle(PL.text200)
                                .tint(PL.cyan.opacity(0.5))
                        }
                        .plCard()
                    }

                    PLToast(message: "Resuming from point 14")
                        .frame(maxWidth: .infinity)
                }
                .padding(20)
                .padding(.bottom, 60)
            }
        }
    }
}

#Preview {
    ThemeGallery()
        .preferredColorScheme(.dark)
}

/// Runs TableFinderEngine end to end on the bundled bench frame — the
/// same ingest path live camera frames take, minus only the capture tap.
/// The simulator has no camera; this is how the pipeline stays testable.
struct GhostPipelineBench: View {
    @State private var engine = TableFinderEngine()
    @State private var outcome = "not run"

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button("Run the live pipeline on the bench frame") { run() }
                .buttonStyle(PLCyanGhostButtonStyle())
            Text(outcome)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(PL.text300)
        }
    }

    private func run() {
        guard let engine else { outcome = "model missing"; return }
        guard let url = Bundle.main.url(forResource: "ghost-bench",
                                        withExtension: "jpg"),
              let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
              let buffer = Self.pixelBuffer(from: image) else {
            outcome = "bench frame missing"
            return
        }
        // The bench frame was filmed on someone else's camera, so the
        // live lens's field of view would be the wrong question to ask
        // of it. Its true focal (recovered from the hand-marked corners:
        // 148.8 px at this input width) is 94.2 degrees — with that, the
        // expected answer matches the macOS reference exactly.
        engine.fovDegrees = 94.16
        let dumped = engine.dumpInput(from: buffer)
        for _ in 0..<3 { engine.ingest(buffer, force: true) }
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 400_000_000)
            outcome = "\(String(describing: engine.state))\n\(engine.diag)\n\(dumped)"
        }
    }

    private static func pixelBuffer(from image: CGImage) -> CVPixelBuffer? {
        var buffer: CVPixelBuffer?
        // IOSurface-backed, like every buffer the capture session hands
        // out. CIImage(cvPixelBuffer:) renders empty on iOS without it,
        // which would make the bench fail for a reason the live path
        // never hits — the opposite of what a bench is for.
        CVPixelBufferCreate(
            nil, image.width, image.height,
            kCVPixelFormatType_32BGRA,
            [kCVPixelBufferCGImageCompatibilityKey: true,
             kCVPixelBufferCGBitmapContextCompatibilityKey: true,
             kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary]
                as CFDictionary,
            &buffer)
        guard let buffer else { return nil }
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let ctx = CGContext(
            data: CVPixelBufferGetBaseAddress(buffer),
            width: image.width, height: image.height,
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
                | CGBitmapInfo.byteOrder32Little.rawValue)
        else { return nil }
        ctx.draw(image, in: CGRect(x: 0, y: 0,
                                   width: image.width, height: image.height))
        return buffer
    }
}
