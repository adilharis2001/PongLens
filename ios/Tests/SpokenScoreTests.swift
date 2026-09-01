import Foundation

// Reading a spoken game score off a live transcript.
//
// Every case here is a string the speech recogniser can genuinely hand
// back for someone saying "game one score eleven two" into a phone across
// a table tennis hall. The homophones are not hypothetical: "two" is heard
// as "to" more often than as "two", and a recogniser with no idea a score
// is coming will happily run two numbers into one.
//
// The refusals matter as much as the reads. A score guessed wrong is
// silent and reaches the match; a score refused says so on screen and the
// user repeats it.

private func reads(_ said: String, _ game: Int, _ you: Int, _ them: Int,
                   line: UInt = #line) {
    let got = SpokenScore.read(said)
    check(got == .captured(SpokenGameScore(game: game, you: you, them: them)),
          "\"\(said)\" -> game \(game), \(you)-\(them), got \(got)", line: line)
}

private func misses(_ said: String, _ game: Int, line: UInt = #line) {
    let got = SpokenScore.read(said)
    check(got == .missed(game: game),
          "\"\(said)\" -> missed game \(game), got \(got)", line: line)
}

private func ignores(_ said: String, line: UInt = #line) {
    let got = SpokenScore.read(said)
    check(got == .ignored, "\"\(said)\" -> ignored, got \(got)", line: line)
}

func runSpokenScoreChecks() {
    print("\n— spoken score —")

    // The phrase as taught, in the shapes a recogniser writes it.
    reads("Game 1 score 11-2", 1, 11, 2)
    reads("game one score eleven two", 1, 11, 2)
    reads("Game 3 score 11 7", 3, 11, 7)
    reads("game seven score fourteen twelve", 7, 14, 12)
    reads("Game 2, score 12-10.", 2, 12, 10)

    // Losing a game. Your own score comes first either way, which is the
    // one convention the user has to hold.
    reads("game one score two eleven", 1, 2, 11)
    reads("Game 4 score 9-11", 4, 9, 11)

    // Homophones. "eleven to" is the single most likely thing to arrive
    // for a game that finished 11-2, and "game won" for game one.
    reads("game one score eleven to", 1, 11, 2)
    reads("game won score eleven to", 1, 11, 2)
    reads("game to score eleven for", 2, 11, 4)
    reads("game one score eleven ate", 1, 11, 8)
    reads("game three score eleven oh", 3, 11, 0)
    reads("game three score eleven nil", 3, 11, 0)

    // The separator said out loud, which lands as a third number because
    // "to" is also two. The middle one goes; a real two in the middle
    // does not.
    reads("game one score eleven to two", 1, 11, 2)
    reads("game one score eleven to nine", 1, 11, 9)

    // Numbers run together. The scoring rule does the disambiguating:
    // of the ways 112 can be cut, only 11 and 2 can end a game.
    reads("game one score 112", 1, 11, 2)
    reads("game two score 119", 2, 11, 9)
    reads("game five score 1412", 5, 14, 12)
    reads("game one score 1210", 1, 12, 10)
    reads("game one score oh eleven", 1, 0, 11)

    // Refused, and each for a reason the user can act on by repeating.
    misses("game one score 804", 1)          // mush
    misses("game one score 1110", 1)         // 11-10 ends nothing
    misses("game one score twelve five", 1)  // 12 only comes through deuce
    misses("game one score eleven ten", 1)
    misses("game one score eight four", 1)   // an unfinished game
    misses("game two score", 2)              // trailing off
    misses("game two score eleven", 2)       // only one number
    misses("game one score a hundred and six", 1)
    // A glued number with a leading zero loses the zero on the way in, so
    // there is nothing left to cut. Refusing is right: "11" alone is not a
    // score, and inventing the other half would be a guess.
    misses("game one score 011", 1)

    // Saying it again to correct it. Results arrive as they form, so both
    // attempts sit in one string and the LAST one has to win — otherwise
    // the correction never lands and, worse, the stale phrase at the front
    // keeps matching for the rest of the match.
    reads("game one score eleven five game one score eleven three", 1, 11, 3)
    reads("Game 1 score 11-5. Game 1 score 11-3.", 1, 11, 3)
    reads("game one score 11 5 game two score 11 9", 2, 11, 9)
    // A correction that lands on the same numbers is still that game.
    reads("game one score 11 5 game one score 11 5", 1, 11, 5)
    // The newest phrase wins even when it is the one that fails, so the
    // screen asks for the score it actually needs rather than sitting on
    // an older success.
    misses("game one score 11 5 game three score eleven ten", 3)

    // 7-11, which the recogniser writes as the shop. This one kept
    // failing in a real hall and nothing else did: glued into a single
    // word it was neither a number nor a number word, so the whole score
    // went. Every shape it comes back in has to read.
    reads("game one score 7-Eleven", 1, 7, 11)
    reads("game one score 7Eleven", 1, 7, 11)
    reads("game one score seven eleven", 1, 7, 11)
    reads("game one score 7 11", 1, 7, 11)
    reads("game one score 711", 1, 7, 11)

    // The trigger as the recogniser mangles it. Widening this is safe
    // because a legal score still has to follow.
    reads("came one score eleven two", 1, 11, 2)
    reads("game one scored eleven two", 1, 11, 2)
    reads("game one school eleven two", 1, 11, 2)

    // Filler between the game number and the score word, which is how
    // people actually talk.
    reads("game one, the score was eleven two", 1, 11, 2)
    reads("game three final score 11-6", 3, 11, 6)

    // The word "score" is optional when a legal pair follows: the phrase
    // was designed with it and within a week nobody was saying it, the
    // designer included. The legality gate is what keeps chat out.
    reads("Game 1 3-11", 1, 3, 11)
    reads("game one three eleven", 1, 3, 11)
    reads("game two 11 9", 2, 11, 9)
    reads("game one eleven to", 1, 11, 2)
    reads("game five, 12-10", 5, 12, 10)

    // Without the score word, garbage is chat and leaves no mark — no
    // capture, but no ?? row either. "game one more point" is someone
    // TALKING, and it must not write to the board.
    ignores("game one more point")
    ignores("that was game two I think")
    ignores("game one was great fun")
    // With the score word, mush still files the miss: intent was
    // unmistakable, so the ?? row is the honest answer.
    misses("game four score seven together", 4)

    // Not addressed to us. The hall is full of the word "game".
    ignores("nice game")
    ignores("that was a good game, 11-2")
    ignores("the score is eleven two")
    ignores("game nine score eleven two")   // no ninth game exists
    reads("game one eleven two", 1, 11, 2)  // the score word is optional now
    ignores("")

    // The phrase anywhere in a longer sentence, since a recogniser
    // finalises a whole utterance rather than the words we want.
    reads("okay game two score eleven six", 2, 11, 6)
    reads("right, that's it. Game 5 score 11-9, well played", 5, 11, 9)
}


