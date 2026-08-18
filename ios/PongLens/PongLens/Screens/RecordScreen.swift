import AVFoundation
import SwiftUI

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    final class PreviewView: UIView {
        override static var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        view.backgroundColor = .black
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}
}

/// Record mode — film a match right in the app, then feed the same upload
/// pipeline. The camera-guide tips lead, since placement decides whether
/// processing can find the table.
struct RecordScreen: View {
    let onFinished: (URL) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var recorder = Recorder()
    @State private var guideOpen = true

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch recorder.state {
            case .ready, .recording, .finished:
                CameraPreview(session: recorder.session)
                    .ignoresSafeArea()
            case .denied:
                permissionCard
            case .failed(let message):
                Text(message)
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                    .padding(24)
            case .idle:
                ProgressView().tint(PL.cyan)
            }

            VStack {
                HStack {
                    if case .recording = recorder.state {
                        HStack(spacing: 8) {
                            Circle().fill(PL.dangerFill).frame(width: 8, height: 8)
                            Text(elapsedString)
                                .font(.system(size: 14, weight: .semibold))
                                .monospacedDigit()
                                .foregroundStyle(.white)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(PL.ink.opacity(0.7), in: Capsule())
                    }
                    Spacer()
                    Button {
                        recorder.teardown()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(PL.text300)
                            .padding(10)
                            .background(PL.ink.opacity(0.7), in: Circle())
                    }
                    .buttonStyle(.plain)
                }
                .padding(16)

                Spacer()

                if guideOpen, recorder.state == .ready {
                    guideCard
                        .padding(.horizontal, 20)
                        .padding(.bottom, 12)
                }

                recordButton
                    .padding(.bottom, 30)
            }
        }
        .statusBarHidden()
        .task { await recorder.configure() }
        .onChange(of: recorder.state) { _, state in
            if case .finished(let url) = state {
                recorder.teardown()
                dismiss()
                onFinished(url)
            }
        }
    }

    private var elapsedString: String {
        let s = Int(recorder.elapsed)
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    private var guideCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Where to place the camera")
                .font(.plRowTitle)
                .foregroundStyle(PL.text100)
            ForEach([
                "Diagonally behind you, raised a little",
                "The whole table in frame, so the ball lands clearly on both sides",
                "Neither player blocking the table",
            ], id: \.self) { line in
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(PL.success)
                        .padding(.top, 3)
                    Text(line)
                        .font(.plCaption)
                        .foregroundStyle(PL.text300)
                }
            }
            Text("Hold your phone landscape (sideways). Vertical video still works, but accuracy drops.")
                .font(.plCaption)
                .foregroundStyle(PL.warningText)
                .padding(.top, 2)
            Button("Got it") { withAnimation { guideOpen = false } }
                .buttonStyle(PLCyanGhostButtonStyle())
        }
        .padding(16)
        .background(PL.ink.opacity(0.85), in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
    }

    private var recordButton: some View {
        Button {
            if recorder.state == .recording {
                recorder.stop()
            } else {
                withAnimation { guideOpen = false }
                recorder.start()
            }
        } label: {
            ZStack {
                Circle()
                    .strokeBorder(.white.opacity(0.9), lineWidth: 4)
                    .frame(width: 74, height: 74)
                if recorder.state == .recording {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(PL.dangerFill)
                        .frame(width: 30, height: 30)
                } else {
                    Circle()
                        .fill(PL.dangerFill)
                        .frame(width: 60, height: 60)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(recorder.state != .ready && recorder.state != .recording)
    }

    private var permissionCard: some View {
        VStack(spacing: 12) {
            Text("PongLens needs the camera to film your match.")
                .font(.plBody)
                .foregroundStyle(PL.text300)
                .multilineTextAlignment(.center)
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .buttonStyle(PLPrimaryButtonStyle())
        }
        .padding(24)
    }
}
