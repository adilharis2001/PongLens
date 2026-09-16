import Foundation

/// The age rule, mirrored from src/lib/consent.ts so both platforms answer
/// the same question the same way. Spec:
/// docs/superpowers/specs/2026-09-14-minors-consent-and-flags-design.md
enum AgeGate {
    static let minimumAge = 13
    static let minimumAgeEEA = 16

    /// EEA member states (EU 27 plus Iceland, Liechtenstein, Norway). The
    /// UK is 13, so it is deliberately not here.
    static let eeaCountries: Set<String> = [
        "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
        "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
        "SI", "ES", "SE", "IS", "LI", "NO",
    ]

    static func minimumAge(region: String?) -> Int {
        let code = (region ?? "").trimmingCharacters(in: .whitespaces).uppercased()
        return eeaCountries.contains(code) ? minimumAgeEEA : minimumAge
    }

    /// Whole years lived, counting a birthday as the first of its month. A
    /// player born in September 2013 is 13 from 1 September 2026.
    static func ageInYears(birthYear: Int, birthMonth: Int, now: Date = Date()) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let year = calendar.component(.year, from: now)
        let month = calendar.component(.month, from: now)
        var years = year - birthYear
        if month < birthMonth { years -= 1 }
        return years
    }

    static func isUnderAge(birthYear: Int, birthMonth: Int, region: String?, now: Date = Date()) -> Bool {
        ageInYears(birthYear: birthYear, birthMonth: birthMonth, now: now) < minimumAge(region: region)
    }
}
