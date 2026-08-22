import AVFoundation
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import UIKit
import Vision

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

    /// Whether there is a camera to offer. False on a simulator, which is
    /// why that path drops straight to the photo library.
    static var cameraAvailable: Bool {
        AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) != nil
    }

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
    static func read(_ jpeg: Data) async throws -> Page {
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
    static func downscaled(_ image: UIImage) -> UIImage {
        let longest = max(image.size.width, image.size.height)
        guard longest > 1600 else { return image }
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
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    static func jpeg(_ image: UIImage) -> Data? {
        downscaled(image).jpegData(compressionQuality: 0.85)
    }

    private static let ciContext = CIContext()

    /// Square the page up, when the page is clearly there.
    ///
    /// This is the one thing worth keeping from VisionKit's scanner: a page
    /// shot at an angle comes back rectangular, which reads better and
    /// throws away the table around it. The difference is that it runs
    /// AFTER the shutter, on a photo somebody chose to take, rather than
    /// deciding when to fire.
    ///
    /// The crop is a bonus and never a risk. An unsure detector, or a quad
    /// covering a sliver of the frame, means the whole frame goes through
    /// untouched — a slightly wonky page reads fine, a page with half of it
    /// cropped away does not.
    static func straightened(_ image: UIImage) -> UIImage {
        guard let cgImage = image.cgImage else { return image }
        let request = VNDetectDocumentSegmentationRequest()
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        guard (try? handler.perform([request])) != nil,
              let quad = request.results?.first,
              quad.confidence >= 0.5 else { return image }

        let source = CIImage(cgImage: cgImage)
        let size = source.extent.size
        // Vision normalises to the unit square with the origin bottom left,
        // which is where Core Image puts it too, so this is a scale and no
        // flip.
        func point(_ p: CGPoint) -> CGPoint {
            CGPoint(x: p.x * size.width, y: p.y * size.height)
        }
        let topLeft = point(quad.topLeft)
        let topRight = point(quad.topRight)
        let bottomLeft = point(quad.bottomLeft)
        let bottomRight = point(quad.bottomRight)

        // A quad smaller than a quarter of the frame is a detection that
        // found something on the page rather than the page.
        let corners = [topLeft, topRight, bottomRight, bottomLeft]
        var area = 0.0
        for i in corners.indices {
            let a = corners[i], b = corners[(i + 1) % corners.count]
            area += a.x * b.y - b.x * a.y
        }
        guard abs(area) / 2 >= 0.25 * size.width * size.height else { return image }

        let filter = CIFilter.perspectiveCorrection()
        filter.inputImage = source
        filter.topLeft = topLeft
        filter.topRight = topRight
        filter.bottomLeft = bottomLeft
        filter.bottomRight = bottomRight
        guard let output = filter.outputImage,
              let corrected = ciContext.createCGImage(output, from: output.extent) else {
            return image
        }
        return UIImage(cgImage: corrected)
    }
}
