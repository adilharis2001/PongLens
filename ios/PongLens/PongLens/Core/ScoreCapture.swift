import Foundation

/// The decision half of spoken scores: what gets written to the board,
/// when a ?? row appears, and what a correction does. No audio, no speech
/// machinery, no timers — just state and rules, which is what makes it
/// testable the way ScoreLogic and GameScore are.
///
/// The listener drives it with a simple shape: a WINDOW opens when someone
/// walks up to the phone (the loudness gate), text arrives while they
/// speak, and the window SETTLES when they stop. Everything here is scoped
/// to that window, which is the design that killed a whole class of bugs:
/// the old version parsed one endless stream, so a phrase said ten minutes
/// ago could still win an argument with the one being said now.
struct ScoreCapture {

    /// The board, lowest game first. A row with nil numbers is a game
    /// whose phrase was heard and whose numbers were not — drawn as ??,
    /// because an absent row reads as nothing having been said.
    private(set) var scores: [SpokenGameScore] = []
    /// The game to apologise about on screen, transiently.
    private(set) var missedGame: Int?
    /// What the recogniser produced for windows that captured nothing,
    /// newest last. In memory only, shown behind a long-press, gone when
    /// the screen closes. This is the instrument that turns "it didn't
    /// hear me" into a fixable sentence — without it every mishearing is
    /// a guess.
    private(set) var heardLog: [String] = []

    /// Games the user corrected by hand. A tap outranks the stream: the
    /// same stale text must not re-apply itself over a manual swap. The
    /// locks lift when a new window opens, because a fresh approach to
    /// the phone is fresh intent.
    private var swapLocked: Set<Int> = []
    /// Games written during the current window, so a final that parses
    /// WORSE than its own volatiles (it happens) cannot file a miss for
    /// a game this same breath already captured.
    private var windowCaptured: Set<Int> = []
    /// The newest text of the current window, for a settle that arrives
    /// with nothing better.
    private var windowText = ""

    enum Event { case captured, missed }

    // MARK: - Lifecycle

    /// A new recording. Everything goes, including the board: the scores
    /// belong to the match that just ended, and they were handed to its
    /// details sheet at the moment it stopped. This not being called was
    /// the stale-scoreboard bug.
    mutating func beginSession() {
        scores = []
        missedGame = nil
        heardLog = []
        swapLocked = []
        windowCaptured = []
        windowText = ""
    }

    /// Someone stepped up to the phone.
    mutating func windowOpened() {
        swapLocked = []
        windowCaptured = []
        windowText = ""
    }

    /// Text formed while they speak. Captures eagerly — feedback should
    /// land while the speaker is still at the phone — but never files a
    /// miss, because halfway through a sentence the numbers genuinely
    /// have not been said yet.
    mutating func heard(_ text: String) -> Event? {
        windowText = text
        guard case .captured(let score) = SpokenScore.read(text) else { return nil }
        return apply(score)
    }

    /// The utterance is over: the recogniser's final text, or nil to fall
    /// back on the newest volatile. This is the one moment a ?? row can
    /// be written, which is what guarantees "game four score <mush>"
    /// leaves a mark instead of silence.
    mutating func settled(_ text: String?) -> Event? {
        let final = (text?.isEmpty == false ? text : nil) ?? windowText
        windowText = ""
        let trimmed = final.trimmingCharacters(in: .whitespacesAndNewlines)

        switch SpokenScore.read(final) {
        case .ignored:
            if !trimmed.isEmpty { log(trimmed) }
            return nil
        case .captured(let score):
            let event = apply(score)
            // A capture blocked by a manual lock still gets logged: the
            // user will want to know why saying it did nothing.
            if event == nil, !windowCaptured.contains(score.game) { log(trimmed) }
            return event
        case .missed(let game):
            // This window already got this game from a volatile; the
            // final just rendered it worse. Keep the capture.
            if windowCaptured.contains(game) { return nil }
            log(trimmed)
            // Never downgrade a known score to ??. A row is added only
            // when the game has nothing at all, and the transient
            // message covers the rest.
            if !scores.contains(where: { $0.game == game }) {
                scores.append(SpokenGameScore(game: game, you: nil, them: nil))
                scores.sort { $0.game < $1.game }
            }
            missedGame = game
            return .missed
        }
    }

    // MARK: - Corrections

    /// Tapping a row swaps its numbers — the likeliest mistake is the
    /// pair arriving the wrong way round — and locks the game against
    /// the stream until the next approach.
    mutating func swap(game: Int) {
        guard let index = scores.firstIndex(where: { $0.game == game }),
              let you = scores[index].you, let them = scores[index].them
        else { return }
        scores[index] = SpokenGameScore(game: game, you: them, them: you)
        swapLocked.insert(game)
    }

    mutating func clearMiss() {
        missedGame = nil
    }

    // MARK: - Rules

    private mutating func apply(_ score: SpokenGameScore) -> Event? {
        guard score.known else { return nil }
        guard !swapLocked.contains(score.game) else { return nil }
        if let index = scores.firstIndex(where: { $0.game == score.game }) {
            // The same phrase arrives many times as it forms; only a
            // CHANGE is an event, which is what keeps the haptic from
            // firing once per word.
            guard scores[index] != score else { return nil }
            scores[index] = score
        } else {
            scores.append(score)
            scores.sort { $0.game < $1.game }
        }
        windowCaptured.insert(score.game)
        if missedGame == score.game { missedGame = nil }
        return .captured
    }

    private mutating func log(_ text: String) {
        heardLog.append(String(text.suffix(120)))
        if heardLog.count > 8 { heardLog.removeFirst() }
    }
}
