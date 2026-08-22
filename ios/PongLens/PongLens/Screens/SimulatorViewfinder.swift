#if targetEnvironment(simulator)
import AVFoundation
import SwiftUI
import UIKit

/// A stand-in for the camera preview, on the simulator only.
///
/// THIS IS NOT PRODUCT CODE. The whole file is inside
/// `#if targetEnvironment(simulator)`, so it does not exist in a device
/// build and cannot ship. It exists for one reason: the landing video needs
/// a shot of the recorder, and the recorder cannot be filmed.
///
/// The simulator has no `AVCaptureDevice`. Recorder.swift's four fallbacks
/// all return nil, the session never starts, and the Record screen renders
/// "The camera isn't available on this device." over black — chrome intact,
/// picture dead. Since `CameraPreview` is just the bottom layer of a ZStack
/// with every control drawn above it, replacing that one layer with a
/// looping clip gives a viewfinder that behaves like a viewfinder: the
/// placement guide sits over real footage, the level line reads, and the
/// screen recording is of the actual app rather than of a mock-up.
///
/// The clip is deliberately NOT bundled. It is a real match, it belongs to
/// a real account, and it has no business in the repository or in an
/// archive. The capture script drops it into the app container as
/// `demo-preview.mp4` and deletes it afterwards; with no file present this
/// falls back to black and the recorder looks exactly as it did before.
struct SimulatorViewfinder: UIViewRepresentable {
    var onAngle: ((CGFloat) -> Void)? = nil

    static var clipURL: URL? {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        guard let url = docs?.appendingPathComponent("demo-preview.mp4"),
              FileManager.default.fileExists(atPath: url.path) else { return nil }
        return url
    }

    final class PlayerView: UIView {
        override static var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
        var looper: Any?
        var onAngle: ((CGFloat) -> Void)?

        override func layoutSubviews() {
            super.layoutSubviews()
            // The real preview reports the rotation it settled on so the
            // table check shares one upright world. Report the same thing,
            // or the overlays sit at the wrong angle.
            guard let orientation = window?.windowScene?.interfaceOrientation else { return }
            let angle: CGFloat = switch orientation {
            case .landscapeRight: 0
            case .landscapeLeft: 180
            case .portraitUpsideDown: 270
            default: 90
            }
            onAngle?(angle)
        }
    }

    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        view.backgroundColor = .black
        view.onAngle = onAngle
        view.playerLayer.videoGravity = .resizeAspectFill
        guard let url = Self.clipURL else { return view }
        let item = AVPlayerItem(url: url)
        let queue = AVQueuePlayer(playerItem: item)
        queue.isMuted = true
        view.looper = AVPlayerLooper(player: queue, templateItem: item)
        view.playerLayer.player = queue
        queue.play()
        return view
    }

    func updateUIView(_ uiView: PlayerView, context: Context) {}
}
#endif
