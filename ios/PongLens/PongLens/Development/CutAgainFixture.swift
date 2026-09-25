#if DEBUG && targetEnvironment(simulator)
import SwiftUI
import UIKit

/// A network-free harness for "Cut again" and the marker's pad: the real
/// views, driven by fake data, so every state can be looked at on a
/// simulator without an account and without writing anything anywhere.
///
///     --dev-cut-again <scene>          tools | marker | watch (a hand-cut
///                                      match watched through: the tape)
///     --dev-ca-video <path on the Mac> the marker's picture (any mp4)
///     --dev-ca-marker <state>          fresh | choice | review | scoring | marking |
///                                      open | held | selected | adjusting
///     --dev-ca-options <variant>       normal | notes | coach | auto-replace |
///                                      processing | queued | no-source | support
///     --dev-ca-sheet                   tools: More options already open
///     --dev-ca-way <auto|mark>         tools: that way picked
///     --dev-ca-draft                   tools: an unsent draft of 7 marks
///     --dev-ca-recut                   marker: marking a processed match
///     --dev-ca-review                  marker: the review sheet up
///     --dev-ca-choice replace          Replace chosen
///     --dev-ca-confirm                 marker: "Clear all marks?" up
///     --dev-ca-practice                a practice session, not a match
///     --dev-ca-landscape               ask the scene for landscape
///
/// Nothing here has a match id the server knows: the draft store is never
/// loaded, so it cannot save, and every call the sheets make goes to a fake.
enum CutAgainFixture {
    static var scene: String? { argument("--dev-cut-again") }
    static var isEnabled: Bool { scene != nil }

