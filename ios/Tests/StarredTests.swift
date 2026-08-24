import Foundation

// The Starred shelf's shaping: grouping, the count line, and the two
// labels a tile prints. Everything here is pure — the store that fetches
// the rows lives in StarredStore.swift and is not part of this build.

private func starUUID(_ n: Int) -> UUID {
    UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))!
}

private func mkRow(
    _ n: Int,
    match: Int,
    displayNo: Int,
    playedAt: String = "2026-08-22T12:00:00+00:00",
    winner: Winner? = .user,
    isLet: Bool = false,
    how: String? = nil,
    reasons: [String]? = nil,
    direction: String? = nil,
    t0: Double? = 100,
    t1: Double? = 106.5,
    opponent: String? = "Chris",
    venue: String? = "Pingpod",
    matchType: String? = "match"
) -> StarredPointRow {
    StarredPointRow(
        id: starUUID(n), matchId: starUUID(1000 + match), displayNo: displayNo,
        t0: t0, t1: t1, hasClip: true, confirmedWinner: winner,
        confirmedHow: how, direction: direction, lossReasons: reasons,
        isLet: isLet, edited: false, opponentName: opponent, venue: venue,
        playedAt: playedAt, matchType: matchType, hasThumb: true
    )
}

func runStarredTests() {
    // MARK: grouping

    let rows = [
        mkRow(1, match: 1, displayNo: 12, playedAt: "2026-08-23T10:00:00+00:00"),
        mkRow(2, match: 2, displayNo: 5),
        mkRow(3, match: 2, displayNo: 9),
        mkRow(4, match: 2, displayNo: 40),
        mkRow(5, match: 3, displayNo: 1, playedAt: "2026-08-01T10:00:00+00:00"),
    ]
    let groups = groupStarred(rows)
    check(groups.count == 3, "one group per match")
    check(groups[1].points.count == 3, "a match's points stay together")
    check(groups[0].matchId == starUUID(1001), "groups keep the row order")
    check(
        groups[1].points.map(\.displayNo) == [5, 9, 40],
        "points keep the order the RPC gave them"
    )

    // The RPC orders by match, so a group only ever starts once. If the
    // rows are ever re-sorted upstream this is what breaks first.
    let interleaved = [
        mkRow(1, match: 1, displayNo: 1),
        mkRow(2, match: 2, displayNo: 1),
        mkRow(3, match: 1, displayNo: 2),
    ]
    check(
        groupStarred(interleaved).count == 3,
        "interleaved rows split into three groups, not two"
    )

    check(groupStarred([]).isEmpty, "no rows, no groups")

    // MARK: group titles

    check(groups[1].title == "Chris · Pingpod", "title is opponent and venue")
    check(
        groups[1].subtitle == "Aug 22, 2026 · Match",
        "subtitle is date and type, got \(groups[1].subtitle)"
    )
    let noName = groupStarred([
        mkRow(9, match: 7, displayNo: 1, opponent: nil, venue: nil, matchType: nil)
    ])
    check(
        noName[0].title.hasPrefix("Match · "),
        "an untitled match falls back to the capture time, got \(noName[0].title)"
    )

    // MARK: the count line

    check(
        starredSummaryLine(rows) == "5 points · 3 matches",
        "count line, got \(starredSummaryLine(rows))"
    )
    check(
        starredSummaryLine([rows[0]]) == "1 point · 1 match",
        "count line goes singular on both halves"
    )

    // MARK: outcome

    check(mkRow(1, match: 1, displayNo: 1).outcomeLabel == "I won", "won")
    check(
        mkRow(1, match: 1, displayNo: 1, winner: .opponent).outcomeLabel
            == "They won",
        "lost"
    )
    check(
        mkRow(1, match: 1, displayNo: 1, winner: nil).outcomeLabel
            == "Not scored",
        "unscored"
    )
    // A skipped point reads its reason out of confirmed_how, and a let is
    // still a let even with a winner column left behind on the row.
    check(
        mkRow(1, match: 1, displayNo: 1, isLet: true, how: "let").outcomeLabel
            == "Let",
        "skipped names the reason"
    )
    check(
        mkRow(1, match: 1, displayNo: 1, isLet: true).outcomeLabel == "Skipped",
        "skipped with no reason"
    )

    // MARK: reason line

    let custom = [CustomReason(id: "abc", label: "Rushed the loop")]
    check(
        mkRow(1, match: 1, displayNo: 1, winner: .opponent,
              reasons: ["too_aggressive"])
            .reasonLabel(custom: custom) == "Too aggressive",
        "a stored slug renders as words, never as the slug"
    )
    check(
        mkRow(1, match: 1, displayNo: 1, winner: .opponent,
              reasons: ["custom:abc"])
            .reasonLabel(custom: custom) == "Rushed the loop",
        "the owner's own pill resolves through the label map"
    )
    check(
        mkRow(1, match: 1, displayNo: 1, winner: .opponent,
              reasons: ["custom:gone"])
            .reasonLabel(custom: custom) == "Removed reason",
        "a deleted pill says so rather than vanishing"
    )
    check(
        mkRow(1, match: 1, displayNo: 1, isLet: true, how: "let")
            .reasonLabel(custom: []) == nil,
        "a skipped point does not repeat its reason on the second line"
    )
    check(
        mkRow(1, match: 1, displayNo: 1).reasonLabel(custom: []) == nil,
        "most points have no reason line at all"
    )

    // MARK: timing

    check(
        mkRow(1, match: 1, displayNo: 1).durationLabel == "6.5s",
        "duration reads off t1 - t0"
    )
    check(
        mkRow(1, match: 1, displayNo: 1, t0: nil, t1: nil).durationLabel == nil,
        "missing timing prints nothing rather than 0.0s"
    )
    check(
        mkRow(1, match: 1, displayNo: 1, t0: 100, t1: 100).durationLabel == nil,
        "a zero-length rally is missing timing, not a rally"
    )

    // The poster frame must never be the clip's first moment (a player
    // standing still, the same picture on every tile), and must never be
    // past the end of a short one.
    check(
        mkRow(1, match: 1, displayNo: 1).posterTime == 1.5,
        "a normal rally posters at 1.5s"
    )
    let short = mkRow(1, match: 1, displayNo: 1, t0: 100, t1: 101.4)
    check(
        short.posterTime < 1.4 && short.posterTime >= 0.4,
        "a 1.4s rally posters inside itself, got \(short.posterTime)"
    )
    check(
        mkRow(1, match: 1, displayNo: 1, t0: 100, t1: 100.2).posterTime == 0.4,
        "a very short rally clamps to the floor rather than to zero"
    )

    // MARK: direction

    check(
        mkRow(1, match: 1, displayNo: 1, direction: "bh").directionLabel
            == "Backhand side",
        "direction label"
    )
    check(
        mkRow(1, match: 1, displayNo: 1).directionLabel == nil,
        "no direction, no label"
    )
}
