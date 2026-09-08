import Foundation

/// One run of an entry's text: either plain words, or a web address with
/// somewhere to go.
struct LinkSpan: Equatable {
    let text: String
    /// nil for a plain run. Only ever http, https or mailto.
    let href: String?
}

/// Turning a web address inside plain text into something you can tap.
///
/// This is the Swift half of one rule. `src/lib/linkify.ts` is the other,
/// and both are checked against `ios/Tests/fixtures/linkify-cases.json`,
/// because the same note has to read the same way in the app and in a
/// browser. That fixture is the reason this is written out rather than
/// handed to `NSDataDetector`: the detector is more eager than the rule
/// the web runs, it links bare domains, and the drift would show up as
/// one note with a link in the app and plain text on the site.
///
/// The rule is GitHub's extended autolink specification
/// (https://github.github.com/gfm/#autolinks-extension-). Addresses are
/// found in the text and built from what was written, never parsed out of
/// markup, so the words a reader sees are always the destination.
enum Linkify {
    /// An address may only start at the beginning, after whitespace, or
    /// after one of these delimiters.
    private static let openers: Set<Character> = [
        " ", "\t", "\n", "\r", "\u{0B}", "\u{0C}", "*", "_", "~", "(",
    ]

    /// Trailing characters that punctuate the sentence, not the address.
    private static let trailing: Set<Character> = [
        "?", "!", ".", ",", ":", "*", "_", "~",
    ]

    private static let candidate = try! NSRegularExpression(
        pattern: "(?:https?://|www\\.)[^\\s<]*|[A-Za-z0-9._+-]+@[A-Za-z0-9._-]+",
        options: [.caseInsensitive]
    )

    /// Split text into plain runs and address runs. Text with no address
    /// comes back as one run, which is the common case.
    static func segments(_ text: String) -> [LinkSpan] {
        let ns = text as NSString
        var out: [LinkSpan] = []
        var cursor = 0
        var search = 0

        while search < ns.length {
            let scope = NSRange(location: search, length: ns.length - search)
            guard let match = candidate.firstMatch(in: text, options: [], range: scope)
            else { break }
            let start = match.range.location
            let raw = ns.substring(with: match.range)
            search = start + match.range.length

            let before: Character = start == 0
                ? " "
                : (ns.substring(with: NSRange(location: start - 1, length: 1)).first ?? " ")
            if !openers.contains(before) { continue }

            let lower = raw.lowercased()
            let isEmail = !(lower.hasPrefix("http://") || lower.hasPrefix("https://")
                || lower.hasPrefix("www."))
            let link = isEmail ? trimEmail(raw) : trimTrailing(raw)
            if link.isEmpty { continue }

            var href: String?
            if isEmail {
                if let at = link.firstIndex(of: "@") {
                    let local = String(link[link.startIndex..<at])
                    let host = String(link[link.index(after: at)...])
                    if !local.isEmpty, validDomain(host) { href = "mailto:\(link)" }
                }
            } else if let host = hostOf(link), validDomain(host) {
                // https on a bare www address, matching the web: every
                // destination worth sending someone to serves it.
                href = lower.hasPrefix("http") ? link : "https://\(link)"
            }
            guard let href else { continue }

            if start > cursor {
                out.append(LinkSpan(
                    text: ns.substring(with: NSRange(location: cursor, length: start - cursor)),
                    href: nil
                ))
            }
            out.append(LinkSpan(text: link, href: href))
            cursor = start + (link as NSString).length
            search = cursor
        }

        if cursor < ns.length {
            out.append(LinkSpan(
                text: ns.substring(from: cursor),
                href: nil
            ))
        }
        return out
    }

    /// Whether the text carries an address at all.
    static func hasLink(_ text: String) -> Bool {
        segments(text).contains { $0.href != nil }
    }

    // MARK: - The rule's awkward parts

    /// Alphanumerics, hyphens and underscores in each segment, at least
    /// one dot, and no underscore in either of the last two segments.
    private static func validDomain(_ host: String) -> Bool {
        let segments = host.split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count >= 2 else { return false }
        for segment in segments {
            if segment.isEmpty { return false }
            for ch in segment where !(ch.isLetter || ch.isNumber || ch == "-" || ch == "_") {
                return false
            }
            // Non-ASCII letters pass isLetter; the rule is ASCII only.
            if !segment.allSatisfy({ $0.isASCII }) { return false }
        }
        return !segments.suffix(2).contains { $0.contains("_") }
    }

    /// The host of a candidate, with any port dropped before checking.
    private static func hostOf(_ candidate: String) -> String? {
        var rest = candidate
        let lower = candidate.lowercased()
        if lower.hasPrefix("https://") { rest = String(candidate.dropFirst(8)) }
        else if lower.hasPrefix("http://") { rest = String(candidate.dropFirst(7)) }
        let host = rest.prefix { $0 != "/" && $0 != "?" && $0 != "#" }
        let name = host.prefix { $0 != ":" }
        return name.isEmpty ? nil : String(name)
    }

    /// Give the sentence its punctuation back. Three passes, repeated
    /// until the address stops shrinking, because they interact: the full
    /// stop in `(www.a.com/b).` has to go before the bracket rule can see
    /// the bracket.
    private static func trimTrailing(_ link: String) -> String {
        var out = link
        while true {
            let before = out

            while let last = out.last, trailing.contains(last) {
                out.removeLast()
            }

            // A closing bracket belongs to the address only when its
            // opener is inside the address too.
            while out.hasSuffix(")") {
                let opens = out.filter { $0 == "(" }.count
                let closes = out.filter { $0 == ")" }.count
                if closes <= opens { break }
                out.removeLast()
            }

            // A trailing `&nbsp;`-shaped run is prose around the address.
            if out.hasSuffix(";"), let amp = out.lastIndex(of: "&") {
                let inner = out[out.index(after: amp)..<out.index(before: out.endIndex)]
                if !inner.isEmpty, inner.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) }) {
                    out = String(out[out.startIndex..<amp])
                }
            }

            if out == before { return out }
        }
    }

    /// Emails carry no path, so only their own tail characters come off.
    private static func trimEmail(_ link: String) -> String {
        var out = link
        while let last = out.last, last == "." || last == "-" || last == "_" {
            out.removeLast()
        }
        return out
    }
}
