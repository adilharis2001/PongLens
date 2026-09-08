import Foundation

/// A theme as the preview rule sees it. `LessonTakeaways.Theme` conforms
/// where it is declared; this file stays Foundation-only so the rule is
/// checked by ios/Tests/run.sh.
protocol PreviewTheme {
    var name: String { get }
    var points: [String] { get }
}

/// The first few points of an entry, for a card that is a doorway.
///
/// In the Coaching feed a written or spoken entry is a preview: the title
/// and the first four points across the themes in order, then the whole
/// card opens the Journal on that entry. The Journal keeps the full card.
/// This is the one rule for "which four", and its twin on the web is
/// previewPoints in src/lib/journal/preview.ts with the same cases in its
/// test. Callers hand it the visible themes, so a recap's link theme is
/// already gone before it is counted.
func previewPoints<T: PreviewTheme>(_ themes: [T], limit: Int = 4) -> [String] {
    var out: [String] = []
    for theme in themes {
        for point in theme.points {
            let text = point.trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { continue }
            out.append(text)
            if out.count == limit { return out }
        }
    }
    return out
}

/// Whether the preview left anything out, so the card can say "more".
func previewTruncates<T: PreviewTheme>(_ themes: [T], limit: Int = 4) -> Bool {
    var seen = 0
    for theme in themes {
        for point in theme.points where !point.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            seen += 1
            if seen > limit { return true }
        }
    }
    return false
}
