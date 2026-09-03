import AVFoundation
import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit
import Vision

// Photographing pages of a paper notebook.
//
// This replaced VisionKit's VNDocumentCameraViewController, which looks
// wonderful and cannot be told anything. Its entire public surface is a
// delegate and an `isSupported` flag — there is no setting for the
// auto-shutter, none for the filter it applies, and no way into its review
// screen, which offers Retake and a back chevron and hides the commit
// action one level up. In use it fired before people had steadied the
// phone, and its filter pipeline returned pages that were entirely black
// often enough to lose real notes.
//
// So the capture is ours. What is kept from the good version:
//
//   Straightening   The page is found and squared up after the shot, never
//                   to decide when to take one.
//   Many pages      One session, a strip of what you have, one Done.
//
// What is deliberately gone: the automatic shutter, and the contrast
// filter that produced the black frames. A plain, correctly exposed photo
// of a page is something the model reads perfectly well.
//
// NOTHING IS WRITTEN TO DISK. A shot is downscaled to a JPEG in memory the
// moment it arrives and lives in this view's state until it is either read
// into text or dropped. Cancel, swipe away, or kill the app and it is gone
// with the process — there is no folder to sweep, no half-finished draft to
// find later. The lesson recorder needs the opposite (two hours of audio
// has to survive a crash); six photographs do not.

/// One page, already downscaled and ready to post.
struct PageShot: Identifiable {
    let id = UUID()
    let jpeg: Data
    let thumbnail: UIImage
}

struct PageCameraView: View {

    let limit: Int
    /// The pages, in the order they were taken. Empty means cancelled, and
    /// the caller does nothing.
    let onFinish: ([Data]) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var model = PageCameraModel()
    @State private var pages: [PageShot] = []
    @State private var discardAsk = false

    private var full: Bool { pages.count >= limit }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch model.access {
            case .granted:
                PagePreview(session: model.session, ready: model.ready)
                    .ignoresSafeArea()
                chrome
            case .denied:
                deniedState
            case .unknown:
                ProgressView().tint(.white)
            }

            // The shot waits here for a yes or a no. Nothing joins the
            // strip until it gets one, which is the confirmation the system
            // scanner never offered.
            if let pending = model.pending {
                review(pending)
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden()
        .task { await model.start() }
        .onDisappear { model.stop() }
        .alert("Discard these pages?", isPresented: $discardAsk) {
            Button("Discard", role: .destructive) { leave(with: []) }
            Button("Keep scanning", role: .cancel) {}
        } message: {
            Text(pages.count == 1
                 ? "The page you took is not kept."
                 : "The \(pages.count) pages you took are not kept.")
        }
    }

    // MARK: - Camera

    private var chrome: some View {
        VStack(spacing: 0) {
            HStack {
                Button("Cancel") {
                    if pages.isEmpty { leave(with: []) } else { discardAsk = true }
                }
                .font(.plBody)
                .foregroundStyle(.white)
                Spacer()
                Text(full ? "\(limit) pages, the most" : "\(pages.count) of \(limit)")
                    .font(.plCaption)
                    .foregroundStyle(.white.opacity(0.75))
                    .monospacedDigit()
            }
            .padding(.horizontal, 20)
            .padding(.top, 14)

            Spacer()

            if let message = model.errorMessage {
                Text(message)
                    .font(.plCaption)
                    .foregroundStyle(PL.dangerText)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .padding(.bottom, 12)
            }

            if !pages.isEmpty { strip }

            HStack {
                // Balances Done so the shutter sits in the middle of the
                // screen rather than the middle of what is left over.
                Color.clear.frame(width: 78, height: 1)
                Spacer()
                shutter
                Spacer()
                Button("Done") { leave(with: pages.map(\.jpeg)) }
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(pages.isEmpty ? .white.opacity(0.35) : PL.cyan)
                    .frame(width: 78, alignment: .trailing)
                    .disabled(pages.isEmpty)
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 22)
        }
        .background(
            LinearGradient(
                colors: [.clear, .black.opacity(0.55)],
                startPoint: .center, endPoint: .bottom
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)
        )
    }

