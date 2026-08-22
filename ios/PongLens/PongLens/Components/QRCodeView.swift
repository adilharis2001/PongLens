import SwiftUI
import CoreImage.CIFilterBuiltins

/// The QR block shown under a share or invite link, mirroring the web's
/// ShareQR: the code sits on a white card because a scanner needs the
/// contrast — the app is dark everywhere else. Rendered once per URL;
/// nearest-neighbour scaling keeps the modules square.
struct QRCodeView: View {
    let url: URL
    var side: CGFloat = 160
    var caption: String? = "Scan to open"

    var body: some View {
        VStack(spacing: 10) {
            if let image = Self.render(url.absoluteString) {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(width: side, height: side)
                    .accessibilityLabel("QR code for the link")
            }
            if let caption {
                Text(caption)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color(hex: 0x3F3F46))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
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
