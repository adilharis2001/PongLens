import Foundation

/// How often a first-run account is shown camera advice without asking
/// for it.
///
/// Two things ride on this rule. The "Where to place the camera" sheet was
/// the first: it opened on its own, twice, at the three doors out of the
/// New match chooser. The recording brief (`RecordingBriefGate`, below)
/// replaced that automatic showing in September: five pages, once, with no
/// way out except through them. The sheet itself is still there behind
/// every "How to record" link, and a manual open never counts.
///
/// Twin of `src/lib/cameraGuideGate.ts`. Both are checked against the same
/// table of cases in `ios/Tests/fixtures/camera-guide-gate.json`, rather
/// than each being read against the same paragraph — which is exactly how
/// the placement mirror survived eight months wrong in two files at once.
///
/// Manual opens are deliberately NOT counted. The "How to record" trigger
/// stays on every screen it is on today and spends nothing, because the
/// two automatic showings are worth saving for the moment somebody is
/// standing at a table about to film.
enum CameraGuideGate {
    static let maxShowings = 2

    /// Lives beside first_steps_dismissed and tutorial_started.
    static let metadataKey = "camera_guide_seen"

    /// The device-local mirror, keyed by user id because one simulator and
    /// one browser both get shared between accounts.
    static func storageKey(userId: String) -> String {
        "pl-camera-guide-seen:\(userId)"
    }

    struct Decision: Equatable {
        /// Open the sheet now, unasked.
        let show: Bool
        /// Write this to both copies, or nil when nothing needs writing.
        let persist: Int?
    }

    static func coerce(_ value: Any?) -> Int? {
        guard let value, !(value is NSNull) else { return nil }
        if let n = value as? Int { return n >= 0 ? n : nil }
        if let d = value as? Double {
            guard d.isFinite, d >= 0 else { return nil }
            return Int(d.rounded(.down))
        }
        if let s = value as? String {
            let t = s.trimmingCharacters(in: .whitespaces)
            // ASCII digits only, to match the /^\d+$/ the web rule uses.
            guard !t.isEmpty, t.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
            return Int(t)
        }
        return nil
    }

    /// The count, read from both copies at once.
    ///
    /// The account copy (user_metadata) is what makes "twice" mean twice
    /// for the person rather than twice per device. The device copy is
    /// what holds the cap when the network does not: the likeliest place
    /// on earth to be opening the recorder is a sports hall with bad wifi,
    /// and if the write to Supabase fails there, an account-only counter
    /// never moves and the sheet comes back a third and a fourth time.
    ///
    /// nil — and only nil — means neither copy has ever been written,
    /// which is what separates a new account from one seeded to zero.
    static func readSeenCount(account: Any?, device: Any?) -> Int? {
        let a = coerce(account)
        let d = coerce(device)
        if a == nil, d == nil { return nil }
        return max(a ?? 0, d ?? 0)
    }

    /// - Parameters:
    ///   - seen: `readSeenCount`, nil when never recorded
    ///   - hasAnyMatch: does the account already have footage in it
    ///   - shownThisSession: has one already opened this launch
    ///   - max: how many automatic showings an account gets
    static func gate(seen: Int?, hasAnyMatch: Bool, shownThisSession: Bool, max: Int = maxShowings) -> Decision {
        var effective = seen
        var seed: Int?

        // Back-fill. Nobody has a counter on the day this ships, so
        // without this every existing account gets interrupted —
        // including accounts with forty matches that plainly know where
        // the camera goes.
        //
        // Keyed on ABSENT, never on zero. A genuinely new account that has
        // just recorded its first match sits at 1 and must still get its
        // second showing, so "already has footage" can only be asked once,
        // before the counter exists.
        if seen == nil, hasAnyMatch {
            effective = max
            seed = max
        }

        // At most one automatic showing per launch. Without it, tapping
        // Record and then Upload in the same five minutes spends the whole
        // budget two minutes apart and the second showing teaches nothing.
        if shownThisSession { return Decision(show: false, persist: seed) }

        let count = effective ?? 0
        if count < max {
            return Decision(show: true, persist: count + 1)
        }
        return Decision(show: false, persist: seed)
    }
}

