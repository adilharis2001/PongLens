import Foundation

/// The app and the website have to turn the same note into the same
/// links. Both read this one fixture; a rule changed on one platform and
/// not the other fails here.
func runLinkifyTests() {
    print("\n— links in entry text, against the web's own cases —")
    struct Expected: Decodable {
        let text: String
        let href: String
    }
    struct Case: Decodable {
        let why: String
        let text: String
        let links: [Expected]
    }
    struct Fixture: Decodable { let cases: [Case] }

    let url = URL(fileURLWithPath: "fixtures/linkify-cases.json")
    guard let data = try? Data(contentsOf: url),
          let fixture = try? JSONDecoder().decode(Fixture.self, from: data)
    else {
        fatalError("linkify: couldn't read fixtures/linkify-cases.json")
    }

    for c in fixture.cases {
        let spans = Linkify.segments(c.text)
        let found = spans.compactMap { span -> Expected? in
            guard let href = span.href else { return nil }
            return Expected(text: span.text, href: href)
        }
        check(
            found.count == c.links.count,
            "linkify [\(c.why)]: found \(found.count) links, expected \(c.links.count) in \(c.text)"
        )
        for (got, want) in zip(found, c.links) {
            check(got.text == want.text,
                  "linkify [\(c.why)]: link text \(got.text) != \(want.text)")
            check(got.href == want.href,
                  "linkify [\(c.why)]: href \(got.href) != \(want.href)")
        }
        // Splitting must never lose or invent a character.
        check(spans.map(\.text).joined() == c.text,
              "linkify [\(c.why)]: text not preserved")
        check(Linkify.hasLink(c.text) == !c.links.isEmpty,
              "linkify [\(c.why)]: hasLink disagrees")
    }

    // Whatever else a note contains, only three schemes are ever produced.
    let scary = "try javascript:alert(1) data:text/html,x file:///etc/passwd"
    check(Linkify.segments(scary).allSatisfy { $0.href == nil },
          "linkify: a scheme we do not open was turned into a link")

    check(Linkify.segments("").isEmpty, "linkify: empty text")
    check(Linkify.segments("no links here") == [LinkSpan(text: "no links here", href: nil)],
          "linkify: plain text is one span")
}
