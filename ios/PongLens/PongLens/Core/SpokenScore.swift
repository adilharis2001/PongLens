import Foundation

/// A game score someone said into the phone while the match was recording.
///
/// The game number comes out of the phrase itself — "game three score
/// eleven seven" — rather than from a counter the app keeps. That is what
/// makes correcting one free: say it again and it replaces the old
/// reading, in any order, at any point in the match.
struct SpokenGameScore: Codable, Equatable, Identifiable {
    /// 1 through 7, as spoken.
    var game: Int
    /// Always the speaker's own score first. The board prints it back
    /// under the user's own name so a pair the wrong way round is visible
    /// immediately.
    ///
    /// Both nil for a game whose phrase was heard and whose numbers were
    /// not. That row still belongs on the board: "game four happened and
    /// we did not get it" is information, and an absent row is silence
    /// that reads as nothing having been said.
    var you: Int?
    var them: Int?

    var known: Bool { you != nil && them != nil }

    var id: Int { game }
}

/// What one finished piece of transcript amounted to.
enum SpokenScoreReading: Equatable {
    /// Nothing addressed to us: room noise, an opponent talking, a
    /// sentence with the word "game" in it. Dropped without a trace.
    case ignored
    case captured(SpokenGameScore)
    /// The phrase arrived and the numbers did not survive it.
    ///
    /// This case is the entire reason the trigger is three fixed words. We
    /// always know an attempt was made, and which game it was about, even
    /// when the score itself came back as mush — so the screen can say
    /// "Game 2, didn't catch the score" instead of staying silent and
    /// leaving someone to discover the gap at the end of the match.
    case missed(game: Int)
}

enum SpokenScore {

    /// Games 8 and up are not a thing, and the ceiling doubles as a filter:
    /// "game nine" is somebody talking, not somebody reporting.
    static let maxGame = 7

    /// What the user is asked to say, used in the settings copy so the
    /// instruction and the parser can never drift apart.
    static func examplePhrase(game: Int = 1) -> String {
        "Game \(numberWords[game] ?? "one") score eleven two"
    }

    // MARK: - Reading

    static func read(_ transcript: String) -> SpokenScoreReading {
        // Only the recent tail is considered. The text handed in grows for
        // as long as somebody keeps talking near the phone, and nothing
        // said a minute ago can still be the score being called now.
        let tokens = tokenise(transcript).suffix(40).map { $0 }
        guard let hit = trigger(in: tokens) else { return .ignored }

        let tail = Array(tokens[hit.after...].prefix(6))
        guard let pair = score(from: tail) else { return .missed(game: hit.game) }
        return .captured(
            SpokenGameScore(game: hit.game, you: pair.0, them: pair.1))
    }

    // MARK: - The phrase

    /// "game" <1-7> "score", the three words adjacent. Adjacent on purpose:
    /// allowing filler between them lets an ordinary sentence about a game
    /// and a score drift into range, and the whole point of a fixed phrase
    /// is that nobody says it by accident.
    ///
    /// Scanned from the END, so the LAST phrase in the text wins.
    ///
    /// This is not a detail. Results arrive as they form and the text
    /// accumulates, so a correction — saying a game's score again because
    /// the first attempt was wrong — leaves both phrases in the same
    /// string. Taking the first match meant the correction could never
    /// land, and worse, that every later score was ignored too, because
    /// the original phrase stayed pinned at the front of a string that
    /// only ever grew. Last-match is also simply the right rule: the most
    /// recent thing somebody said is what they meant.
    private static func trigger(in tokens: [String]) -> (game: Int, after: Int)? {
        guard tokens.count >= 3 else { return nil }
        var i = tokens.count - 3
        while i >= 0 {
            defer { i -= 1 }
            guard gameWords.contains(tokens[i]) else { continue }
            guard let number = value(of: tokens[i + 1])?.n,
                  (1...maxGame).contains(number) else { continue }
            // Up to two filler words may sit between the number and
            // "score" — "game one, the score was ..." is a natural thing
            // to say and the phrase is still unmistakably ours.
            var j = i + 2
            var skipped = 0
            while j < tokens.count, skipped <= 2 {
                if scoreWords.contains(tokens[j]) { return (number, j + 1) }
                guard separators.contains(tokens[j]) else { break }
                j += 1
                skipped += 1
            }
        }
        return nil
    }

    // MARK: - The numbers

    /// Two numbers out of what followed the phrase, or nil.
    ///
    /// Nil is a real answer here and is reached often. Anything that does
    /// not resolve to exactly one legal game score is refused, because a
    /// score written down wrong is worse than one the user is told to
    /// repeat: the wrong one is silent and ships to the match.
    private static func score(from tail: [String]) -> (Int, Int)? {
        var values: [(n: Int, softTwo: Bool)] = []
        var i = 0
        while i < tail.count, values.count < 3 {
            let token = tail[i]
            if separators.contains(token) { i += 1; continue }
            guard var found = value(of: token) else { i += 1; continue }
            // "twenty one" arrives as two tokens and is one number.
            if found.n % 10 == 0, found.n >= 20, i + 1 < tail.count,
               let unit = value(of: tail[i + 1]), (1...9).contains(unit.n) {
                found = (found.n + unit.n, false)
                i += 1
            }
            values.append(found)
            i += 1
        }

        // "eleven to two" is 11-2 said with the separator out loud, and it
        // reaches here as three numbers because "to" is also 2. The middle
        // one goes only when it is the soft kind, so a genuine "two" in
        // the middle is never thrown away.
        if values.count == 3, values[1].softTwo {
            values.remove(at: 1)
        }

        if values.count >= 2 {
            return legal(values[0].n, values[1].n) ? (values[0].n, values[1].n) : nil
        }
        if values.count == 1 {
            return split(values[0].n)
        }
        return nil
    }

