import Foundation

/// "How did you hear about us?" — the last question in onboarding.
///
/// The answers are a fixed list so they can be counted; the free-text half
/// exists because the answer that matters most is a person. A coach telling a
/// student is the channel this product actually runs on, so "A coach" and "A
/// friend or another player" both open a name field, and so does "My club".
///
/// The list is written down once, in `ios/Tests/fixtures/signup-sources.json`,
/// and this file and `src/lib/auth/signupSource.ts` are both tested against
/// it. Two ports of one list is exactly the shape that drifted on placement,
/// so neither side is the original: the JSON is.
enum SignupSource {
    struct Option: Equatable {
        let value: String
        let label: String
        /// The follow-up field's label. Nil when the answer names itself.
        let detailLabel: String?
        let detailPlaceholder: String?

        init(
            _ value: String, _ label: String,
            detailLabel: String? = nil, detailPlaceholder: String? = nil
        ) {
            self.value = value
            self.label = label
            self.detailLabel = detailLabel
            self.detailPlaceholder = detailPlaceholder
        }
    }

    /// Order is part of the spec: the answers that name a person come first.
    static let options: [Option] = [
        Option("coach", "A coach",
               detailLabel: "Your coach's name", detailPlaceholder: "Alex"),
        Option("player", "A friend or another player",
               detailLabel: "Their name", detailPlaceholder: "Alex"),
        Option("club", "My club",
               detailLabel: "Which club?", detailPlaceholder: "Your club's name"),
        Option("search", "Google or another search"),
        Option("youtube", "YouTube"),
        Option("instagram", "Instagram"),
        Option("tiktok", "TikTok"),
        Option("forum", "Reddit or a forum"),
        Option("event", "A tournament or event"),
        Option("other", "Other",
               detailLabel: "Where was it?",
               detailPlaceholder: "A podcast, a shop, a newsletter"),
    ]

    /// Matches the column's `char_length(detail) <= 120`.
    static let detailMaxLength = 120

    static func option(_ value: String?) -> Option? {
        guard let value else { return nil }
        return options.first { $0.value == value }
    }

    /// True when picking this answer should open the name field.
    static func asksForDetail(_ value: String?) -> Bool {
        option(value)?.detailLabel != nil
    }

    /// Trims, collapses runs of whitespace, and cuts to the column's limit.
    /// Returns nil for an answer that is nothing, so a blank field and an
    /// untouched one are stored the same way.
    ///
    /// The cut counts unicode scalars rather than `String.count`, because the
    /// column's `char_length` counts code points. Counting grapheme clusters
    /// here would let a 121-code-point answer through to a constraint
    /// violation at the very end of onboarding, where there is nothing useful
    /// to say to the person typing.
    static func normalizeDetail(_ value: String?) -> String? {
        let collapsed = (value ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(
                of: "\\s+", with: " ", options: .regularExpression
            )
        if collapsed.isEmpty { return nil }
        let scalars = collapsed.unicodeScalars
        guard scalars.count > detailMaxLength else { return collapsed }
        let cut = scalars.prefix(detailMaxLength)
        return String(String.UnicodeScalarView(cut))
    }
}
