import Foundation
import SwiftUI
import UIKit
import VisionKit

// Photographed journal pages, read into text.
//
// The route is the web's `/api/journal-ocr`, unchanged: one vision call
// per page that transcribes and guards in the same pass, so a photo that
// is not a notes page comes back rejected rather than turned into
// invented notes. The photos are never stored anywhere; only the words
// come back, and they land in the composer's field where they can be
// corrected before anything is saved.
//
// Pages go up ONE AT A TIME rather than in a single multipart post. The
// route reads them sequentially under a 60 second function limit, and six
// pages is close enough to that limit to be a real risk on a slow
// connection. One page per request also means the row can count real
// progress, a page that fails costs one page, and the daily allowance is
// spent a page at a time instead of all or nothing.

enum PageScan {

    /// What the route accepts in one go. Sending more than this is not an
    /// error worth surfacing — the extras are simply dropped.
    static let maxPages = 6

    enum Page {
        case text(String)
        /// Not a notes page: scenery, a receipt, a blank frame.
        case rejected
        /// The model or the parse gave up on it.
        case failed
    }

    private struct Response: Decodable {
        struct Body: Decodable {
            let text: String?
            let rejected: Bool?
            let failed: Bool?
        }
        let pages: [Body]
    }

    /// Read one page. Throws only for the things worth telling someone
    /// about — no signal, or the daily allowance spent — so a single
    /// unreadable page never sinks the rest of the batch.
    static func read(_ image: UIImage) async throws -> Page {
        guard let jpeg = jpeg(image) else { return .failed }
        let response: Response = try await API.postMultipart(
            "api/journal-ocr", field: "pages", filename: "page.jpg",
            mime: "image/jpeg", data: jpeg
        )
        guard let page = response.pages.first else { return .failed }
        if let text = page.text?.trimmingCharacters(in: .whitespacesAndNewlines),
           !text.isEmpty {
            return .text(text)
        }
        return page.rejected == true ? .rejected : .failed
    }

    /// Down to 1600px on the long side, the same as the web does before
    /// posting. A 12 megapixel photo is around 4 MB and buys the model
    /// nothing over a legible page, and the function's request body caps
    /// at 4.5 MB anyway.
    static func jpeg(_ image: UIImage) -> Data? {
        let longest = max(image.size.width, image.size.height)
        guard longest > 1600 else {
            return image.jpegData(compressionQuality: 0.85)
        }
        let scale = 1600 / longest
        let size = CGSize(
            width: (image.size.width * scale).rounded(),
            height: (image.size.height * scale).rounded()
        )
        let format = UIGraphicsImageRendererFormat()
        // Without this the renderer works at the screen's scale and a
        // "1600 wide" image comes out 4800 wide, which is the whole saving
        // handed straight back.
        format.scale = 1
        let shrunk = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return shrunk.jpegData(compressionQuality: 0.85)
    }
}

/// Apple's page scanner, the one Notes uses.
///
/// It finds the edges of the page, straightens it and drops the shadow of
/// the hand holding the phone, which is better input for the model than a
/// hand-held snapshot of the same page. A camera is the natural way to do
/// this — the notebook is open on the table — so it is the first option,
/// with the photo library for pages already taken.
struct DocumentScannerView: UIViewControllerRepresentable {
    /// Anything past this is dropped rather than refused: the route takes
    /// a fixed number of pages and stopping someone mid-scan to say so
    /// would be worse than quietly keeping the first few.
    let limit: Int
    let onFinish: ([UIImage]) -> Void

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let controller = VNDocumentCameraViewController()
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_: VNDocumentCameraViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(limit: limit, onFinish: onFinish)
    }

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        private let limit: Int
        private let onFinish: ([UIImage]) -> Void

        init(limit: Int, onFinish: @escaping ([UIImage]) -> Void) {
            self.limit = limit
            self.onFinish = onFinish
        }

        func documentCameraViewController(
            _ controller: VNDocumentCameraViewController,
            didFinishWith scan: VNDocumentCameraScan
        ) {
            let pages = (0..<min(scan.pageCount, limit)).map { scan.imageOfPage(at: $0) }
            onFinish(pages)
        }

        func documentCameraViewControllerDidCancel(
            _ controller: VNDocumentCameraViewController
        ) {
            onFinish([])
        }

        func documentCameraViewController(
            _ controller: VNDocumentCameraViewController,
            didFailWithError error: Error
        ) {
            onFinish([])
        }
    }
}
