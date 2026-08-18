import SwiftUI
import CoreImage.CIFilterBuiltins

/// The QR block shown under a share or invite link, mirroring the web's
/// ShareQR: the code sits on a white card because a scanner needs the
/// contrast — the app is dark everywhere else. Rendered once per URL;
/// nearest-neighbour scaling keeps the modules square.
struct QRCodeView: View {
    let url: URL
    var side: CGFloat = 168

    var body: some View {
        Group {
            if let image = Self.render(url.absoluteString) {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(width: side, height: side)
                    .padding(14)
                    .background(.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityLabel("QR code for the link")
    }

    private static func render(_ string: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
        guard let cg = CIContext().createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