// The hand editor's derivation: who won plus the loser's points is the
// whole entry, because that is how players say scores out loud.
func runStandardGameChecks() {
    print("\n— standard game derivation —")

    check(SpokenScore.standardGame(loserPoints: 0) == (11, 0), "11-0")
    check(SpokenScore.standardGame(loserPoints: 7) == (11, 7), "11-7")
    check(SpokenScore.standardGame(loserPoints: 9) == (11, 9), "11-9")
    // Deuce: the loser reaching ten means the winner finished two clear.
    check(SpokenScore.standardGame(loserPoints: 10) == (12, 10), "12-10")
    check(SpokenScore.standardGame(loserPoints: 14) == (16, 14), "16-14")

    // The reverse read round-trips every standard score, both ways round.
    check(SpokenScore.standardLoser(you: 11, them: 7)! == (true, 7), "won 11-7")
    check(SpokenScore.standardLoser(you: 7, them: 11)! == (false, 7), "lost 7-11")
    check(SpokenScore.standardLoser(you: 12, them: 10)! == (true, 10), "won 12-10")

    // Non-standard pairs refuse, so the editor opens them in free mode
    // instead of silently rounding them to something they are not.
    check(SpokenScore.standardLoser(you: 11, them: 10) == nil, "11-10 is not standard")
    check(SpokenScore.standardLoser(you: 8, them: 4) == nil, "an abandoned game is not standard")
    check(SpokenScore.standardLoser(you: 11, them: 11) == nil, "a tie is not a game")
    check(SpokenScore.standardLoser(you: 13, them: 10) == nil, "13-10 skips deuce")
}
