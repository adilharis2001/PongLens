import Foundation

/// The iOS half of the signup-source list, checked against the same JSON the
/// web half uses. Neither side produces the table; it is the spec written down
/// once, so that comparing two ports cannot degenerate into reading the same
/// paragraph twice and making the same mistake twice.
func runSignupSourceChecks() {
    print("\n— signup source —")

    let url = URL(fileURLWithPath: "fixtures/signup-sources.json")
    guard let data = try? Data(contentsOf: url),
          let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else {
        check(false, "fixture fixtures/signup-sources.json is readable")
        return
    }

    // --- the answers offered, in the order the spec gives them ------------
    let spec = root["options"] as? [[String: Any]] ?? []
    check(!spec.isEmpty, "the options table is not empty")
    check(SignupSource.options.count == spec.count,
          "offers \(spec.count) answers, got \(SignupSource.options.count)")
    for (i, expected) in spec.enumerated() where i < SignupSource.options.count {
        let got = SignupSource.options[i]
        let value = expected["value"] as? String ?? "?"
        check(got.value == value, "answer \(i) is \(value), got \(got.value)")
        check(got.label == (expected["label"] as? String ?? ""),
              "\(value) reads “\(expected["label"] as? String ?? "")”, got “\(got.label)”")
        check(got.detailLabel == expected["detailLabel"] as? String,
              "\(value) field label")
        check(got.detailPlaceholder == expected["detailPlaceholder"] as? String,
              "\(value) field placeholder")
    }

    // --- which answers open a field ---------------------------------------
    let asking = SignupSource.options.filter { SignupSource.asksForDetail($0.value) }
        .map(\.value)
    check(asking == ["coach", "player", "club", "other"],
          "the answers that open a field, got \(asking)")
    check(!SignupSource.asksForDetail("youtube"), "YouTube names itself")
    check(!SignupSource.asksForDetail(nil), "no answer opens no field")
    check(!SignupSource.asksForDetail("not-an-answer"), "an unknown answer opens no field")

    // --- looking an answer up ---------------------------------------------
    check(SignupSource.option("coach")?.label == "A coach", "coach looks up")
    check(SignupSource.option("nope") == nil, "an unknown answer looks up to nothing")
    check(SignupSource.option(nil) == nil, "no answer looks up to nothing")

    // --- the limit is the column's limit ----------------------------------
    check(SignupSource.detailMaxLength == root["detailMaxLength"] as? Int,
          "the field's limit matches the column's")

    // --- tidying up what was typed ----------------------------------------
    for c in root["detailCases"] as? [[String: Any]] ?? [] {
        let name = c["name"] as? String ?? "?"
        let got = SignupSource.normalizeDetail(c["input"] as? String)
        let expected = c["expected"] as? String
        check(got == expected,
              "\(name) — expected \(expected ?? "nothing"), got \(got ?? "nothing")")
    }
    check(SignupSource.normalizeDetail(nil) == nil, "nothing typed at all")

    // A cut answer still fits the column, counted the way Postgres counts.
    let long = String(repeating: "a", count: SignupSource.detailMaxLength * 2)
    let cut = SignupSource.normalizeDetail(long) ?? ""
    check(cut.unicodeScalars.count == SignupSource.detailMaxLength,
          "a cut answer is \(SignupSource.detailMaxLength) code points, got \(cut.unicodeScalars.count)")
}