// MARK: - The recording brief

/// The same rule with a budget of one and no per-launch clause.
///
/// Twin of the `recordingBrief*` half of `src/lib/cameraGuideGate.ts`, and
/// checked against the `brief` table in the same fixture.
enum RecordingBriefGate {
    /// Once. Five pages twice would be a chore, and stepping through them
    /// is what makes them land, so one walk is the whole budget.
    static let maxShowings = 1

    /// Beside `camera_guide_seen`. The old key is left exactly as it was.
    static let metadataKey = "recording_brief_seen"

    /// What both copies hold once the last page's button has been tapped.
    static let done = 1

    static func storageKey(userId: String) -> String {
        "pl-recording-brief-seen:\(userId)"
    }

    struct Decision: Equatable {
        /// Open the brief now, at page one.
        let show: Bool
        /// Write this to both copies right now, or nil. Only ever the
        /// back-fill: the brief counts itself as seen when it is FINISHED,
        /// not when it opens, so that quitting halfway brings it back from
        /// page one next time. That write is `done` and belongs to the
        /// caller's completion handler, never to this decision.
        let seed: Int?
    }

    static func gate(seen: Int?, hasAnyMatch: Bool) -> Decision {
        // No per-launch clause: with a budget of one there is nothing left
        // to space out, and an abandoned walk is meant to return.
        let d = CameraGuideGate.gate(
            seen: seen, hasAnyMatch: hasAnyMatch, shownThisSession: false, max: maxShowings
        )
        // When the answer is "show", persist is the completion value, which
        // is not written until the walk is finished. Only a no-show carries
        // a seed.
        return Decision(show: d.show, seed: d.show ? nil : d.persist)
    }
}

// MARK: - The lesson briefs

/// Audio lessons and lesson videos get the same one-time walk, with their
/// own pages and their own counter. Same rule, so the same helper: shown
/// once, never to somebody who has plainly done this before, and counted
/// only when the walk is FINISHED.
///
/// Twin of the `lessonBrief*` half of src/lib/cameraGuideGate.ts.
enum LessonBriefGate {
    /// Both lesson features have a player door and a coach door, and the
    /// two are taught different things: a player's recap saves itself
    /// privately, a coach's is sent to a student. So each door counts its
    /// own showing. One account can hold both roles, and being taught the
    /// coach's version must not rob it of the player's.
    ///
    /// `audioPlayer` and `videoCoach` keep the bare key names they shipped
    /// with, so nobody who has already finished one is shown it again.
    enum Kind {
        case audioPlayer
        case audioCoach
        case videoCoach
        case videoPlayer

        var metadataKey: String {
            switch self {
            case .audioPlayer: "lesson_audio_brief_seen"
            case .audioCoach: "lesson_audio_coach_brief_seen"
            case .videoCoach: "lesson_video_brief_seen"
            case .videoPlayer: "lesson_video_player_brief_seen"
            }
        }

        func storageKey(userId: String) -> String {
            switch self {
            case .audioPlayer: "pl-lesson-audio-brief-seen:\(userId)"
            case .audioCoach: "pl-lesson-audio-coach-brief-seen:\(userId)"
            case .videoCoach: "pl-lesson-video-brief-seen:\(userId)"
            case .videoPlayer: "pl-lesson-video-player-brief-seen:\(userId)"
            }
        }
    }

    static let done = RecordingBriefGate.done

    /// `hasDoneBefore` is this brief's version of hasAnyMatch: an account
    /// with a lesson entry already, or a coach with a lesson video already,
    /// does not need teaching and must not be interrupted.
    static func gate(seen: Int?, hasDoneBefore: Bool) -> RecordingBriefGate.Decision {
        RecordingBriefGate.gate(seen: seen, hasAnyMatch: hasDoneBefore)
    }
}
