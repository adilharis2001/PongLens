import Foundation

/// The hrefs the server actually writes, and what each one should open.
/// The one that matters is the note: its link names a point, and the bell
/// used to throw that half away and open the top of the match.
func runMatchPointLinkChecks() {
    print("\n— match links —")

    let m = "7f2f0a1e-6b3c-4a55-9c1e-2d4b8e0a1f33"
    let p = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"

    // A coach's note on a rally. This is the exact shape notes_notify
    // builds (migration 031).
    let note = MatchPointLink(href: "/match/\(m)?p=\(p)")
    eq(note?.matchId, UUID(uuidString: m), "a note link names its match")
    eq(note?.pointId, UUID(uuidString: p), "a note link names its point")

    // A note left on the match rather than on a rally, and everything else
    // that points at a match: the match, and no point.
    eq(
        MatchPointLink(href: "/match/\(m)")?.pointId, nil,
        "a match link with no point opens the match")
    eq(
        MatchPointLink(href: "/match/\(m)")?.matchId, UUID(uuidString: m),
        "…and still names the match")

    // A finished export carries its scope on the query. It is not a point
    // link, and must not be mistaken for one.
    let reel = MatchPointLink(href: "/match/\(m)?export=starred")
    eq(reel?.matchId, UUID(uuidString: m), "an export link still names its match")
    eq(reel?.pointId, nil, "an export scope is not a point")

    // Order in the query must not decide the answer.
    eq(
        MatchPointLink(href: "/match/\(m)?export=full&p=\(p)")?.pointId,
        UUID(uuidString: p),
        "a point is found after another parameter")

    // Not ours, or not a match id: nothing, so the caller can fall through
    // to whatever else the href might be.
    check(MatchPointLink(href: "/journal") == nil, "the journal is not a match link")
    check(MatchPointLink(href: "/admin/uploads/\(m)") == nil, "an admin page is not a match link")
    check(MatchPointLink(href: "/match/not-a-uuid") == nil, "a match link needs a real id")
    check(MatchPointLink(href: "/match/\(m)/feedback") == nil, "a deeper path is not this link")

    // A point that is not a real id leaves the match link intact. Losing
    // the whole link over the half that is broken would turn a bad point
    // reference into a tap that does nothing.
    let broken = MatchPointLink(href: "/match/\(m)?p=12")
    eq(broken?.matchId, UUID(uuidString: m), "a broken point keeps the match")
    eq(broken?.pointId, nil, "a broken point is no point")
}