    static func argument(_ name: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: name), args.indices.contains(i + 1) else { return nil }
        return args[i + 1]
    }

    static func flag(_ name: String) -> Bool {
        ProcessInfo.processInfo.arguments.contains(name)
    }

    static let ownerID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
    static let matchID = UUID(uuidString: "77777777-7777-4777-8777-777777777777")!

    static var videoURL: URL? {
        argument("--dev-ca-video").map { URL(fileURLWithPath: $0) }
    }

    @MainActor static func match(ready: Bool = true, type: String? = nil, cutSource: String = "automatic") -> MatchRow {
        let type = type ?? (flag("--dev-ca-practice") ? "practice" : "match")
        let object: [String: Any] = [
            "cut_source": cutSource,
            "id": matchID.uuidString, "user_id": ownerID.uuidString,
            "opponent_name": "Alex Chen", "venue": "Westchester", "match_type": type,
            "played_at": "2026-09-20T12:00:00Z", "status": ready ? "ready" : "uploaded",
            "duration_s": 600, "raw_path": "r2://ponglens-raw/\(ownerID.uuidString.lowercased())/qa.mp4",
            "user_side": "near", "first_server": "user", "clip_pads": ["pre": 1.2, "post": 1.3],
            "created_at": "2026-09-20T12:00:00Z", "points": [["count": 12]],
        ]
        return try! JSONDecoder().decode(
            MatchRow.self, from: JSONSerialization.data(withJSONObject: object)
        )
    }

    static var variant: String { argument("--dev-ca-options") ?? "normal" }

    static func options(_ variant: String) -> RecutOptions {
        switch variant {
        case "notes": RecutOptions(available: true, hasMatchNotes: true, cutSource: "automatic")
        case "coach": RecutOptions(available: true, replaceByHand: false, hasCoachReview: true, cutSource: "automatic")
        case "auto-replace": RecutOptions(available: true, replaceAutomatic: true, hasMatchNotes: true, cutSource: "automatic")
        case "processing", "queued": RecutOptions(available: false, reason: "processing")
        case "no-source": RecutOptions(available: false, reason: "no_source")
        case "support": RecutOptions(available: false, reason: "support_request")
        default: RecutOptions(available: true, cutSource: "automatic")
        }
    }

    static let jobID = UUID(uuidString: "88888888-8888-4888-8888-888888888888")!

    /// A hand cut replacing the match, halfway through cutting.
    static var runningFeedback: MatchProcessingFeedback {
        let object: [String: Any] = [
            "match_id": matchID.uuidString, "job_id": jobID.uuidString, "job_kind": "hand_cut",
            "job_status": "processing", "stage": "cut", "worker_state": "fresh", "lane": "hand",
        ]
        return try! JSONDecoder().decode(
            MatchProcessingFeedback.self, from: JSONSerialization.data(withJSONObject: object)
        )
    }

    /// A Replace waiting its turn: queued, no worker on it yet.
    static var queuedFeedback: MatchProcessingFeedback {
        let object: [String: Any] = [
            "match_id": matchID.uuidString, "job_id": jobID.uuidString, "job_kind": "hand_cut",
            "job_status": "queued", "worker_state": "missing", "lane": "hand",
        ]
        return try! JSONDecoder().decode(
            MatchProcessingFeedback.self, from: JSONSerialization.data(withJSONObject: object)
        )
    }

    /// Answers every call from memory. Nothing that would write succeeds.
    static func client(_ variant: String) -> CutAgainClient {
        CutAgainClient(
            options: { _ in options(variant) },
            feedback: { _ in
                variant == "processing" ? runningFeedback : variant == "queued" ? queuedFeedback : nil
            },
            job: { _ in
                variant == "queued"
                    ? MatchJob(id: jobID, status: "queued", progress: 0, userMessage: nil, kind: "hand_cut")
                    : MatchJob(id: jobID, status: "processing", progress: 46, userMessage: nil, kind: "hand_cut")
            },
            minutes: { 240 },
            startRecut: { _, _ in StartRecutReply(marks: nil, mode: "score", updatedAt: nil) },
            claimHandRecut: { _, _, _ in throw CutAgainServerError(message: "fixture_no_writes") },
            copyForRecut: { _ in throw CutAgainServerError(message: "fixture_no_writes") },
            process: { _, _ in .refused(nil) },
            claimAutoRecut: { _, _ in throw CutAgainServerError(message: "fixture_no_writes") }
        )
    }

    /// Report a problem, as an owner of a processed match with nothing sent.
    static var issueClient: MatchIssueClient {
        MatchIssueClient(
            load: { _ in
                let object: [String: Any] = [
                    "role": "owner", "matchStatus": "ready", "canPositive": true,
                    "canProblem": true, "canReprocess": true, "canRefund": false, "events": [],
                ]
                return try JSONDecoder().decode(
                    MatchIssueState.self, from: JSONSerialization.data(withJSONObject: object)
                )
            },
            submit: { _, _ in throw CutAgainServerError(message: "fixture_no_writes") },
            cancel: { _, _ in throw CutAgainServerError(message: "fixture_no_writes") }
        )
    }

    /// A hand-cut match's cut, on the fixture file's clock: two points whose
    /// windows merged, a let, a deleted point, then two more. Watched
    /// through, the tape plays 10.15-19.15, 21.45-29.35, 51.2-59.2 and
    /// 63.2-69.2, and nothing else.
    static var watchPoints: [MatchPoint] {
        func point(_ n: Int, _ cutT0: Double, _ t0: Double, _ t1: Double,
                   isLet: Bool = false, deleted: Bool = false) -> MatchPoint {
            MatchPoint(
                id: UUID(uuidString: String(format: "99999999-9999-4999-8999-%012d", n))!,
                matchId: matchID, idx: n, t0: t0, t1: t1, cutT0: cutT0,
                server: nil, serverOverride: nil, isLet: isLet,
                confirmedWinner: n % 2 == 0 ? .user : .opponent, confirmedHow: nil,
                starred: false, deleted: deleted, edited: false,
                tightStart: false, tightEnd: false,
                gameEndOverride: nil, gameWinnerOverride: nil,
                scoredAtCutS: nil, lossReasons: nil, direction: nil,
                misreadKind: nil, serveSpin: nil, serveSidespin: nil,
                serveLength: nil, placementFlagged: nil, clipPath: nil,
                placement: nil
            )
        }
        return [
            point(1, 8.95, 20, 29), point(2, 20.25, 30.1, 38),
            point(3, 31, 45, 50, isLet: true), point(4, 40, 60, 66, deleted: true),
            point(5, 50, 80, 88), point(6, 62, 100, 106),
        ]
    }

    /// Twelve rallies every 20 seconds from 0:30. `throughEnd` stretches
    /// them to the end of the ten-minute file, so the draft reads as
    /// finished (the review gate) rather than partial (the choice gate).
    static func marks(called: Bool, throughEnd: Bool = false, count: Int = 12) -> [HandCutMark] {
        let step = throughEnd ? 47.0 : 20.0
        return (0..<count).map { i in
            let t0 = 30 + Double(i) * step
            return HandCutMark(
                id: "q\(i + 1)", t0: t0, t1: t0 + 9,
                winner: called ? (i % 3 == 0 ? .opponent : .user) : nil,
                isLet: false, starred: i == 2, tap: t0 + 0.6, rate: 1
            )
        }
    }
}