    private var shutter: some View {
        Button { model.capture() } label: {
            ZStack {
                Circle().strokeBorder(.white.opacity(full ? 0.3 : 1), lineWidth: 3)
                    .frame(width: 74, height: 74)
                Circle().fill(.white.opacity(full ? 0.3 : 1))
                    .frame(width: 60, height: 60)
                    .scaleEffect(model.capturing ? 0.86 : 1)
                    .animation(.easeOut(duration: 0.12), value: model.capturing)
            }
        }
        .buttonStyle(.plain)
        .disabled(full || model.capturing)
        .accessibilityLabel("Take a photo of this page")
    }

    /// What you have so far, and a way to drop one you no longer want.
    private var strip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(pages) { page in
                    ZStack(alignment: .topTrailing) {
                        Image(uiImage: page.thumbnail)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 54, height: 72)
                            .clipped()
                            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .strokeBorder(.white.opacity(0.35), lineWidth: 1)
                            )
                        Button {
                            pages.removeAll { $0.id == page.id }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 17))
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, .black.opacity(0.65))
                        }
                        .buttonStyle(.plain)
                        .offset(x: 7, y: -7)
                        .accessibilityLabel("Remove this page")
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 8)
        }
    }

    // MARK: - Review

    private func review(_ image: UIImage) -> some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 0) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(.horizontal, 12)
                    .padding(.top, 12)

                HStack(spacing: 12) {
                    Button { model.discardPending() } label: {
                        Text("Retake").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                    Button { keepPending(image) } label: {
                        Text("Use page").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PLPrimaryButtonStyle())
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 22)
            }
        }
        .transition(.opacity)
    }

    private func keepPending(_ image: UIImage) {
        // Straighten and compress off the main actor: it is a Vision pass
        // and a redraw, and doing it here would stutter the shutter.
        Task {
            let shot = await Task.detached(priority: .userInitiated) {
                let squared = PageScan.straightened(PageScan.downscaled(image))
                guard let jpeg = squared.jpegData(compressionQuality: 0.85) else { return nil as PageShot? }
                return PageShot(jpeg: jpeg, thumbnail: squared.preparingThumbnail(of: CGSize(width: 108, height: 144)) ?? squared)
            }.value
            if let shot { pages.append(shot) }
            model.discardPending()
        }
    }

    // MARK: - Leaving

    private func leave(with jpegs: [Data]) {
        model.stop()
        pages = []
        onFinish(jpegs)
        dismiss()
    }

    private var deniedState: some View {
        VStack(spacing: 18) {
            Image(systemName: "camera.fill")
                .font(.system(size: 38, weight: .light))
                .foregroundStyle(PL.text400)
            Text("PongLens can't use the camera.")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
            Text("Turn it on in Settings, or choose photos you have already taken.")
                .font(.plBody)
                .foregroundStyle(PL.text400)
                .multilineTextAlignment(.center)
            VStack(spacing: 12) {
                Button {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                } label: {
                    Text("Open Settings").frame(maxWidth: .infinity)
                }
                .buttonStyle(PLPrimaryButtonStyle())
                Button { leave(with: []) } label: {
                    Text("Close").frame(maxWidth: .infinity)
                }
                .buttonStyle(PLSecondaryButtonStyle())
            }
            .padding(.top, 6)
        }
        .padding(.horizontal, 32)
    }
}

// MARK: - Preview layer

private struct PagePreview: UIViewRepresentable {
    let session: AVCaptureSession
    /// Only here to make SwiftUI run `updateUIView` once the session has an
    /// input. The layer has no connection to rotate before that, so setting
    /// the angle at build time would be setting it on nothing.
    let ready: Bool

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.layer.session = session
        view.layer.videoGravity = .resizeAspectFill
        orient(view)
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {
        orient(view)
    }

    /// The same 90 degrees the photo connection takes, or the preview shows
    /// the sensor's own landscape while the phone is upright.
    private func orient(_ view: PreviewView) {
        guard let connection = view.layer.connection,
              connection.isVideoRotationAngleSupported(90),
              connection.videoRotationAngle != 90 else { return }
        connection.videoRotationAngle = 90
    }

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        override var layer: AVCaptureVideoPreviewLayer {
            super.layer as! AVCaptureVideoPreviewLayer
        }
    }
}

