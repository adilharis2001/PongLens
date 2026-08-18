import AVFoundation
import SwiftUI
import UIKit

/// Bare AVPlayerLayer host — the app draws all its own chrome, mirroring
/// the web player's custom controls.
struct PlayerLayerView: UIViewRepresentable {
    let player: AVPlayer

    final class LayerHostView: UIView {
        override static var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }

    func makeUIView(context: Context) -> LayerHostView {
        let view = LayerHostView()
        view.playerLayer.player = player
        view.playerLayer.videoGravity = .resizeAspect
        view.backgroundColor = .black
        return view
    }

    func updateUIView(_ uiView: LayerHostView, context: Context) {
        if uiView.playerLayer.player !== player {
            uiView.playerLayer.player = player
        }
    }
}
