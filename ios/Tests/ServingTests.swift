import Foundation

// Port-parity checks for Core/Serving.swift.
//
// The MISSING RALLY fixture below is the same one in
// src/app/match/[id]/serving.test.ts, character for character. serving.ts
// and Serving.swift are line-for-line ports of each other and nothing else
// stops them drifting: the rotation is the source of truth for "who
// served" on every surface, and the two platforms disagreeing about it
// would show as a different server on the same point.

private func servingInputs(
    _ seq: String,
    _ overrides: [Int: Winner] = [:]
) -> [ServeInput] {
    Array(seq).enumerated().map { i, c in
        ServeInput(
            id: UUID(),
            serverOverride: overrides[i],
            isLet: c == "L",
            confirmedWinner: c == "U" ? .user : (c == "T" ? .opponent : nil),
            gameEndOverride: nil
        )
    }
}

/// The served-by sequence as a string, "U"/"T"/"?" per point.
private func servers(
    _ seq: String,
    _ first: Winner?,
    _ overrides: [Int: Winner] = [:]
) -> String {
    let inputs = servingInputs(seq, overrides)
    let serving = computeServingInputs(inputs, firstServer: first)
    return String(inputs.map { p -> Character in
        switch serving[p.id]?.server {
        case .some(.user): return "U"
        case .some(.opponent): return "T"
        default: return "?"
        }
    })
}

func runServingParityChecks() {
    print("\nserve rotation (parity with serving.test.ts)")

    check(
        servers("....................", .user) == "UUTTUUTTUUTTUUTTUUTT",
        "two serves each, alternating"
    )
    check(
        servers("....................", .opponent) == "TTUUTTUUTTUUTTUUTTUU",
        "two serves each from the other side"
    )
    check(servers("....", nil) == "????", "no first server means no answer")

    // Alternating winners: 10-10 is reached entering point 20, and from
    // there each player serves one.
    let alt = "UTUTUTUTUTUTUTUTUTUT" + "UTUTUT"
    check(
        servers(alt, .user) == "UUTTUUTTUUTTUUTTUUTT" + "UTUTUT",
        "one serve each from 10-10"
    )
    check(
        servers("UTUTUTUTUTUTUTUTUTUT" + "......", .user)
            == "UUTTUUTTUUTTUUTTUUTT" + "UTUTUT",
        "deuce is judged on the confirmed score, so unscored points hold it"
    )

    check(servers("....", .user) == "UUTT", "plain block")
    check(
        servers(".L..", .user) == "UUUT",
        "a skipped point is served again and does not advance the rotation"
    )

    let g1 = "UUUUUUUUUUU"
    check(
        servers(g1 + "....", .user) == "UUTTUUTTUUT" + "TTUU",
        "the first server alternates at a game boundary"
    )

    check(
        servers("....................", .user, [5: .user])
            == servers("....................", .user),
        "a correction that agrees with the walk changes nothing"
    )
    check(
        servers("..........", .user, [4: .opponent]) == "UUTTTTUUTT",
        "a correction re-anchors every later point"
    )
    check(
        servers("..........", .user, [5: .opponent]) == "UUTTUTTUUT",
        "a correction starts a new two-serve block"
    )
    check(
        servers("............", .user, [4: .opponent, 8: .user])
            == "UUTTTTUUUUTT",
        "the walk alone cannot ignore a later correction"
    )
    check(
        servers(g1 + "....", .user, [2: .user]) == "UUUUTTUUTTUUUTT",
        "a correction carries across a game boundary"
    )

    // THE MISSING RALLY - thirteen rallies played, the cut dropped the
    // sixth. Twelve cards remain and every card after the gap is on the
    // wrong server, alternating right and wrong. One correction on the
    // first card after the gap has to fix all of it; before the block
    // reset it took a correction on all seven.
    let truth = "UUTTUTTUUTTU"
    let withoutFix = "UUTTUUTTUUTT"
    let cardAfterTheGap = 5
    check(
        servers("............", .user) == withoutFix,
        "a dropped rally leaves the rotation wrong on every other card"
    )
    check(
        servers("............", .user, [cardAfterTheGap: .opponent]) == truth,
        "one correction fixes a rally the cut missed"
    )

    // A CARD THAT BECOMES TWO. Splitting a fused clip adds a real point,
    // so the rotation has to move with it — the half that comes out of a
    // block's SECOND serve belongs to the other player, and every card
    // after the cut shifts one place round the two-serve cycle. Nothing
    // computes this per card: it falls out of the walk, provided the new
    // half is in the list in TIMELINE order, which is the part a split
    // can get wrong (split_point mints idx = max + 1, at the end).
    check(servers("....", .user) == "UUTT", "four cards, two serves each")
    check(
        splitServers(cards: 4, splitting: 1, first: .user) == "UUTTU",
        "splitting a block's second serve hands the new half to the other side"
    )
    check(
        splitServers(cards: 4, splitting: 0, first: .user) == "UUTTU",
        "splitting a block's first serve keeps it, and moves everything after"
    )
    check(
        splitServers(cards: 4, splitting: 3, first: .opponent) == "TTUUT",
        "and it holds from the other first server"
    )
}

/// The served-by sequence after card `splitting` is cut in two, built the
/// way a real split builds it: the child takes a t0 INSIDE the parent's old
/// span and an idx past the end of the match, then the list is sorted the
/// way `visible` sorts it. A child ordered by idx instead would land last
/// and leave every card between untouched, which is the failure this is
/// here to catch.
private func splitServers(
    cards: Int, splitting: Int, first: Winner
) -> String {
    var points = (0..<cards).map { i in
        mkPoint(i + 1, t0: Double(i) * 10, t1: Double(i) * 10 + 6)
    }
    let parent = points[splitting]
    let at = (parent.t0 ?? 0) + 3
    points[splitting].t1 = at
    var child = mkPoint(cards + 1, t0: at, t1: Double(splitting) * 10 + 6)
    child.edited = true
    points.append(child)
    let ordered = points.sorted { a, b in
        if let ta = a.t0, let tb = b.t0, ta != tb { return ta < tb }
        return a.idx < b.idx
    }
    let serving = computeServing(ordered, firstServer: first)
    return String(ordered.map { p -> Character in
        switch serving[p.id]?.server {
        case .some(.user): return "U"
        case .some(.opponent): return "T"
        default: return "?"
        }
    })
}
