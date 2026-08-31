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
}
