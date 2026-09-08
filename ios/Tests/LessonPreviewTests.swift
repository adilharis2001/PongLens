import Foundation

// Twin of src/lib/journal/preview.test.ts: the same cases, in the same
// order, so the two surfaces cannot disagree about which four.
private struct T: PreviewTheme { let name: String; let points: [String] }

func runLessonPreviewChecks() {
    let themes = [
        T(name: "Stance", points: ["Stand wider.", "Stay low.", "  ", "Bend the knees."]),
        T(name: "Serve", points: ["Serve long to invite a fast return.", "Keep the serve simple."]),
    ]
    check(previewPoints(themes) == ["Stand wider.", "Stay low.", "Bend the knees.", "Serve long to invite a fast return."],
          "the first four points, across themes in order, blanks skipped")
    check(previewPoints(themes, limit: 2) == ["Stand wider.", "Stay low."], "the limit is the limit")
    check(previewPoints([T](), limit: 4).isEmpty, "nothing in, nothing out")
    check(previewPoints([T(name: "One", points: ["Only this."])]) == ["Only this."], "fewer than the limit is fine")
    check(previewTruncates(themes), "five points means the card says more")
    check(!previewTruncates([T(name: "One", points: ["A", "B", "C", "D"])]), "exactly the limit does not")
    print("lesson preview checks passed")
}