// MARK: - Model

@Observable
final class PageCameraModel {

    enum Access { case unknown, granted, denied }

    private(set) var access: Access = .unknown
    /// The session is configured and running.
    private(set) var ready = false
    private(set) var capturing = false
    private(set) var errorMessage: String?
    /// The shot on screen waiting to be kept or retaken.
    private(set) var pending: UIImage?

    private let rig = PageCameraRig()

    var session: AVCaptureSession { rig.session }

    func start() async {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            access = .granted
        case .notDetermined:
            access = await AVCaptureDevice.requestAccess(for: .video) ? .granted : .denied
        default:
            access = .denied
        }
        guard access == .granted else { return }
        errorMessage = await rig.start()
        ready = errorMessage == nil
    }

    func stop() {
        pending = nil
        ready = false
        rig.stop()
    }

    func capture() {
        guard !capturing, pending == nil else { return }
        capturing = true
        errorMessage = nil
        rig.capture { [weak self] image in
            Task { @MainActor in
                guard let self else { return }
                self.capturing = false
                if let image {
                    self.pending = image
                } else {
                    self.errorMessage = "That photo didn't come through. Try again."
                }
            }
        }
    }

    func discardPending() {
        pending = nil
    }
}

// MARK: - The session itself

/// AVFoundation off the main actor. Configuring a session and starting it
/// both block, and doing either on the main thread stalls the presentation
/// animation the camera is appearing through.
private nonisolated final class PageCameraRig: NSObject, AVCapturePhotoCaptureDelegate, @unchecked Sendable {

    let session = AVCaptureSession()
    private let output = AVCapturePhotoOutput()
    private let queue = DispatchQueue(label: "com.ponglens.pagecamera")
    private var configured = false
    private var pending: ((UIImage?) -> Void)?

    /// Returns a message when the camera could not be opened at all.
    func start() async -> String? {
        await withCheckedContinuation { continuation in
            queue.async {
                if !self.configured {
                    guard self.configure() else {
                        continuation.resume(returning: "Couldn't open the camera.")
                        return
                    }
                    self.configured = true
                }
                if !self.session.isRunning { self.session.startRunning() }
                continuation.resume(returning: nil)
            }
        }
    }

    private func configure() -> Bool {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .photo
        guard let device = AVCaptureDevice.default(
                  .builtInWideAngleCamera, for: .video, position: .back
              ),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input),
              session.canAddOutput(output) else { return false }
        session.addInput(input)
        session.addOutput(output)

        // The back camera's sensor is landscape, and a connection left at
        // its natural angle writes that orientation into the photo. The
        // page would arrive on its side — legible to a person turning their
        // head, considerably less so to a model reading lines of
        // handwriting. A page scanner is portrait, so say so.
        if let connection = output.connection(with: .video),
           connection.isVideoRotationAngleSupported(90) {
            connection.videoRotationAngle = 90
        }

        // A page is a still object at arm's length, so the camera is told
        // to keep hunting for focus rather than lock on the first thing it
        // finds and stay there while the phone moves closer.
        if (try? device.lockForConfiguration()) != nil {
            if device.isFocusModeSupported(.continuousAutoFocus) {
                device.focusMode = .continuousAutoFocus
            }
            if device.isExposureModeSupported(.continuousAutoExposure) {
                device.exposureMode = .continuousAutoExposure
            }
            device.unlockForConfiguration()
        }
        return true
    }

    func stop() {
        queue.async {
            if self.session.isRunning { self.session.stopRunning() }
        }
    }

    func capture(_ done: @escaping (UIImage?) -> Void) {
        queue.async {
            guard self.session.isRunning else {
                done(nil)
                return
            }
            self.pending = done
            let settings = AVCapturePhotoSettings()
            settings.flashMode = .off
            self.output.capturePhoto(with: settings, delegate: self)
        }
    }

    func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?
    ) {
        let done = pending
        pending = nil
        guard error == nil,
              let data = photo.fileDataRepresentation(),
              let image = UIImage(data: data) else {
            done?(nil)
            return
        }
        done?(image)
    }
}