    /// One number where two were expected: the transcriber ran them
    /// together, so "eleven two" arrives as 112.
    ///
    /// This is the most common way a correctly-heard score arrives in an
    /// unusable shape, and the scoring rule rescues nearly all of it. A
    /// game ends 11-anything up to 9, or after deuce by exactly two — so
    /// of the ways 112 can be cut, only 11 and 2 is a score that a game of
    /// table tennis can actually finish on. Where more than one cut
    /// survives, this refuses rather than picks.
    private static func split(_ glued: Int) -> (Int, Int)? {
        let digits = String(glued)
        guard digits.count >= 2 else { return nil }
        var found: [(Int, Int)] = []
        for cut in 1..<digits.count {
            let left = String(digits.prefix(cut))
            let right = String(digits.dropFirst(cut))
            // "1104" would be 11 and 04, which nobody says out loud.
            if right.count > 1, right.hasPrefix("0") { continue }
            guard let a = Int(left), let b = Int(right), legal(a, b) else { continue }
            found.append((a, b))
        }
        return found.count == 1 ? found[0] : nil
    }

    /// A score a game of table tennis can actually end on, under the rules
    /// the rest of the app scores by: eleven, clear by two, and past
    /// eleven only through deuce. Deliberately strict — it is the check
    /// that turns a mis-heard number into a clean refusal instead of a
    /// wrong score nobody notices.
    static func legal(_ a: Int, _ b: Int) -> Bool {
        guard a >= 0, b >= 0, a <= 40, b <= 40 else { return false }
        let winner = max(a, b), loser = min(a, b)
        if winner == GAME_TARGET { return loser <= GAME_TARGET - CLEAR_BY }
        if winner > GAME_TARGET { return loser == winner - CLEAR_BY }
        return false
    }

    // MARK: - Words

    private static func tokenise(_ text: String) -> [String] {
        // Digits and letters break apart, so "7Eleven" is 7 and eleven.
        //
        // Say a game finished 7-11 and the recogniser writes the shop:
        // "7-Eleven", and often with the hyphen gone entirely. Glued into
        // one word it is neither a number nor a number word, so it was
        // dropped and the whole score refused — which is exactly the
        // failure that kept coming back on 7-11 and nothing else.
        var tokens: [String] = []
        var current = ""
        var currentIsDigit = false
        for character in text.lowercased() {
            let digit = character.isNumber
            let keep = character.isLetter || digit
            if !keep || (!current.isEmpty && digit != currentIsDigit) {
                if !current.isEmpty { tokens.append(current) }
                current = ""
            }
            if keep {
                current.append(character)
                currentIsDigit = digit
            }
        }
        if !current.isEmpty { tokens.append(current) }
        return tokens
    }

    /// "Game" as the recogniser may render it. Widening this is safe in a
    /// way that widening the numbers is not: a phrase still has to carry a
    /// game number, a score word AND a score a game can legally end on
    /// before anything is written down.
    private static let gameWords: Set<String> = [
        "game", "games", "gaming", "came", "gain", "gam",
    ]

    private static let scoreWords: Set<String> = [
        "score", "scores", "scored", "scoring", "school", "sport", "court",
        "skor", "scorer",
    ]

    private static let separators: Set<String> = [
        "dash", "hyphen", "and", "vs", "v", "versus", "against", "the", "was",
        "is", "it", "final", "ended", "finished", "a", "of", "in",
    ]

    private static let numberWords: [Int: String] = [
        1: "one", 2: "two", 3: "three", 4: "four",
        5: "five", 6: "six", 7: "seven",
    ]

    /// A word or a digit string as a number, plus whether it is the soft
    /// kind that might really have been a separator.
    ///
    /// The homophones are not a nicety. Speech recognition has no idea a
    /// table tennis score is coming, so "eleven two" is heard as "eleven
    /// to" far more often than not, "game one" comes back as "game won",
    /// and a zero is usually "oh". Without this table the feature fails on
    /// the most ordinary thing anyone will say to it.
    private static func value(of token: String) -> (n: Int, softTwo: Bool)? {
        if let n = Int(token) { return (n, false) }
        switch token {
        case "zero", "oh", "o", "nil", "love", "nought", "naught", "none":
            return (0, false)
        case "one", "won", "ones": return (1, false)
        case "two": return (2, false)
        case "to", "too": return (2, true)
        case "three": return (3, false)
        case "four", "for", "fore": return (4, false)
        case "five": return (5, false)
        case "six", "sicks": return (6, false)
        case "seven": return (7, false)
        case "eight", "ate": return (8, false)
        case "nine": return (9, false)
        case "ten": return (10, false)
        case "eleven", "leven", "elevin": return (11, false)
        case "twelve": return (12, false)
        case "thirteen": return (13, false)
        case "fourteen": return (14, false)
        case "fifteen": return (15, false)
        case "sixteen": return (16, false)
        case "seventeen": return (17, false)
        case "eighteen": return (18, false)
        case "nineteen": return (19, false)
        case "twenty": return (20, false)
        case "thirty": return (30, false)
        default: return nil
        }
    }
}