/// The scenes. Each is the production view with fake data behind it.
struct CutAgainFixtureView: View {
    @State private var app = AppState()
    @State private var model = MatchDetailModel()
    @State private var request: MarkerRequest?
    @State private var cutAgain = CutAgainModel(
        matchId: CutAgainFixture.matchID, client: CutAgainFixture.client(CutAgainFixture.variant)
    )
    @State private var handCut = HandCutDraftStore()
    @State private var ready = false

    struct MarkerRequest: Identifiable {
        let id = UUID()
        let url: URL
        /// Nil: the watch player on a hand-cut match.
        let marker: HandCutMarker?
    }

    var body: some View {
        ZStack {
            ArenaBackground()
            if CutAgainFixture.scene == "tools" {
                toolsScene
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Cut again QA").font(.plPageTitle).foregroundStyle(PL.textBody)
                    Text(CutAgainFixture.scene ?? "").font(.plCaption).foregroundStyle(PL.text500)
                    if CutAgainFixture.videoURL == nil {
                        Text("Pass --dev-ca-video <mp4>").foregroundStyle(PL.dangerText)
                    }
                    Spacer()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            }
        }
        .environment(app)
        .task {
            if CutAgainFixture.flag("--dev-ca-landscape") {
                try? await Task.sleep(for: .milliseconds(400))
                UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first?
                    .requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight))
            }
            guard let url = CutAgainFixture.videoURL else { return }
            if CutAgainFixture.scene == "watch" {
                model.points = CutAgainFixture.watchPoints
                model.videoURL = url
                model.loaded = true
                try? await Task.sleep(for: .milliseconds(300))
                request = MarkerRequest(url: url, marker: nil)
                return
            }
            guard CutAgainFixture.scene == "marker" else { return }
            try? await Task.sleep(for: .milliseconds(300))
            request = MarkerRequest(url: url, marker: makeMarker())
        }
        .fullScreenCover(item: $request) { request in
            if let marker = request.marker {
                PlayerTakeover(
                    match: CutAgainFixture.match(),
                    model: model,
                    pad: ClipPad(pre: 1.2, post: 1.3),
                    videoURL: request.url,
                    startAt: nil,
                    mode: .mark,
                    source: .original,
                    marker: marker
                )
                .environment(app)
            } else {
                // The fixture's file stands in for the cut: its burnt-in
                // clock shows every join.
                PlayerTakeover(
                    match: CutAgainFixture.match(cutSource: "manual"),
                    model: model,
                    pad: ClipPad(pre: 1.2, post: 1.3),
                    videoURL: request.url,
                    startAt: nil,
                    mode: .watch,
                    source: .cut
                )
                .environment(app)
            }
        }
    }

    /// The Tools card's More options row, and its sheet when asked for.
    @ViewBuilder
    private var toolsScene: some View {
        if ready {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeading("Tools")
                        VStack(spacing: 0) {
                            MoreOptionsToolRow(
                                match: CutAgainFixture.match(),
                                hooks: MoreOptionsHooks(
                                    cutAgain: cutAgain,
                                    handCut: handCut,
                                    cutScored: true,
                                    prepareMarking: { _ in "Fixture: the marker opens from the marker scene." },
                                    afterDismiss: {},
                                    openMatch: { _ in }
                                ),
                                issueClient: CutAgainFixture.issueClient,
                                open: CutAgainFixture.flag("--dev-ca-sheet")
                            )
                            Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1).padding(.leading, 16)
                            FeedbackBoardToolRow(match: CutAgainFixture.match())
                        }
                        .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                                .strokeBorder(PL.edge, lineWidth: 1)
                        )
                        if cutAgain.jobRunning {
                            // What the match page shows above Tools while a
                            // Replace runs (MatchDetailScreen.recutProgress).
                            MatchProcessingCard(
                                notice: cutAgain.serviceNotice,
                                stageLabel: cutAgain.runningLabel,
                                warning: nil,
                                progress: cutAgain.job?.progress,
                                sendsReadyEmail: true,
                                estimate: cutAgain.feedback?.estimate,
                                jobStatus: cutAgain.feedback?.jobStatus ?? cutAgain.job?.status,
                                serviceState: cutAgain.serviceState
                            )
                        }
                    }
                    .padding(20)
                }
                .background(ArenaBackground())
                .toolbar(.hidden, for: .navigationBar)
            }
        } else {
            ProgressView().tint(PL.cyan)
                .task {
                    handCut.previewDraft(
                        CutAgainFixture.flag("--dev-ca-draft")
                            ? Array(CutAgainFixture.marks(called: true).prefix(7)) : [],
                        mode: .score
                    )
                    switch CutAgainFixture.argument("--dev-ca-way") {
                    case "auto": cutAgain.way.choose(.automatic)
                    case "mark": cutAgain.way.choose(.byHand)
                    default: break
                    }
                    if CutAgainFixture.argument("--dev-ca-choice") == "replace" {
                        var choice = RecutChoiceState.automatic(CutAgainFixture.options(CutAgainFixture.variant))
                        choice.select(.replace)
                        cutAgain.autoChoice = choice
                    }
                    await cutAgain.load()
                    // A sheet raised before the turn keeps the old
                    // orientation: turn first, then build the page.
                    if CutAgainFixture.flag("--dev-ca-landscape") {
                        try? await Task.sleep(for: .milliseconds(1500))
                    }
                    ready = true
                }
        }
    }

    /// The marker in the state `--dev-ca-marker` names.
    private func makeMarker() -> HandCutMarker {
        let state = CutAgainFixture.argument("--dev-ca-marker") ?? "choice"
        let store = HandCutDraftStore()
        switch state {
        case "fresh": store.previewDraft([], mode: nil)
        case "review": store.previewDraft(CutAgainFixture.marks(called: true, throughEnd: true), mode: .score)
        case "choice": store.previewDraft(CutAgainFixture.marks(called: true), mode: .score)
        case "scoring":
            // Scored part way: the last five points have no winner yet.
            var marks = CutAgainFixture.marks(called: true)
            for i in 7..<marks.count { marks[i].winner = nil }
            store.previewDraft(marks, mode: .score)
        default: store.previewDraft(CutAgainFixture.marks(called: true), mode: .score)
        }
        let recut = CutAgainFixture.flag("--dev-ca-recut")
        var choice = RecutChoiceState.byHand(CutAgainFixture.options(CutAgainFixture.variant))
        if CutAgainFixture.argument("--dev-ca-choice") == "replace" { choice.select(.replace) }
        let hc = HandCutMarker(
            match: CutAgainFixture.match(),
            store: store,
            submitMarks: { _ in "Fixture: nothing is sent." },
            saveFirstServer: { _ in true },
            recut: recut ? choice : nil,
            submitRecut: recut ? { _, _ in .message("Fixture: nothing is sent.") } : nil
        )
        let marks = hc.state.marks
        switch state {
        case "marking":
            hc.started = true
            hc.state = HandCut.selectMark(hc.state, id: nil)
        case "open":
            // A rally begun and not yet ended: the pair reads Back to last
            // point and End Point.
            hc.started = true
            var s = HandCut.selectMark(hc.state, id: nil)
            let from = (marks.last?.t1 ?? 0) + 6
            s.marks.append(HandCutMark(id: "q-open", t0: from, t1: nil, winner: nil,
                                       isLet: false, starred: false, tap: from + 0.6, rate: 1))
            hc.state = s
        case "held":
            hc.started = true
            var s = hc.state
            if let last = s.marks.indices.last {
                s.marks[last].winner = nil
                s.awaitingId = s.marks[last].id
            }
            s.selectedId = nil
            hc.state = s
            hc.pausedForAnswer = true
        case "selected":
            hc.started = true
            hc.state = HandCut.selectMark(hc.state, id: marks.count > 3 ? marks[3].id : marks.first?.id)
        case "adjusting":
            hc.started = true
            if marks.count > 3 {
                let m = marks[3]
                hc.state = HandCut.selectMark(hc.state, id: m.id)
                hc.adjusting = m.id
                hc.adjustDraft = HandCutSpan(t0: m.t0, t1: m.t1 ?? m.t0 + 9)
                hc.adjustBounds = HandCutSpan(t0: marks[2].t1 ?? m.t0 - 5, t1: marks[4].t0)
            }
        default:
            break
        }
        if CutAgainFixture.flag("--dev-ca-review") { hc.reviewing = true }
        if CutAgainFixture.flag("--dev-ca-confirm") { hc.confirmingStartAgain = true }
        return hc
    }
}
#endif
