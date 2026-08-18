import SwiftUI

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

/// Design tokens mirrored from the web app's Tailwind theme.
/// Reference: ios/docs/design-system.md. The product is dark-only.
enum PL {
    // MARK: Surfaces
    static let ink = Color(hex: 0x0A0A0F)
    static let surface = Color(hex: 0x14141C)
    static let surface2 = Color(hex: 0x1B1B26)
    static let edge = Color(hex: 0x262633)

    // MARK: Accent
    static let cyan = Color(hex: 0x22D3EE)
    static let magenta = Color(hex: 0xE879F9)
    static let magentaSoft = Color(hex: 0xF0ABFC)

    // MARK: Text ramp (body default is FAFAFA, not pure white)
    static let textBody = Color(hex: 0xFAFAFA)
    static let text100 = Color(hex: 0xF4F4F5)
    static let text200 = Color(hex: 0xE4E4E7)
    static let text300 = Color(hex: 0xD4D4D8)
    static let text400 = Color(hex: 0x9F9FA9)
    static let text500 = Color(hex: 0x71717B)
    static let text600 = Color(hex: 0x52525C)

    // MARK: Semantic
    static let warning = Color(hex: 0xFFB900)
    static let warningText = Color(hex: 0xFFD230)
    static let danger = Color(hex: 0xFF6467)
    static let dangerFill = Color(hex: 0xFB2C36)
    static let dangerText = Color(hex: 0xFFA2A2)
    static let success = Color(hex: 0x00D492)
    static let successText = Color(hex: 0x5EE9B5)

    // MARK: Shape
    static let rCard: CGFloat = 16
    static let rField: CGFloat = 12
    static let rSmall: CGFloat = 8
}

extension Font {
    static let plPageTitle = Font.system(size: 24, weight: .bold)
    static let plSection = Font.system(size: 12, weight: .semibold)
    static let plCardTitle = Font.system(size: 16, weight: .semibold)
    static let plRowTitle = Font.system(size: 14, weight: .semibold)
    static let plBody = Font.system(size: 14)
    static let plButton = Font.system(size: 14, weight: .semibold)
    static let plButtonSecondary = Font.system(size: 14, weight: .medium)
    static let plCaption = Font.system(size: 12)
    static let plMicro = Font.system(size: 11, weight: .medium)
    static let plTabLabel = Font.system(size: 10, weight: .medium)
}
