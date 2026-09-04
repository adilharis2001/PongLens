#if DEBUG
import Foundation

/// Deterministic simulator-only routes used to film the two native tutorial
/// inserts. The whole file is excluded from Release so capture behavior cannot
/// become a second product path.
enum TutorialCaptureScenario: String, Equatable {
    case playerRecord = "player-record"
    case coachAudioLesson = "coach-audio-lesson"

    enum Phase: Equatable {
        case ready
        case settings
        case recording
        case paused
        case writingUp
        case review
        case handoff
    }

    static func parse(arguments: [String]) -> Self? {
        guard let flag = arguments.firstIndex(of: "--tutorial-capture"),
              arguments.indices.contains(flag + 1) else { return nil }
        return Self(rawValue: arguments[flag + 1])
    }

    static var current: Self? {
        parse(arguments: ProcessInfo.processInfo.arguments)
    }

    /// Phase boundaries are deliberately literal. Task 7 records against
    /// these values, and a fresh launch always produces the same sequence.
    private var timeline: [(start: TimeInterval, phase: Phase)] {
        switch self {
        case .playerRecord:
            [
                (0, .ready),
                (2.5, .settings),
                (5, .recording),
                (8, .paused),
                (10.5, .handoff),
            ]
        case .coachAudioLesson:
            [
                (0, .ready),
                (2.5, .recording),
                (5.5, .paused),
                (8.5, .writingUp),
                (11.5, .review),
            ]
        }
    }

    func phase(at elapsed: TimeInterval) -> Phase {
        timeline.last(where: { $0.start <= max(0, elapsed) })?.phase ?? .ready
    }

    var transitions: [(after: TimeInterval, phase: Phase)] {
        zip(timeline, timeline.dropFirst()).map { current, next in
            (next.start - current.start, next.phase)
        }
    }

    var readinessMarker: String {
        "PONGLENS_TUTORIAL_CAPTURE_READY \(rawValue)"
    }
}
#endif
