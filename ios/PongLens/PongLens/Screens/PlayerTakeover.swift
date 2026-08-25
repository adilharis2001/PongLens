import AVFoundation
import SwiftUI
import Supabase

enum PlayerMode {
    case watch, score
}

enum ScorePhase {
    case play, summary, review
}

/// A clip playing out after an early answer, and where it ends.
/// The transport bar's measured height, read by the score bug above it.
private struct TransportHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

struct PlayTail: Equatable {
    let id: UUID
    let end: Double
}

/// A game that closed in the last few seconds of a live answer. Holds the
/// pad's boundary control on "Didn't end" for a beat, aimed at the point
/// that closed it — the correction you are most likely to want, right when
/// you would want it, without a card across the footage.
struct FreshBoundary: Equatable {
    let pointId: UUID
    let game: Int
    let you: Int
    let them: Int
}

/// "Who won this game?" — asked after pinning an end at a score the
/// 11-clear-by-2 rule cannot decide.
struct WinnerAsk: Identifiable, Equatable {
    let pointId: UUID
    let you: Int
    let them: Int
    var id: UUID { pointId }
}

/// A game divider tapped in the chip strip.
struct GameBreak: Identifiable, Equatable {
    let pointId: UUID
    let game: Int
    let you: Int
    let them: Int
    var id: UUID { pointId }
}

/// "That clip might be two points", offered on the clip just answered.
/// `atCut` is where a split would land; `certain` only with gap evidence.
struct SplitNudge: Equatable {
    let pointId: UUID
    let atCut: Double
    let certain: Bool
}

/// The full-screen takeover: watch mode with the web's gestures, and Keep
/// score — ticker, chip strip, winner buttons, auto-pause at each rally's
/// end with the web's tuned rules (PAUSE_BEAT 1.2, re-arm 1.5, play guard
/// 500 ms, tail watch 3.5).
struct PlayerTakeover: View {
    let match: MatchRow
    let model: MatchDetailModel
    let pad: ClipPad
    let videoURL: URL
    var startAt: Double?
    var mode: PlayerMode = .watch
    /// The pad's Analysis panel needs the owner's own reason pills.
    var reasonsStore: CustomReasonsStore?
    /// Quick notes from the player write through the match's own store.
    var notesStore: NotesStore?
    /// The Analysis panel carries the tag picker, the same as the web's.
    var tagsStore: TagsStore?
    /// Who served first was just answered and written. MatchRow is a value,
    /// so the host holds a copy that still says nobody knows — and reopens
    /// the pad asking the same question. This is how it finds out.
    var onFirstServer: ((Winner) -> Void)?
    /// Details: leave the pad and open this point's sheet (0-based index).
    var onOpenPoint: ((Int) -> Void)?
    /// Switch this match into Keep score at the given cut second. The host
    /// owns it: score mode is a different entry with its own resume, setup
    /// sheet and pad, so it reopens rather than mutating this one.
    var onKeepScore: ((Double) -> Void)?
    /// Coach workspace hook: when set, the watch overlay offers adding the
    /// point on screen to a pattern. Players never see it.
    var onTagPoint: ((MatchPoint) -> Void)?
    /// Highlights mode (2026-08-25): play ONLY these rallies, in order,
    /// jumping the footage between them. The viewing chrome stays — play,
    /// the scrubber, zoom, rotate, the prev/next flanks — and the working
    /// chrome (gestures help, speed, grid, star, notes, score bug) stands
    /// down; a Share pill takes the top-left corner. nil = normal player.
    var highlightPicks: [MatchPoint]? = nil
    /// The Share pill's tap; the host presents the share sheet.
    var onShareHighlight: (() -> Void)?

    @Environment(\.dismiss) var dismiss
    @Environment(AppState.self) var app
    @State var player = AVPlayer()
    @State var currentT: Double = 0
    @State var lastTick: Double?
    @State var duration: Double = 0
    @State var isPlaying = false
    @State var chromeVisible = true
    /// How tall the transport actually is, so the score bug can sit on top
    /// of it rather than a number someone typed. Seeded near the real value
    /// so the very first frame is not visibly wrong.
    @State var transportHeight: CGFloat = 96
    /// Bumped on every reveal so a stale auto-hide timer cannot fire.
    @State var chromeNonce = 0
    @State var scrubbing = false
    @State var scrubT: Double = 0
    @State var flash: String?
    @State var observer: Any?

    /// The network fell behind. Named on screen, because without it a
    /// choppy connection reads as the app freezing — the picture stops and
    /// nothing says why.
    @State var stalled = false
    @State var stallWatchT: Double = -1
    #if DEBUG
    @State var devHUD = ProcessInfo.processInfo.arguments.contains("--dev-hud")
    #endif

    // Keep score state
    @State var phase: ScorePhase = .play
    @State var endPausedId: UUID?
    @State var endPauseBlockedId: UUID?
    /// Media time where the current CONTINUOUS playback run began — the
    /// first tick after a play or a seek. A rally's boundary only stops the
    /// video when the run started before that rally's deciding shot, and
    /// the previous rally stays the tap target only for a run that was
    /// actually watching it. Nil between runs.
    @State var runStartT: Double?
    @State var lastPlayAt = Date.distantPast
    @State var undoStack: [ScoreUndo] = []
    @State var setupOpen = false
    @State var reviewQueue: [UUID] = []
    @State var reviewIndex = 0
    /// The one line of teaching on screen, and whether the score hint has
    /// had its turn this session.
    @State var hint: GestureHint?
    @State var firstHintShown = false
    /// What the file has actually downloaded, for the scrubber's shading.
    @State var loaded: [TimeSpan] = []
    @State var rate: Float = 1
    @State var analysisPoint: MatchPoint?
    /// The point most recently given an outcome, and when. Analysis opened
    /// within the window is about THAT point, not whatever the playhead has
    /// moved on to — scoring advances and plays, so a note written a few
    /// seconds after a tap used to land on the following rally.
    @State var lastScored: (id: UUID, at: Date)?
    @State var modifyPoint: MatchPoint?
    @State var modifyInitialCut: Double?
    @State var pointsGridOpen = false

    /// A clip whose tail is playing out after an early answer, and where
    /// that tail ends. Cleared when it plays out (we advance then) or as
    /// soon as the playhead leaves the clip by any other route.
    @State var playTail: PlayTail?

    // Game boundary. Three separate transients, because the pad's one
    // button has to answer whichever of them is freshest — see
    // boundaryControl in ScoreLogic.swift for the ordering.
    /// A game that closed within the last few seconds of a live answer.
    @State var freshBoundary: FreshBoundary?
    /// A point answered while a 'continue' held its game open past the auto
    /// condition. Lights the button rather than floating a pill.
    @State var endedNudgePointId: UUID?
    /// An end the user asked for needs no "did it though?" retarget.
    @State var explicitEndPointId: UUID?
    @State var lastScoreTapAt = Date.distantPast
    @State var prevGamesCount = -1
    @State var winnerAsk: WinnerAsk?
    @State var gameBreak: GameBreak?

    // The Why fast lane: score them and say why, in one tap.
    @State var whyPoint: MatchPoint?
    @State var whyCustomOpen = false
    @State var whyCustom = ""
    /// Set when a score-and-say-why tap holds the advance back: closing the
    /// panel resumes it, so explaining a point costs the explanation and
    /// nothing else.
    @State var advanceAfterSheet: UUID?

    // Offers. Neither ever blocks an answer.
    @State var splitNudge: SplitNudge?
    @State var startHereDismissed = false

    // Setup sheet: names as well as the first server.
    @State var namesAsked = false
    @State var draftYou = ""
    @State var draftThem = ""

    @State var chipPill: UUID?
    @State var removedArmed: UUID?
    @State var toast: String?
    @State var gesturesOpen = false
    /// Deferred while the setup sheet is up: being told where you are is
    /// noise on top of a question you have not answered yet.
    @State var pendingResumeToast: String?

    // Zoom: survives point skips on purpose — a player studying one corner
    // of the table wants the same corner across rallies.
    @State var zoomScale: CGFloat = 1
    @State var zoomAnchor: CGFloat = 1
    @State var panOffset: CGSize = .zero
    @State var panAnchor: CGSize = .zero
    /// Hold a side of the picture for temporary speed: right 2x, left 0.25x.
    @State var holdRate: Float?
    /// True while the rotate button holds the scene in landscape. The
    /// preference sticks to the SCENE, not this view, so closing the
    /// player must hand it back or the whole app stays sideways.
    @State var forcedLandscape = false
    // Quick actions: a note or a drawing without leaving the player.
    @State var noteComposerOpen = false
    /// The rally the share sheet is answering, captured at tap time. Held
    /// as the point rather than a flag so a seek behind the open sheet
    /// cannot move it to a different rally.
    @State var sharePoint: MatchPoint?
    @State var annotateFrame: UIImage?
    @State var pendingImage: (path: String, preview: UIImage)?

    var points: [MatchPoint] { highlightPicks ?? model.visible }
    var isHighlights: Bool { highlightPicks != nil }

    /// The picks' spans on the cut timeline. Everything outside them is
    /// dead footage in highlights mode, the same shape as deadSpans.
    var highlightSpans: [TimeSpan]? {
        guard let picks = highlightPicks else { return nil }
        return picks.compactMap { p in
            guard let c = p.cutT0, let t0 = p.t0, let t1 = p.t1
            else { return nil }
            let eff = effectivePad(pad, tightStart: p.tightStart,
                                   tightEnd: p.tightEnd)
            return TimeSpan(start: max(0, c),
                            end: c + (t1 - t0) + eff.pre + eff.post)
        }
    }

    /// The single answer for "which rally is on screen": the auto-pause pin
    /// first, then the hold-aware resolver.
    var displayTarget: MatchPoint? { target(at: currentT) }

    /// The same answer at an arbitrary clock reading. Taps go through this
    /// with the player's live time rather than the last tick, which can be
    /// a fifth of a second stale — long enough, on tight cuts, to answer a
    /// rally the screen was never about.
    func target(at t: Double) -> MatchPoint? {
        if let endPausedId, let pinned = points.first(where: { $0.id == endPausedId }) {
            return pinned
        }
        if phase == .review, reviewQueue.indices.contains(reviewIndex),
           let reviewing = points.first(where: { $0.id == reviewQueue[reviewIndex] }) {
            return reviewing
        }
        return targetAt(
            points, at: t, pad: pad,
            hold: mode == .score && phase == .play,
            runStart: runStartT, firedId: endPauseBlockedId
        )
    }

    /// The player's own clock when it has one, the last tick otherwise.
    var liveT: Double {
        guard player.currentItem?.status == .readyToPlay else { return currentT }
        let t = player.currentTime().seconds
        return t.isFinite ? t : currentT
    }

    /// THE point a winner, skip, delete or star tap answers. Resolved at tap
    /// time off the live clock, so it is right while paused, right straight
    /// after a seek, and right when no tick has landed yet.
    var tapTarget: MatchPoint? { target(at: liveT) }

    /// The points the flanks walk, and where we are among them.
    ///
    /// A chevron on a side with nothing on it is a button that does
    /// nothing, so it is absent rather than dead — the same rule the web
    /// player follows.
    var cutPoints: [MatchPoint] { points.filter { $0.cutT0 != nil } }

    var playingCutIndex: Int {
        guard let id = playingPointId(points, at: currentT) else { return -1 }
        return cutPoints.firstIndex { $0.id == id } ?? -1
    }

    var hasPrevPoint: Bool { playingCutIndex > 0 }

    var hasNextPoint: Bool {
        !cutPoints.isEmpty && playingCutIndex < cutPoints.count - 1
    }

    /// The answer to "who served first", live: starts from the match row
    /// and updates the moment the sheet is answered, so the rotation shows
    /// up without waiting on the database round trip.
    @State var firstServer: Winner?

    /// Footage extents, recomputed off the model rather than cached: the
    /// list is short and a stale span is a playhead that jumps somewhere
    /// the user can see is wrong.
    var deadSpans: [TimeSpan] {
        deletedSpans(all: model.points, visible: points, pad: pad)
    }

    var firstPointStart: Double? {
        points.first(where: { $0.cutT0 != nil })?.cutT0
    }

    /// The full-match walk. The pad's ticker uses the truncated one
    /// (runningScore); anything asking "does a game end at this point"
    /// has to ask the whole timeline, because a later override can move
    /// where an earlier game closes.
    var fullScore: MatchScore {
        computeMatchScore(points.map(pointRow))
    }

    func pointRow(_ p: MatchPoint) -> PointRow {
        PointRow(
            id: p.id, matchId: p.matchId, idx: p.idx, t0: p.t0,
            confirmedWinner: p.confirmedWinner, isLet: p.isLet,
            deleted: p.deleted, gameEndOverride: p.gameEndOverride,
            gameWinnerOverride: p.gameWinnerOverride
        )
    }

    /// The pad's one boundary button, assembled from the transients above.
    var boundaryOffer: BoundaryControl? {
        guard mode == .score, phase == .play else { return nil }
        let full = fullScore
        let idx = displayTarget.flatMap { points.firstIndex(of: $0) } ?? -1
        return boundaryControl(BoundaryInputs(
            freshlyClosedPointId: freshBoundary?.pointId,
            displayTargetId: displayTarget?.id,
            displayTargetOverride: displayTarget?.gameEndOverride,
            boundaryAfter: Set(full.boundaryAfter.keys),
            endedNudgePointId: endedNudgePointId,
            heldOpenEndTargetId: heldOpenEndTarget(
                points: points, upToIndex: idx,
                walkOpen: runningScore.open,
                boundaryAfter: Set(full.boundaryAfter.keys)
            )
        ))
    }

    /// How many points sit before the rally on screen while the WHOLE match
    /// is still untouched — recorded warm-up is the top reason a match's
    /// head is junk. The first real answer retires the offer for good.
    var startHereCount: Int {
        guard mode == .score, phase == .play, !startHereDismissed,
              app.userId == match.userId,
              !points.contains(where: { $0.confirmedWinner != nil || $0.isLet || $0.starred })
        else { return 0 }
        guard let target = displayTarget, let i = points.firstIndex(of: target) else { return 0 }
        return i
    }

    var serving: [UUID: ServeInfo] {
        computeServing(points, firstServer: firstServer)
    }

    var runningScore: MatchScore {
        let upTo: [MatchPoint]
        if let target = displayTarget, let i = points.firstIndex(of: target) {
            upTo = Array(points.prefix(i + 1))
        } else {
            upTo = points
        }
        return computeMatchScore(upTo.map {
            PointRow(
                id: $0.id, matchId: $0.matchId, idx: $0.idx, t0: $0.t0,
                confirmedWinner: $0.confirmedWinner, isLet: $0.isLet,
                deleted: $0.deleted, gameEndOverride: $0.gameEndOverride,
                gameWinnerOverride: $0.gameWinnerOverride
            )
        })
    }

    var body: some View {
        GeometryReader { geo in
            let landscape = geo.size.width > geo.size.height
            Group {
                if mode == .score, phase == .play, landscape {
                    landscapeScoreLayout(geo)
                        // Sideways there is no pad surface to cover, so the
                        // panel takes the screen and splits its two halves
                        // across the width rather than stacking them.
                        .overlay { analysisLayer(landscape: true) }
                } else {
                    VStack(spacing: 0) {
                        videoArea(geo)
                        if mode == .score, phase == .play {
                            scorePad
                                .overlay { analysisLayer(landscape: false) }
                        }
                    }
                }
            }
            .frame(maxHeight: .infinity, alignment: .top)
            .background(Color.black.ignoresSafeArea())
            // The Why overlay sits above the pad and below the summary: the
            // rally being explained has to stay on screen, and the pad
            // underneath has no job until the answer moves us on.
            .overlay { whyOverlay }
            .overlay(alignment: .bottom) {
                if let toast {
                    Text(toast)
                        .font(.plCaption)
                        .foregroundStyle(PL.text300)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 7)
                        .background(PL.ink.opacity(0.85), in: Capsule())
                        .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                        .padding(.bottom, 96)
                        .transition(.opacity)
                }
            }
            .overlay {
                if phase == .summary { summaryOverlay }
            }
        }
        .statusBarHidden()
        .task { await start() }
        // A split or an Adjust leaves clips regenerating. The poll takes the
        // spinners back down without anyone reopening the match.
        .onChange(of: model.hasPendingClips) { _, pending in
            if pending { model.startClipPoll(match.id) }
        }
        .onChange(of: isPlaying) { _, playing in
            if playing {
                if chromeVisible { scheduleChromeHide() }
            } else {
                // Stopped for any reason — a tap, the auto-pause, the end of
                // the file, a sheet. A stopped video with no visible
                // transport is the state that reads as broken.
                showChrome(autoHide: false)
            }
        }
        // A game closing is an announcement, not an event to acknowledge.
        .onChange(of: runningScore.games.count) { _, _ in watchGameBoundary() }
        .onDisappear {
            if let observer { player.removeTimeObserver(observer) }
            player.pause()
            releaseForcedLandscape()
        }
        .sheet(item: $winnerAsk) { ask in
            winnerAskSheet(ask)
                .presentationDetents([.height(280)])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $gameBreak) { brk in
            gameBreakSheet(brk)
                .presentationDetents([.height(gameBreakSheetHeight(brk))])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $gesturesOpen) {
            gesturesSheet
                .presentationDetents([.medium, .large])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $setupOpen) {
            setupSheet
                .presentationDetents([.height(setupSheetHeight)])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .fullScreenCover(item: $modifyPoint) { point in
            ModifySheet(
                match: match, model: model, point: point, pad: pad,
                initialCut: modifyInitialCut,
                onFinished: { modifyFinished($0) }
            )
            .onDisappear { modifyInitialCut = nil }
        }
        .sheet(isPresented: $pointsGridOpen) {
            pointsGrid
                .presentationDetents([.medium])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $noteComposerOpen) {
            quickNoteSheet
                .presentationDetents([.height(240), .medium])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $sharePoint) { point in
            SharePointSheet(match: match, point: point, pad: pad, points: points)
                .presentationDetents([.height(SharePointSheet.detentHeight)])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .fullScreenCover(isPresented: Binding(
            get: { annotateFrame != nil },
            set: { if !$0 { annotateFrame = nil } }
        )) {
            if let frame = annotateFrame {
                AnnotatorView(
                    frame: frame,
                    onCancel: { annotateFrame = nil },
                    onSave: { jpeg in
                        do {
                            let path = try await NoteMedia.uploadImage(jpeg)
                            pendingImage = (path, UIImage(data: jpeg) ?? frame)
                            annotateFrame = nil
                            noteComposerOpen = true
                            return true
                        } catch {
                            return false
                        }
                    }
                )
            }
        }
    }

    /// A note without leaving the player: the point on screen is the
    /// subject, and a drawing made a moment ago rides along.
    @ViewBuilder
    var quickNoteSheet: some View {
        if let notesStore, let uid = app.userId {
            VStack(alignment: .leading, spacing: 12) {
                Text(displayNumber.map { "Note on point \($0)" } ?? "Match note")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(PL.textBody)
                if let pendingImage {
                    HStack(spacing: 10) {
                        Image(uiImage: pendingImage.preview)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 84, height: 48)
                            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        Text("Drawing attached")
                            .font(.plCaption)
                            .foregroundStyle(PL.text400)
                        Spacer()
                        Button("Remove") { self.pendingImage = nil }
                            .font(.plCaption)
                            .foregroundStyle(PL.text400)
                            .buttonStyle(.plain)
                    }
                }
                NoteComposerView(
                    matchId: match.id,
                    pointId: displayTarget?.id,
                    userId: uid,
                    notesStore: notesStore,
                    placeholder: "What do you see here?",
                    pendingImagePath: pendingImage?.path,
                    onSent: {
                        pendingImage = nil
                        noteComposerOpen = false
                    }
                )
                Spacer()
            }
            .padding(18)
        }
    }

    // MARK: - Video area

    @ViewBuilder
    /// - Parameter inBands: the landscape scorer, where every control has a
    ///   solid bar or rail of its own. Nothing belongs over the picture
    ///   there, so the corner buttons and the transport are drawn by the
    ///   layout instead and this returns the footage and its gestures.
    /// - Parameter boxSize: the size of the box the picture is being drawn
    ///   in, when that is not the whole screen. The zoom clamp and the
    ///   double-tap thirds both measure against the picture, not the device.
    func videoArea(
        _ geo: GeometryProxy, inBands: Bool = false, boxSize: CGSize? = nil
    ) -> some View {
        let landscape = geo.size.width > geo.size.height
        // Portrait keep-score pins a snug 16:9 band above the pad; the
        // landscape edge layout goes full-bleed like watch mode.
        let scoreLayout = mode == .score && phase == .play && !landscape
        let box = boxSize ?? geo.size
        let content = ZStack {
            Color.black
            PlayerLayerView(player: player)
                .scaleEffect(zoomScale)
                .offset(panOffset)
                .clipped()

            // Two gesture halves: single tap plays, double tap skips a
            // point, press and hold runs that side's temporary speed.
            HStack(spacing: 0) {
                gestureHalf(isRight: false, pictureWidth: box.width)
                gestureHalf(isRight: true, pictureWidth: box.width)
            }

            if let flash {
                PLToast(message: flash)
            }

            #if DEBUG
            // Launch with --dev-hud to read the playhead off a screenshot.
            // The simulator does not capture AVPlayerLayer pixels, so this
            // is the only way an automated pass can see what the video is
            // actually doing.
            if devHUD {
                VStack {
                    Spacer()
                    Text(String(
                        format: "t=%.2f dur=%.1f rate=%.2f pin=%@ stall=%@",
                        currentT, duration, player.rate,
                        endPausedId == nil ? "-" : "P", stalled ? "Y" : "N"
                    ))
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.yellow)
                    .padding(4)
                    .background(Color.black)
                }
            }
            #endif

            if let holdRate {
                VStack {
                    Text(holdRate > 1 ? "2x ▶▶" : "0.25x ◀▶")
                        .font(.system(size: 13, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 5)
                        .background(PL.ink.opacity(0.85), in: Capsule())
                        .padding(.top, 54)
                    Spacer()
                }
            }

            if !inBands {
            VStack {
                // The two corners, and nothing else. Every control lives in
                // the bar at the bottom: buttons parked over the picture are
                // buttons over the one thing the screen is for, and the top
                // of a phone is the hardest place on it to reach.
                //
                // They leave with the transport. Nothing needs to sit over
                // the footage permanently — a tap anywhere brings the whole
                // lot back, and the same tap plays or pauses.
                HStack(alignment: .top, spacing: 8) {
                    if isHighlights {
                        Button("Share") {
                            player.pause()
                            onShareHighlight?()
                        }
                        .buttonStyle(PLSecondaryButtonStyle())
                    } else {
                        overlayButton("questionmark", label: "Gestures") {
                            player.pause()
                            gesturesOpen = true
                        }
                    }
                    Spacer()
                    if stalled {
                        // Named, so a choppy connection reads as the
                        // connection's problem. Without it the video simply
                        // stops and the app looks hung.
                        HStack(spacing: 5) {
                            ProgressView().controlSize(.mini).tint(PL.text300)
                            Text("Buffering")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(PL.text300)
                        }
                        .padding(.horizontal, 9)
                        .padding(.vertical, 6)
                        .background(PL.ink.opacity(0.7), in: Capsule())
                    }
                    Spacer()
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(PL.text300)
                            .padding(9)
                            .background(PL.ink.opacity(0.7), in: Circle())
                    }
                    .buttonStyle(.plain)
                }
                .opacity(chromeVisible ? 1 : 0)
                .allowsHitTesting(chromeVisible)
                .animation(.easeOut(duration: 0.2), value: chromeVisible)
                Spacer()
                // The score is information, not a control, so it stays when
                // the controls go — the same rule the exported reel follows.
                // It lifts to clear the transport while that is up.
                if mode == .watch, !isHighlights {
                    // Measured, not guessed. This was a flat 44, which
                    // cleared the bar it was written against and stopped
                    // clearing it the moment the buttons grew — the score
                    // landed on top of the scrubber. The bar reports its
                    // own height, so the lift stays right whatever the row
                    // ends up containing.
                    scoreBug.padding(.bottom, chromeVisible ? transportHeight + 8 : 0)
                }
            }
            // Corner chrome is a MARGIN, not a safe-area sum. This
            // GeometryReader is ALREADY inside the safe area, and it still
            // reports the insets it was moved by: measured on a 402x874
            // phone it hands back h=778 (874 minus a 62pt top and a 34pt
            // bottom) alongside top=62, bot=34. Padding by those applied
            // the notch twice and left ? and X 124pt down the picture,
            // nowhere near the corner they belong in. A flat margin is
            // also the only version that cannot drift by device: whatever
            // the insets are, the container has already spent them.
            .padding(.top, 10)
            .padding(.bottom, scoreLayout ? 8 : 10)
            .padding(.horizontal, 10)
            }

            if chromeVisible {
                VStack(spacing: 0) {
                    Spacer()
                    if inBands {
                        landscapeVideoTransport(size: box)
                    } else {
                        watchTransport(landscape: landscape, size: geo.size)
                    }
                }
                .transition(.opacity)
            }

            // Walking the points happens on the footage's flanks, in watch
            // mode and score mode alike, portrait and landscape (web pad
            // parity). The eyes are on the video, so navigation lives
            // beside it: nothing over the middle of the picture, and the
            // reach is natural in either grip.
            //
            // Down in the transport they were two 22pt icons in a row of
            // eleven, which is a hard thing to hit and the wrong place to
            // look for the most-used control on the screen. Moving them out
            // also gives the bottom bar back the width it needed.
            //
            // They are the ONLY prev/next now, in both modes, so they never
            // hide with the chrome. Landscape score is the exception: its
            // edge layout owns these exact spots with its own bands.
            if scoreLayout || mode == .watch {
                HStack {
                    if hasPrevPoint {
                        flankChevron("chevron.left", "Previous point") { step(-1) }
                    }
                    Spacer()
                    if hasNextPoint {
                        flankChevron("chevron.right", "Next point") { step(1) }
                    }
                }
                // Off the screen's edge, not the layout's. Landscape puts
                // the sensor housing down one side, and a flat 10 would
                // park a chevron underneath it. Portrait has no side
                // insets, so this is the same 10 it always was.
                .padding(.horizontal, max(
                    max(geo.safeAreaInsets.leading, geo.safeAreaInsets.trailing), 10
                ))
                .transition(.opacity)
            }

            // One line of teaching, at most twice per device and never
            // again once the gesture has been used for real. Nothing is
            // gated here: a hint is only SET at the moment it makes sense,
            // and clears itself either on a timer or the first real use.
            if let hint {
                VStack {
                    Spacer()
                    PLToast(message: GestureHints.message(
                        hint, hasPoints: !cutPoints.isEmpty
                    ))
                        .padding(.bottom, mode == .score ? 12 : 84)
                }
                .transition(.opacity)
            }
        }
        // Score layout pins the picture to a snug 16:9 band; watch mode
        // fills the SCREEN and lets the layer letterbox inside it. The
        // fill-the-container shortcut here is what once blew the watch
        // player up past the screen edges, chrome and all.
        let sized = scoreLayout
            ? AnyView(content.aspectRatio(16 / 9, contentMode: .fit))
            : AnyView(content.frame(maxWidth: .infinity, maxHeight: .infinity))
        sized
            .clipped()
            // Keep the last real measurement: the bar leaves the tree with
            // the chrome, and a zero would drop the score onto the bottom
            // edge for the frame before it comes back.
            .onPreferenceChange(TransportHeightKey.self) { height in
                if height > 0 { transportHeight = height }
            }
            .simultaneousGesture(zoomGesture(box))
            .simultaneousGesture(panGesture(box))
    }

    // MARK: - Zoom and hold-speed

    func zoomGesture(_ size: CGSize) -> some Gesture {
        MagnificationGesture()
            .onChanged { value in
                zoomScale = min(4, max(1, zoomAnchor * value))
                clampPan(size)
            }
            .onEnded { _ in
                zoomAnchor = zoomScale
                if zoomScale < 1.06 { resetZoom() }
            }
    }

    func panGesture(_ size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 14)
            .onChanged { value in
                guard zoomScale > 1 else { return }
                panOffset = CGSize(
                    width: panAnchor.width + value.translation.width,
                    height: panAnchor.height + value.translation.height
                )
                clampPan(size)
            }
            .onEnded { _ in panAnchor = panOffset }
    }

    /// Keep the scaled picture covering the frame — no dead margins.
    func clampPan(_ size: CGSize) {
        let maxX = size.width * (zoomScale - 1) / 2
        let maxY = size.height * (zoomScale - 1) / 2
        panOffset = CGSize(
            width: min(maxX, max(-maxX, panOffset.width)),
            height: min(maxY, max(-maxY, panOffset.height))
        )
    }

    func resetZoom() {
        withAnimation(.easeOut(duration: 0.15)) {
            zoomScale = 1
            zoomAnchor = 1
            panOffset = .zero
            panAnchor = .zero
        }
    }

    /// Button zoom, anchored at the frame center — ×1.5 steps like the web.
    func zoomBy(_ factor: CGFloat, size: CGSize) {
        let next = min(4, max(1, zoomScale * factor))
        if next <= 1.001 {
            resetZoom()
            return
        }
        withAnimation(.easeOut(duration: 0.15)) {
            zoomScale = next
            zoomAnchor = next
            clampPan(size)
            panAnchor = panOffset
        }
    }

    /// The surface stays two halves, because press-and-hold reads its side
    /// from WHICH half it is and a middle third could not answer that. The
    /// double tap needs thirds, so it takes the tap's location and adds
    /// this half's offset to get back to a position in the whole picture.
    /// One surface, two different splits, neither guessing.
    func gestureHalf(isRight: Bool, pictureWidth: CGFloat) -> some View {
        Color.clear
            .contentShape(Rectangle())
            .onTapGesture(count: 2) { location in
                retireHint(.doubleTap)
                // No points to walk (an unprocessed match): the halves
                // seek ±10s, the web cut player's double tap. The thirds
                // only exist where there are rallies for them to step.
                guard !cutPoints.isEmpty else {
                    var target = max(0, currentT + (isRight ? 10 : -10))
                    if duration > 0 { target = min(target, duration - 0.1) }
                    seek(to: target)
                    showFlash(isRight ? "+10s" : "-10s")
                    return
                }
                let x = (isRight ? pictureWidth / 2 : 0) + location.x
                switch TapZone.of(x: x, width: pictureWidth) {
                case .prev: step(-1)
                case .next: step(1)
                case .replay: replayTarget()
                }
            }
            .onTapGesture { togglePlay() }
            .onLongPressGesture(minimumDuration: 0.25, maximumDistance: 40) {
                beginHold(fast: isRight)
            } onPressingChanged: { pressing in
                if !pressing { endHold() }
            }
            // On the video surface only, never the chrome — a swipe that
            // rode the whole screen would fire after every scrubber drag.
            .gesture(swipeSeek)
    }

    /// A clean horizontal flick hops five seconds, either direction, in
    /// watch and keep score alike. Zoomed, the same motion pans instead.
    var swipeSeek: some Gesture {
        DragGesture(minimumDistance: 24)
            .onEnded { value in
                guard zoomScale <= 1.001 else { return }
                let dx = value.translation.width
                let dy = value.translation.height
                guard abs(dx) > 56, abs(dx) > abs(dy) * 1.4 else { return }
                var target = max(0, currentT + (dx > 0 ? 5 : -5))
                if duration > 0 { target = min(target, duration - 0.1) }
                seek(to: target)
                showFlash(dx > 0 ? "+5s" : "-5s")
            }
    }

    func beginHold(fast: Bool) {
        guard player.rate > 0 else { return }
        retireHint(.hold)
        holdRate = fast ? 2.0 : 0.25
        player.rate = holdRate!
    }

    func endHold() {
        guard holdRate != nil else { return }
        holdRate = nil
        if player.rate > 0 { player.rate = rate }
    }

    /// Prev/next on the footage's flanks. Sized exactly to their circles so
    /// they never eat taps meant for the play/pause surface.
    func flankChevron(
        _ icon: String, _ label: String, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(PL.text100)
                .frame(width: 32, height: 32)
                .background(PL.ink.opacity(0.55), in: Circle())
                // The circle is what reads as big over the picture, so
                // only the circle shrinks: a 44pt hit area still wraps it.
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    func overlayButton(
        _ icon: String, label: String, tint: Color = PL.text200,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(tint)
                .padding(9)
                .background(PL.ink.opacity(0.7), in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    /// Grab the paused moment for the annotator, exactly the point sheet's
    /// flow: draw, save, and the picture rides the next note.
    func captureFrame() {
        guard let asset = player.currentItem?.asset else { return }
        player.pause()
        let time = player.currentTime()
        let generator = AVAssetImageGenerator(asset: asset)
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        generator.appliesPreferredTrackTransform = true
        generator.generateCGImageAsynchronously(for: time) { cgImage, _, _ in
            Task { @MainActor in
                if let cgImage {
                    annotateFrame = UIImage(cgImage: cgImage)
                }
            }
        }
    }

    var displayNumber: Int? {
        guard let target = displayTarget, let i = points.firstIndex(of: target) else { return nil }
        return i + 1
    }

    /// Score entering the rally on screen — never counting it. Watching a
    /// point while the scoreboard already counts it gives the ending away.
    var bugScore: MatchScore {
        let upTo: [MatchPoint]
        if let target = displayTarget, let i = points.firstIndex(of: target) {
            upTo = Array(points.prefix(i))
        } else {
            upTo = points
        }
        return computeMatchScore(upTo.map {
            PointRow(
                id: $0.id, matchId: $0.matchId, idx: $0.idx, t0: $0.t0,
                confirmedWinner: $0.confirmedWinner, isLet: $0.isLet,
                deleted: $0.deleted, gameEndOverride: $0.gameEndOverride,
                gameWinnerOverride: $0.gameWinnerOverride
            )
        })
    }

    /// The broadcast score bug, bottom-left over the picture — the same
    /// table the exported reel burns in: a row per player with their accent
    /// bar, one muted column per completed game, the live game tinted.
    @ViewBuilder
    var scoreBug: some View {
        let score = bugScore
        if !points.isEmpty, displayTarget != nil {
            VStack(alignment: .leading, spacing: 1) {
                scoreBugRow(
                    name: "You", tint: PL.cyan,
                    games: score.games.map(\.you), current: score.current.you
                )
                scoreBugRow(
                    name: match.opponentName ?? "Them", tint: PL.magentaSoft,
                    games: score.games.map(\.them), current: score.current.them
                )
            }
            .padding(4)
            .background(PL.ink.opacity(0.78), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
    }

    func scoreBugRow(
        name: String, tint: Color, games: [Int], current: Int
    ) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 1)
                .fill(tint)
                .frame(width: 3, height: 9)
            Text(name)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(PL.text100)
                .lineLimit(1)
                .frame(minWidth: 44, alignment: .leading)
            ForEach(Array(games.enumerated()), id: \.offset) { _, points in
                Text("\(points)")
                    .font(.system(size: 11, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(PL.text400)
                    .frame(minWidth: 16)
            }
            Text("\(current)")
                .font(.system(size: 11, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(PL.text100)
                .frame(minWidth: 20)
                .padding(.vertical, 2)
                .background(tint.opacity(0.2), in: RoundedRectangle(cornerRadius: 3, style: .continuous))
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
    }

    /// The transport. Score mode gets ONE row — play, the clock, the
    /// scrubber, zoom and rotate — because the pad two inches below already
    /// carries Replay, Speed and a chip strip that is a better points grid
    /// than the grid is. Duplicating them here cost a third of the picture
    /// on a phone, and the picture is the whole point of the screen.
    ///
    /// Watch mode has no pad, so its extras ride a second row underneath
    /// rather than sitting over the footage in the top corners.
    /// Play, the clock, the scrubber, zoom and the rotate flip — the row
    /// every layout needs, wherever it ends up sitting.
    func scrubRow(landscape: Bool, size: CGSize) -> some View {
        HStack(spacing: 9) {
            Button {
                togglePlay()
            } label: {
                Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 17))
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 30)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isPlaying ? "Pause" : "Play")

            Text(timeString(scrubbing ? scrubT : currentT))
                .font(.plMicro).monospacedDigit().foregroundStyle(PL.text300)
            scrubBar
            // An unknown duration is a loading state, not a zero-length
            // video. Printing 0:00 beside a thumb pinned to the right
            // told the owner the clip had ended before it had started.
            Text(duration > 0 ? timeString(duration) : "–:––")
                .font(.plMicro).monospacedDigit().foregroundStyle(PL.text500)

            transportIcon("minus.magnifyingglass", "Zoom out", dim: zoomScale <= 1.001) {
                zoomBy(1 / 1.5, size: size)
            }
            transportIcon("plus.magnifyingglass", "Zoom in", dim: zoomScale >= 3.999) {
                zoomBy(1.5, size: size)
            }
            transportIcon(
                landscape ? "rectangle.portrait.arrowtriangle.2.outward"
                          : "rectangle.landscape.rotate",
                landscape ? "Back to portrait" : "Turn to landscape"
            ) {
                rotate(toLandscape: !landscape)
            }
        }
    }

    func watchTransport(landscape: Bool, size: CGSize) -> some View {
        VStack(spacing: 6) {
            scrubRow(landscape: landscape, size: size)
            if mode == .watch, !isHighlights {
                ViewThatFits(in: .horizontal) {
                    watchControls(spacing: 10, landscape: landscape, size: size)
                    watchControls(spacing: 7, landscape: landscape, size: size)
                    watchControls(spacing: 4, landscape: landscape, size: size)
                    watchControls(spacing: 2, landscape: landscape, size: size)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, transportBottomInset)
        .background(
            GeometryReader { bar in
                Color.clear.preference(
                    key: TransportHeightKey.self, value: bar.size.height
                )
            }
        )
        .background(
            // The web's gradient: the bar is part of the frame's bottom
            // edge, not an object resting on top of it. A rounded card
            // floating clear of the picture is the "widget" look.
            LinearGradient(
                colors: [.clear, PL.ink.opacity(0.55), PL.ink.opacity(0.88)],
                startPoint: .top, endPoint: .bottom
            )
        )
    }

    /// Full-bleed, the bar sits on the video's bottom edge — which is the
    /// screen's bottom edge in watch mode and landscape, where it has to
    /// clear the home indicator, and a band edge in portrait score, where
    /// there is nothing to clear.
    var transportBottomInset: CGFloat {
        mode == .score && phase == .play ? 8 : 24
    }

    /// A hairline track with a small dot, the web's scrubber. UIKit's stock
    /// Slider draws a 28pt capsule thumb — next to a 2pt track that reads as
    /// a pill someone dropped on the bar, and it covers a good chunk of the
    /// timeline it is supposed to be pointing at.
    var scrubBar: some View {
        GeometryReader { bar in
            let w = bar.size.width
            let t = scrubbing ? scrubT : min(currentT, seekMax)
            let pct = duration > 0 ? min(1, max(0, t / seekMax)) : 0
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.15))
                    .frame(height: 3)
                // What has downloaded. Without it a stalled scrub looks
                // like a broken one — there is no way to tell "the frames
                // are not here yet" from "the app stopped responding".
                ForEach(Array(loaded.enumerated()), id: \.offset) { _, span in
                    Capsule().fill(Color.white.opacity(0.2))
                        .frame(
                            width: max(0, w * min(1, (span.end - span.start) / seekMax)),
                            height: 3
                        )
                        .offset(x: w * min(1, max(0, span.start / seekMax)))
                }
                Capsule().fill(PL.cyan)
                    .frame(width: max(0, w * pct), height: 3)
                Circle()
                    .fill(PL.cyan)
                    .frame(width: 11, height: 11)
                    .shadow(color: PL.cyan.opacity(0.7), radius: 4)
                    .offset(x: max(0, w * pct - 5.5))
                    .opacity(duration > 0 ? 1 : 0)
            }
            .frame(height: 20)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { g in
                        guard duration > 0, w > 0 else { return }
                        scrubbing = true
                        scrubT = min(seekMax, max(0, g.location.x / w * seekMax))
                    }
                    .onEnded { _ in
                        guard duration > 0 else { return }
                        seek(to: scrubT)
                        scrubbing = false
                    }
            )
        }
        .frame(height: 20)
    }

    /// The scrubber's upper bound. Never zero: a Slider with an empty range
    /// clamps its value to the top and parks the thumb at the far right.
    var seekMax: Double { max(duration, 0.1) }

    /// A transport button.
    ///
    /// The frame is the tap target, and it used to be 22x24 — around a
    /// quarter of the area Apple asks for, in a row of eleven, on a screen
    /// people use one-handed. The icon grew with it rather than the icon
    /// growing alone, because a big glyph in a small box is the same miss.
    /// `contentShape` makes the whole box live: without it the gaps between
    /// the strokes of the glyph are not the button.
    func transportIcon(
        _ icon: String, _ label: String, dim: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundStyle(dim ? PL.text600 : PL.text200)
                .frame(width: 30, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(dim)
        .accessibilityLabel(label)
    }

    /// Watch mode's second row: everything that used to float in the top
    /// corners, plus the point navigation the score pad handles in the
    /// other mode. Still width-adaptive — "0.25x" is 20pt wider than "1x",
    /// so a row tuned at one speed runs off another phone's edge. The last
    /// candidate has to be the one that always fits, because ViewThatFits
    /// renders it whether it does or not.
    func watchControls(spacing: CGFloat, landscape: Bool, size: CGSize) -> some View {
        HStack(spacing: spacing) {
            // No prev/next here any more: they live on the video's flanks,
            // where they are bigger, always in the same place, and beside
            // the thing being navigated.
            // A match with no points has no point to replay and no grid
            // to jump around: both controls stand down rather than sit
            // there permanently dimmed or opening an empty sheet.
            if !cutPoints.isEmpty {
                transportIcon(
                    "gobackward", "Replay this point", dim: displayTarget?.cutT0 == nil
                ) {
                    replayTarget()
                }
            }
            Menu {
                // Slowest nearest the thumb, the web menu's ordering.
                ForEach([2.0, 1.5, 1.0, 0.5, 0.25, 0.1], id: \.self) { speed in
                    Button {
                        rate = Float(speed)
                        if player.rate > 0 { player.rate = rate }
                    } label: {
                        if rate == Float(speed) {
                            Label(speedLabel(speed), systemImage: "checkmark")
                        } else {
                            Text(speedLabel(speed))
                        }
                    }
                }
            } label: {
                Text(speedLabel(Double(rate)))
                    .font(.system(size: 13, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(PL.text200)
                    .fixedSize()
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(PL.surface2.opacity(0.8), in: Capsule())
            }
            // Without the plain style the menu repaints its label and the
            // text vanishes into the capsule.
            .buttonStyle(.plain)
            .tint(PL.text200)
            .accessibilityLabel("Playback speed")

            if !cutPoints.isEmpty {
                transportIcon("square.grid.3x3", "Jump to a point") { pointsGridOpen = true }
            }

            Spacer(minLength: 2)

            // Starring is the owner's write — the column grant would
            // silently refuse a coach anyway.
            if !points.isEmpty, app.userId == match.userId {
                Button {
                    guard let target = tapTarget else { return }
                    Task { await model.toggleStar(target) }
                } label: {
                    Image(systemName: displayTarget?.starred == true ? "star.fill" : "star")
                        .font(.system(size: 16))
                        .foregroundStyle(displayTarget?.starred == true ? PL.warning : PL.text200)
                        .frame(width: 30, height: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Star this point")

                // Beside the star on purpose: starring a rally and wanting
                // to show someone are the same moment, and until now the
                // second one meant leaving the player and finding the
                // point on the page behind it.
                //
                // tapTarget, not displayTarget: which rally this answers is
                // resolved off the live clock at the instant of the tap, so
                // it is right while paused and right straight after a seek.
                Button {
                    guard let target = tapTarget else { return }
                    player.pause()
                    sharePoint = target
                } label: {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 16))
                        .foregroundStyle(PL.text200)
                        .frame(width: 30, height: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Share this point")
            }
            if notesStore != nil {
                transportIcon("square.and.pencil", "Add a note") {
                    player.pause()
                    noteComposerOpen = true
                }
                transportIcon("scribble.variable", "Draw on this frame") {
                    captureFrame()
                }
            }
            if let onTagPoint {
                transportIcon("square.grid.2x2", "Add to a pattern") {
                    player.pause()
                    if let target = displayTarget { onTagPoint(target) }
                }
            }
            // Watching a match and deciding to score it is the same
            // thought, so it should not mean closing the player and
            // finding the row on the page behind it.
            if let onKeepScore, app.userId == match.userId, !points.isEmpty {
                Button {
                    let at = currentT
                    player.pause()
                    dismiss()
                    onKeepScore(at)
                } label: {
                    Text("Score Keeper")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(PL.cyan)
                        .lineLimit(1)
                        .fixedSize()
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(PL.ink.opacity(0.7), in: Capsule())
                        .overlay(Capsule().strokeBorder(PL.cyan.opacity(0.5), lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// The YouTube move: one button flips the takeover between portrait
    /// and landscape without touching the phone's rotation lock.
    func rotate(toLandscape: Bool) {
        forcedLandscape = toLandscape
        requestOrientation(toLandscape ? .landscapeRight : .portrait)
    }

    /// Every exit runs through here via onDisappear. If the button put
    /// the scene in landscape and the phone is not physically on its
    /// side, give the scene back to portrait; a phone genuinely held
    /// sideways keeps what it has.
    func releaseForcedLandscape() {
        guard forcedLandscape else { return }
        forcedLandscape = false
        guard !UIDevice.current.orientation.isLandscape else { return }
        requestOrientation(.portrait)
    }

    func requestOrientation(_ orientations: UIInterfaceOrientationMask) {
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).first else { return }
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: orientations))
    }

    func speedLabel(_ speed: Double) -> String {
        speed == 1 ? "1x"
            : speed == floor(speed) ? String(format: "%.0fx", speed)
            : String(format: "%gx", speed)
    }

    /// Jump to any point: the ticker's numbered rings, as a grid.
    var pointsGrid: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Jump to a point")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(PL.textBody)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 44), spacing: 8)], spacing: 8) {
                    ForEach(Array(points.enumerated()), id: \.element.id) { i, p in
                        if p.cutT0 != nil {
                            Button {
                                pointsGridOpen = false
                                if let cutT0 = p.cutT0 {
                                    endPausedId = nil
                                    seek(to: cutT0)
                                    play()
                                }
                            } label: {
                                ZStack {
                                    Circle().fill(chipTint(p).opacity(
                                        p.confirmedWinner == nil && !p.isLet ? 0.04 : 0.16
                                    ))
                                    if p.confirmedWinner == nil && !p.isLet {
                                        Circle().strokeBorder(
                                            PL.text600,
                                            style: StrokeStyle(lineWidth: 1.5, dash: [3, 3])
                                        )
                                    } else {
                                        Circle().strokeBorder(chipTint(p).opacity(0.85), lineWidth: 2)
                                    }
                                    Text("\(i + 1)")
                                        .font(.system(size: 13, weight: .semibold))
                                        .monospacedDigit()
                                        .foregroundStyle(
                                            p.confirmedWinner == nil && !p.isLet
                                                ? PL.text400 : chipTint(p)
                                        )
                                }
                                .frame(width: 44, height: 44)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(20)
        }
    }

    // MARK: - Score pad

    var scorePad: some View {
        let target = displayTarget
        let score = runningScore
        let serveInfo = target.flatMap { serving[$0.id] }
        return VStack(spacing: 10) {
            // Score row: serve balls at the edges, the big pair centered.
            ZStack {
                HStack {
                    serveBall(active: serveInfo?.server == .user)
                    Spacer()
                    serveBall(active: serveInfo?.server == .opponent, them: true)
                }
                VStack(spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        (Text("\(score.current.you)").foregroundColor(PL.cyan)
                            + Text(" - ").foregroundColor(PL.text600)
                            + Text("\(score.current.them)").foregroundColor(PL.magentaSoft))
                            .font(.system(size: 32, weight: .bold))
                            .monospacedDigit()
                        gamesPill(score)
                    }
                    Text(serveLine(serveInfo))
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                }
            }
            .padding(.horizontal, 8)
            .padding(.top, 2)

            chipStrip(targetId: target?.id)

            startHereOffer
            splitNudgeOffer

            // Controls: the web pad's full row.
            HStack(spacing: 6) {
                padControl("Undo", icon: "arrow.uturn.backward", disabled: undoStack.isEmpty) { undo() }
                padControl("Replay", icon: "gobackward") { replayTarget() }
                padSpeedMenu()
                padControl("Star", icon: target?.starred == true ? "star.fill" : "star") {
                    if let target {
                        pushUndo(target)
                        Task { await model.toggleStar(target) }
                    }
                }
                boundaryPadControl()
                padControl(
                    "Analysis", icon: "doc.text",
                    disabled: target == nil || reasonsStore == nil,
                    lit: target?.confirmedHow != nil || !(target?.lossReasons ?? []).isEmpty
                ) {
                    openAnalysis()
                }
                padControl("Details", icon: "arrow.up.forward.square", disabled: target == nil || onOpenPoint == nil) {
                    guard let target, let i = points.firstIndex(of: target) else { return }
                    dismiss()
                    onOpenPoint?(i)
                }
            }

            // Disposition
            HStack(spacing: 8) {
                dispositionButton("Skip", sub: "let", tint: PL.warning, enabled: target != nil) { tapSkip() }
                dispositionButton("Delete", sub: "dead space", tint: PL.dangerText, enabled: target != nil) { tapDelete() }
                dispositionButton("Modify", sub: "split · join · adjust", tint: PL.cyan, enabled: target != nil) {
                    if let target {
                        player.pause()
                        modifyPoint = target
                    }
                }
                reviewNextButton
            }

            // Winner buttons
            HStack(spacing: 10) {
                winnerButton("Me", tint: PL.cyan, selected: target?.confirmedWinner == .user, enabled: target != nil) {
                    tapWinner(.user)
                }
                winnerButton(
                    match.opponentName ?? "Them", tint: PL.magentaSoft,
                    selected: target?.confirmedWinner == .opponent,
                    enabled: target != nil
                ) {
                    tapWinner(.opponent)
                }
                .overlay(alignment: .topTrailing) { whyBubble(target, size: 44) }
            }
            .frame(maxHeight: .infinity)

            serveStartControls()
        }
        .padding(14)
        .frame(maxHeight: .infinity)
        .background(PL.surface.ignoresSafeArea())
    }

    // MARK: - Landscape keep score

    /// Landscape keep score: three solid bands, two solid rails, and the
    /// picture in the middle with NOTHING on top of it.
    ///
    /// It used to be a full-bleed video with every control floating over it
    /// in translucent panels — the score, the ball strip, two big tinted
    /// tiles down the left, three down the right and a row of buttons along
    /// the bottom. Each piece was readable on its own and the whole thing
    /// was a mess: a grey wash over the one thing the screen exists to
    /// show, with cyan and magenta blocks sitting in the middle of the
    /// table. The picture is smaller here, and that is the trade — a
    /// smaller picture you can actually see beats a bigger one behind
    /// furniture.
    ///
    /// Sideways the thumbs rest at the left and right edges, which is
    /// exactly where the rails put the two answers and the three
    /// dispositions. The bands take the width they need and the video takes
    /// what is left, at its own aspect ratio, so the rails end up as wide as
    /// the letterbox bars used to be.
    func landscapeScoreLayout(_ geo: GeometryProxy) -> some View {
        // Twelve, not the safe-area inset.
        //
        // This layout is handed a frame that is ALREADY inside the safe
        // area — measured on an 874pt screen, it gets a 750pt box and is
        // STILL told the insets are 62 either side. Honouring them again
        // spent 124pt of width that had already been spent, and since the
        // rails have a floor, all of it came off the picture.
        let side: CGFloat = 12
        return VStack(spacing: 0) {
            landscapeTopBar(side: side)
            GeometryReader { mid in
                let avail = max(0, mid.size.width - side * 2)
                // The rails never go below a thumb's width; past that the
                // picture takes everything its aspect ratio can use.
                let boxW = max(0, min(avail - railMin * 2, mid.size.height * 16 / 9))
                let boxH = boxW * 9 / 16
                let rail = max(railMin, (avail - boxW) / 2)
                HStack(spacing: 0) {
                    landscapeAnswerRail(height: boxH).frame(width: rail)
                    videoArea(
                        geo, inBands: true,
                        boxSize: CGSize(width: boxW, height: boxH)
                    )
                    .frame(width: boxW, height: boxH)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(alignment: .top) {
                        // Both offers are transient and both are ABOUT the
                        // rally on screen, so they belong on it — and they
                        // leave the moment they are answered.
                        VStack(spacing: 6) {
                            startHereOffer
                            splitNudgeOffer
                        }
                        .padding(8)
                    }
                    landscapeDispositionRail(height: boxH).frame(width: rail)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.horizontal, side)
            }
            landscapeBottomBar(
                side: side,
                // Enough to clear the home indicator, not the whole inset:
                // every point here comes off the picture.
                // Four, not the inset: the frame this layout gets already
                // stops above the home indicator, and the bar's background
                // is what reaches down past it.
                bottom: 4
            )
        }
        .background(Color.black.ignoresSafeArea())
    }

    /// A rail is at least this wide: two words of a button label, and a
    /// comfortable thumb.
    var railMin: CGFloat { 96 }


    /// Score, serve, the ball strip and the two corner buttons, on a solid
    /// bar. Everything here was floating over the top of the footage.
    func landscapeTopBar(side: CGFloat) -> some View {
        let target = displayTarget
        let score = runningScore
        let serveInfo = target.flatMap { serving[$0.id] }
        return HStack(spacing: 10) {
            overlayButton("questionmark", label: "Gestures") {
                player.pause()
                gesturesOpen = true
            }
            serveBall(active: serveInfo?.server == .user)
            (Text("\(score.current.you)").foregroundColor(PL.cyan)
                + Text(" - ").foregroundColor(PL.text600)
                + Text("\(score.current.them)").foregroundColor(PL.magentaSoft))
                .font(.system(size: 20, weight: .bold))
                .monospacedDigit()
                .fixedSize()
            gamesPill(score)
            Text(serveLine(serveInfo))
                .font(.plCaption)
                .foregroundStyle(PL.text400)
                .lineLimit(1)
                .fixedSize()
            serveBall(active: serveInfo?.server == .opponent, them: true)
            chipStrip(targetId: target?.id)
                .frame(maxWidth: .infinity)
            if stalled {
                ProgressView().controlSize(.mini).tint(PL.text300)
            }
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PL.text300)
                    .padding(9)
                    .background(PL.surface2, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
        }
        .padding(.horizontal, side)
        .frame(height: 42)
        // The bar itself reaches the glass; only its contents stop at the
        // safe area. A lighter strip floating inside two black gutters
        // reads as a mistake.
        .background(PL.surface.ignoresSafeArea(edges: .horizontal))
        .overlay(alignment: .bottom) {
            Rectangle().fill(PL.edge).frame(height: 1)
        }
    }

    /// Who won it. Two tiles, splitting the picture's height between them.
    func landscapeAnswerRail(height: CGFloat) -> some View {
        let target = displayTarget
        return VStack(spacing: 8) {
            winnerButton(
                "Me", tint: PL.cyan, selected: target?.confirmedWinner == .user,
                enabled: target != nil, solid: true
            ) {
                tapWinner(.user)
            }
            winnerButton(
                match.opponentName ?? "Them", tint: PL.magentaSoft,
                selected: target?.confirmedWinner == .opponent,
                enabled: target != nil, solid: true
            ) {
                tapWinner(.opponent)
            }
            .overlay(alignment: .topTrailing) { whyBubble(target, size: 38) }
        }
        .frame(height: height)
        .padding(.horizontal, 6)
    }

    /// What else it could be. Three tiles down the far edge.
    func landscapeDispositionRail(height: CGFloat) -> some View {
        let target = displayTarget
        return VStack(spacing: 8) {
            dispositionButton(
                "Skip", sub: "let", tint: PL.warning,
                enabled: target != nil, tall: true
            ) { tapSkip() }
            dispositionButton(
                "Delete", sub: "dead space", tint: PL.dangerText,
                enabled: target != nil, tall: true
            ) { tapDelete() }
            dispositionButton(
                "Modify", sub: "split · join", tint: PL.cyan,
                enabled: target != nil, tall: true
            ) {
                if let target {
                    player.pause()
                    modifyPoint = target
                }
            }
        }
        .frame(height: height)
        .padding(.horizontal, 6)
    }

    /// The scrubber and every other control, on one solid bar flush with the
    /// bottom of the screen. It stays put rather than fading with the
    /// chrome: it is not covering anything, so there is nothing to reveal.
    ///
    /// One row, not two. Sideways the screen is 16:9-shaped, so a point of
    /// bar height costs nine sixteenths of a point of picture WIDTH — a
    /// second row of buttons was thirty points of bar and fifty of picture.
    /// The width is there: the row fits across a phone held sideways, and
    /// the pieces that do not fit drop out in order rather than wrapping.
    /// Only the pad's buttons, spread across a solid bar flush with the
    /// bottom of the screen.
    ///
    /// The scrubber used to sit here beside them. It has gone back onto the
    /// video, where portrait has always kept it: a scrubber is wanted at the
    /// end of a point and in the way for the rest of it, and putting it on a
    /// permanent bar meant paying for it permanently. Over the picture it
    /// costs nothing, appears the moment the clip stops, leaves when play
    /// resumes, and gets the whole width of the video to be precise with.
    func landscapeBottomBar(side: CGFloat, bottom: CGFloat) -> some View {
        landscapeActions()
            .padding(.horizontal, side)
            .padding(.top, 3)
            .padding(.bottom, bottom)
            .background(PL.surface.ignoresSafeArea(edges: [.horizontal, .bottom]))
            .overlay(alignment: .top) {
                Rectangle().fill(PL.edge).frame(height: 1)
            }
    }

    /// The scrubber over the video's bottom edge, sideways. The same row
    /// portrait draws, and it comes and goes with the same chrome.
    func landscapeVideoTransport(size: CGSize) -> some View {
        scrubRow(landscape: true, size: size)
            .padding(.horizontal, 12)
            .padding(.top, 6)
            .padding(.bottom, 8)
            .background(
                LinearGradient(
                    colors: [.clear, PL.ink.opacity(0.55), PL.ink.opacity(0.88)],
                    startPoint: .top, endPoint: .bottom
                )
            )
    }

    func landscapeActions() -> some View {
        let target = displayTarget
        return HStack(spacing: 6) {
            miniControl("chevron.left", label: "Back", wide: true) { step(-1) }
            miniControl(
                "arrow.uturn.backward", label: "Undo",
                disabled: undoStack.isEmpty, wide: true
            ) { undo() }
            miniControl("gobackward", label: "Replay", wide: true) { replayTarget() }
            miniSpeedMenu(wide: true)
            miniBoundaryControl(wide: true)
            miniControl(
                target?.starred == true ? "star.fill" : "star", label: "Star",
                disabled: target == nil, wide: true
            ) {
                if let target {
                    pushUndo(target)
                    Task { await model.toggleStar(target) }
                }
            }
            // Admin only, same gate as the portrait control — the label is a
            // research tool, not a product feature.
            if canLabelServeStart, let target {
                miniControl(
                    target.serveStartAtCutS == nil ? "flag" : "flag.fill",
                    label: "Serve", lit: target.serveStartAtCutS != nil, wide: true
                ) {
                    Task {
                        await model.setServeStart(
                            target, at: currentT, paused: player.rate == 0,
                            rate: player.rate, source: "button"
                        )
                    }
                    showFlash("Serve start")
                }
            }
            miniControl(
                "doc.text", label: "Analysis",
                disabled: target == nil || reasonsStore == nil, wide: true
            ) {
                openAnalysis()
            }
            miniControl(
                "arrow.up.forward.square", label: "Details",
                disabled: target == nil || onOpenPoint == nil, wide: true
            ) {
                guard let target, let i = points.firstIndex(of: target) else { return }
                dismiss()
                onOpenPoint?(i)
            }
            miniControl("chevron.right", label: "Next", wide: true) { step(1) }
        }
    }

    /// Every point this row grows costs the picture nine sixteenths of that
    /// in width, so it is kept as small as a thumb will still hit.
    static let miniControlSize = CGSize(width: 42, height: 34)

    /// - Parameter wide: the landscape bar, where ten of these share the
    ///   whole width. Fixed-width buttons left three hundred points of bar
    ///   empty and the row read as a clump in the middle of it.
    func miniControl(
        _ icon: String, label: String, disabled: Bool = false, lit: Bool = false,
        wide: Bool = false, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 1) {
                Image(systemName: icon)
                    .font(.system(size: wide ? 15 : 14, weight: .medium))
                    .frame(height: 17)
                Text(label)
                    .font(.system(size: wide ? 9 : 8, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundStyle(disabled ? PL.text600 : lit ? PL.cyan : PL.text200)
            .frame(
                maxWidth: wide ? .infinity : Self.miniControlSize.width,
                minHeight: Self.miniControlSize.height,
                maxHeight: Self.miniControlSize.height
            )
            .background(PL.surface2, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }

    /// The server's ball glows on their side; the other side keeps a quiet
    /// hollow ring, so the row always shows both ends of the rotation.
    /// Games won so far, beside the running score. Without it, closing a
    /// game drops the big number to 0-0 with nothing to say a game was won
    /// — which reads as the score being lost rather than banked.
    @ViewBuilder
    func gamesPill(_ score: MatchScore) -> some View {
        if score.gamesYou + score.gamesThem > 0 {
            Text("\(score.gamesYou)-\(score.gamesThem)")
                .font(.system(size: 11, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(PL.text300)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(PL.surface2, in: Capsule())
                .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                .accessibilityLabel("\(score.gamesYou) games to \(score.gamesThem)")
        }
    }

    func serveBall(active: Bool, them: Bool = false) -> some View {
        Button {
            flipServer(to: them ? .opponent : .user)
        } label: {
            serveBallFace(active: active, them: them)
        }
        .buttonStyle(.plain)
        .disabled(displayTarget == nil || app.userId != match.userId)
        .accessibilityLabel(
            active
                ? "\(them ? (match.opponentName ?? "They") : "I") serve — tap to switch server"
                : "Give the serve to \(them ? (match.opponentName ?? "them") : "me")"
        )
    }

    /// The override re-anchors the whole ITTF rotation, so every later point
    /// recomputes — which is the point: one corrected server fixes the rest
    /// of the match rather than needing a tap each.
    func flipServer(to side: Winner) {
        guard let target = displayTarget, app.userId == match.userId else { return }
        guard serving[target.id]?.server != side else { return }
        Task { await model.setServerOverride(target, side) }
        showFlash(side == .user
            ? "I serve — rotation updated"
            : "\(match.opponentName ?? "They") serve — rotation updated")
    }

    func serveBallFace(active: Bool, them: Bool = false) -> some View {
        let tint = them ? PL.magentaSoft : PL.cyan
        return Circle()
            .fill(active ? AnyShapeStyle(
                RadialGradient(
                    colors: [Color.white.opacity(0.9), tint],
                    center: .init(x: 0.35, y: 0.3), startRadius: 1, endRadius: 16
                )
            ) : AnyShapeStyle(Color.clear))
            .frame(width: 26, height: 26)
            .overlay {
                if !active {
                    Circle().strokeBorder(PL.edge, lineWidth: 2)
                }
            }
            .shadow(color: active ? tint.opacity(0.7) : .clear, radius: 8)
    }

    func serveLine(_ info: ServeInfo?) -> String {
        switch info?.server {
        case .user: "You serve"
        case .opponent: "\(match.opponentName ?? "They") serve\(match.opponentName == nil ? "" : "s")"
        case nil: ""
        }
    }

    /// The point ticker: numbered rings colored by winner, the current one
    /// glowing with a playback-progress arc — the web pad's strip.
    func chipStrip(targetId: UUID?) -> some View {
        let full = fullScore
        let removed = removedDots
        return ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(points.enumerated()), id: \.element.id) { i, p in
                        if p.cutT0 != nil {
                            // A soft delete used to leave NOTHING behind: the
                            // chip vanished, the numbers closed over the gap,
                            // and the one-step Undo was the only way back. So
                            // a mis-tapped delete was unrecoverable in
                            // practice and, worse, invisible. The dot is the
                            // trace.
                            ForEach(removed[p.id] ?? [], id: \.self) { id in
                                removedDot(id)
                            }
                            HStack(spacing: 0) {
                                tickerChip(p, number: i + 1, isCurrent: p.id == targetId)
                                // A SEPARATE button, so tapping the number
                                // again just re-seeks — the two actions never
                                // share a target.
                                if chipPill == p.id, onOpenPoint != nil {
                                    Button("Go to point →") { openPoint(p) }
                                        .font(.system(size: 11, weight: .semibold))
                                        .foregroundStyle(PL.cyan)
                                        .padding(.horizontal, 8)
                                        .buttonStyle(.plain)
                                        .transition(.opacity)
                                }
                            }
                            .id(p.id)
                            if let ends = full.boundaryAfter[p.id] {
                                gameDivider(p, ends)
                            }
                        }
                    }
                    ForEach(removed[nil] ?? [], id: \.self) { id in
                        removedDot(id)
                    }
                }
                .padding(.vertical, 5)
                .padding(.horizontal, 2)
            }
            .onChange(of: targetId) { _, id in
                guard let id else { return }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                    proxy.scrollTo(id, anchor: .center)
                }
            }
        }
    }

    /// Deleted points, keyed by the visible chip they sat BEFORE (nil for
    /// the ones after the last visible chip).
    var removedDots: [UUID?: [UUID]] {
        var out: [UUID?: [UUID]] = [:]
        let visibleSorted = points.compactMap { p -> (UUID, Double)? in
            p.cutT0.map { (p.id, $0) }
        }
        for p in model.points where p.deleted {
            guard let cutT0 = p.cutT0 else { continue }
            let anchor = visibleSorted.first { $0.1 > cutT0 }?.0
            out[anchor, default: []].append(p.id)
        }
        return out
    }

    /// Tap once to arm, again to restore — a bare dot is too easy to hit by
    /// accident for a write, and a confirm dialog for one point is heavier
    /// than the mistake.
    func removedDot(_ id: UUID) -> some View {
        Group {
            if removedArmed == id {
                Button("Restore") { restoreRemoved(id) }
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(PL.dangerText)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .overlay(Capsule().strokeBorder(PL.dangerText.opacity(0.6), lineWidth: 1))
                    .buttonStyle(.plain)
            } else {
                Button {
                    removedArmed = id
                    Task {
                        try? await Task.sleep(nanoseconds: 3_000_000_000)
                        if removedArmed == id { removedArmed = nil }
                    }
                } label: {
                    Circle()
                        .strokeBorder(PL.dangerText.opacity(0.55), lineWidth: 1.5)
                        .frame(width: 10, height: 10)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("A removed point — tap to put it back")
            }
        }
    }

    func restoreRemoved(_ id: UUID) {
        removedArmed = nil
        guard let p = model.points.first(where: { $0.id == id }) else { return }
        Task {
            await model.restoreScorerFields(
                p, winner: p.confirmedWinner, isLet: p.isLet,
                scoredAt: p.scoredAtCutS, deleted: false, starred: p.starred
            )
        }
        showFlash("Point restored")
    }

    /// A game that ended in the wrong place — or never ended at all — is the
    /// one thing on this strip you cannot fix by scoring differently, so the
    /// divider owns its own way out.
    func gameDivider(_ p: MatchPoint, _ ends: GameBoundary) -> some View {
        Button {
            gameBreak = GameBreak(
                pointId: p.id, game: ends.game, you: ends.you, them: ends.them
            )
        } label: {
            VStack(spacing: 3) {
                Rectangle().fill(PL.text600).frame(width: 1, height: 10)
                Text("\(ends.you)-\(ends.them)")
                    .font(.system(size: 9, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(PL.text400)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .overlay(Capsule().strokeBorder(PL.text600, lineWidth: 1))
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Game \(ends.game) ended here at \(ends.you)-\(ends.them) — tap to change")
    }

    func openPoint(_ p: MatchPoint) {
        guard let i = points.firstIndex(of: p) else { return }
        chipPill = nil
        dismiss()
        onOpenPoint?(i)
    }

    func tickerChip(_ p: MatchPoint, number: Int, isCurrent: Bool) -> some View {
        let tint = chipTint(p)
        let unscored = p.confirmedWinner == nil && !p.isLet
        // Playback progress through the current point's padded span.
        let progress: Double = {
            guard isCurrent, let cutT0 = p.cutT0,
                  let end = paddedEnd(p, pad), end > cutT0 else { return 0 }
            return min(1, max(0, (currentT - cutT0) / (end - cutT0)))
        }()
        return Button {
            if let cutT0 = p.cutT0 {
                endPausedId = nil
                endPauseBlockedId = nil
                playTail = nil
                seek(to: cutT0)
                play()
            }
            // Tapping a chip grows "Go to point" out of it, rather than
            // floating a pill over the middle of the footage — the one
            // thing on this screen you are actually trying to watch. The
            // offer belongs where the tap happened.
            withAnimation(.easeOut(duration: 0.15)) { chipPill = p.id }
            Task {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                withAnimation { if chipPill == p.id { chipPill = nil } }
            }
        } label: {
            ZStack {
                Circle()
                    .fill(tint.opacity(unscored ? 0.04 : 0.16))
                if unscored {
                    Circle().strokeBorder(
                        PL.text600, style: StrokeStyle(lineWidth: 1.5, dash: [3, 3])
                    )
                } else {
                    Circle().strokeBorder(tint.opacity(0.85), lineWidth: 2)
                }
                if p.edited {
                    // A timing edit leaves this chip's clip stale while the
                    // worker recuts it. The spinner is that state made
                    // visible — without it a split or an Adjust looks like
                    // nothing happened. It replaces the countdown for the
                    // duration: the footage it would be counting down is the
                    // stale cut. Clears itself through the pending-clip poll.
                    RecutRing().padding(1)
                } else if isCurrent, progress > 0 {
                    // The arc is the time LEFT in the point, shrinking as
                    // it plays — the web ticker's direction.
                    Circle()
                        .trim(from: 0, to: max(0, 1 - progress))
                        .stroke(.white, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .padding(1)
                }
                Text("\(number)")
                    .font(.system(size: 13, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(unscored ? PL.text400 : tint)
            }
            .frame(width: 36, height: 36)
            .shadow(color: isCurrent && !p.edited ? tint.opacity(0.8) : .clear, radius: 6)
            .scaleEffect(isCurrent && !p.edited ? 1.08 : 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            "Go to point \(number)\(p.edited ? ", updating clip" : "")"
        )
    }

    func chipTint(_ p: MatchPoint) -> Color {
        if p.isLet { return PL.warning }
        switch p.confirmedWinner {
        case .user: return PL.cyan
        case .opponent: return PL.magentaSoft
        case nil: return PL.text500
        }
    }

    func padControlLabel(_ label: String) -> some View {
        Text(label)
            .font(.system(size: 9, weight: .medium))
            .lineLimit(1)
            .minimumScaleFactor(0.75)
    }

    func padControl(
        _ label: String, icon: String? = nil, text: String? = nil,
        disabled: Bool = false, lit: Bool = false, attention: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                if let icon {
                    Image(systemName: icon).font(.system(size: 14, weight: .medium))
                        .frame(height: 16)
                    padControlLabel(label)
                } else if let text {
                    Text(text).font(.system(size: 13, weight: .bold)).monospacedDigit()
                        .frame(height: 16)
                    padControlLabel(label)
                } else {
                    // No icon: the label takes the whole tile and wraps to
                    // two lines instead. Same height as every sibling —
                    // a short pill in a row of tall ones reads as a
                    // different kind of control, which it is not.
                    Text(label)
                        .font(.system(size: 11, weight: .semibold))
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                        .frame(height: 32)
                }
            }
            .foregroundStyle(disabled ? PL.text600 : lit ? PL.cyan : PL.text300)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(
                        attention ? PL.cyan : lit ? PL.cyan.opacity(0.4) : PL.edge,
                        lineWidth: attention ? 2 : 1
                    )
            )
            .shadow(color: attention ? PL.cyan.opacity(0.5) : .clear, radius: 10)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .animation(.easeOut(duration: 0.2), value: attention)
    }

    /// One button for the whole game boundary, whichever way the correction
    /// needs to go. The label names what the tap DOES; `attention` is the
    /// beat of glow an answer crossing a held-open game's real end gets,
    /// instead of a pill floated over the footage.
    func boundaryPadControl() -> some View {
        let offer = boundaryOffer
        return padControl(
            offer?.label ?? "Game ended",
            disabled: offer == nil,
            lit: offer?.endsHere == true || offer?.attention == true,
            attention: offer?.attention == true
        ) {
            tapBoundary()
        }
        .accessibilityLabel(offer?.accessibility ?? "Mark the game as ended")
    }

    /// - Parameter tall: the landscape rail, where three of these divide the
    ///   height of the picture between them and the fill has to reach the
    ///   whole tile rather than hug the words.
    func dispositionButton(
        _ label: String, sub: String, tint: Color, enabled: Bool = true,
        tall: Bool = false, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Text(label).font(.system(size: tall ? 15 : 13, weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.7)
                Text(sub).font(.system(size: 10)).opacity(0.7)
                    .lineLimit(1).minimumScaleFactor(0.7)
            }
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity, maxHeight: tall ? .infinity : nil)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(tall ? PL.surface2 : PL.ink.opacity(0.4))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(tint.opacity(0.35), lineWidth: 1)
            )
            .opacity(enabled ? 1 : 0.4)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    /// The two big buttons. Dimmed before the first rally, where there is
    /// nothing on screen to give the point to — a live-looking button that
    /// does nothing when tapped is worse than one that says so.
    /// - Parameter solid: the landscape rail, where the tile sits on the
    ///   screen rather than over the footage. A tint at 6% over black is a
    ///   button you have to look for; over a real surface it is a button.
    func winnerButton(
        _ label: String, tint: Color, selected: Bool, enabled: Bool = true,
        solid: Bool = false, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 26, weight: .bold))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background {
                    RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                        .fill(solid ? PL.surface2 : Color.clear)
                        .overlay(
                            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                                .fill(tint.opacity(selected ? 0.28 : 0.06))
                        )
                }
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                        .strokeBorder(tint.opacity(selected ? 0.9 : 0.35), lineWidth: selected ? 2 : 1)
                )
                .shadow(color: selected ? tint.opacity(0.45) : .clear, radius: 14)
                .opacity(enabled ? 1 : 0.4)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    // MARK: - Summary / review

    /// "2-1 · 11-9 8-11 11-6", plus the game still in progress.
    ///
    /// The games list only holds CLOSED games, so a match abandoned mid-game
    /// printed the completed ones and silently dropped everything scored
    /// since — and a match with a single point printed "0-0 · " with nothing
    /// after the separator.
    func summaryLine(_ score: MatchScore) -> String {
        guard score.confirmedCount > 0 else { return "No points scored" }
        var games = score.games.map { "\($0.you)-\($0.them)" }
        if score.open, score.current.you > 0 || score.current.them > 0 {
            games.append("\(score.current.you)-\(score.current.them)")
        }
        let head = "\(score.gamesYou)-\(score.gamesThem)"
        return games.isEmpty ? head : head + " · " + games.joined(separator: " ")
    }

    var summaryOverlay: some View {
        let score = computeMatchScore(points.map {
            PointRow(
                id: $0.id, matchId: $0.matchId, idx: $0.idx, t0: $0.t0,
                confirmedWinner: $0.confirmedWinner, isLet: $0.isLet,
                deleted: $0.deleted, gameEndOverride: $0.gameEndOverride,
                gameWinnerOverride: $0.gameWinnerOverride
            )
        })
        let unscored = points.filter { !$0.isLet && $0.confirmedWinner == nil && $0.cutT0 != nil }
        let starred = points.filter(\.starred).count
        return ZStack {
            PL.ink.opacity(0.8).ignoresSafeArea()
            VStack(spacing: 14) {
                Text(summaryLine(score))
                    .font(.system(size: 20, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(PL.text100)
                if !unscored.isEmpty {
                    HStack(spacing: 10) {
                        Text("\(unscored.count) unscored")
                            .font(.plBody)
                            .foregroundStyle(PL.text400)
                        Button("Review") { startReview(unscored.map(\.id)) }
                            .buttonStyle(PLCyanGhostButtonStyle())
                    }
                }
                if starred > 0 {
                    Text("\(starred) starred")
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                }
                Button("Done") { dismiss() }
                    .buttonStyle(PLPrimaryButtonStyle())
            }
            .padding(28)
            .frame(maxWidth: 320)
            .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
        }
    }

    func startReview(_ ids: [UUID]) {
        reviewQueue = ids
        reviewIndex = 0
        phase = .review
        seekToReview()
    }

    func seekToReview() {
        guard reviewQueue.indices.contains(reviewIndex),
              let p = points.first(where: { $0.id == reviewQueue[reviewIndex] }),
              let cutT0 = p.cutT0 else {
            phase = .summary
            return
        }
        seek(to: cutT0)
        play()
    }

    // MARK: - Scoring actions

    /// Snapshot the scorer-owned fields of a point so Undo can put them
    /// back. Taken BEFORE the write, always, including on the paths that
    /// return early — except the ones that change nothing, which must not
    /// spend the user's next Undo on a no-op.
    func pushUndo(_ p: MatchPoint) {
        undoStack.append(.tap(
            pointId: p.id, winner: p.confirmedWinner, isLet: p.isLet,
            scoredAt: p.scoredAtCutS, starred: p.starred
        ))
    }

    /// The big winner buttons. `thenWhy` is the bubble in the opponent
    /// tile's corner: it scores the same side the button around it would,
    /// then holds the advance and opens the one-question overlay.
    func tapWinner(_ side: Winner, thenWhy: Bool = false) {
        guard let target = tapTarget else { return }
        lastScoreTapAt = Date()
        firstHintShown = true
        retireHint(.score)

        // A bubble tap on a point already given to this side changes
        // nothing to undo; pushing an entry anyway would spend the next
        // Undo on a no-op.
        let noOp = thenWhy && target.confirmedWinner == side && !target.isLet
        if !noOp { pushUndo(target) }

        let hadOutcome = target.confirmedWinner != nil || target.isLet
        // The big button TOGGLES — tapping the winner it already shows
        // clears it, which is how a mis-score is corrected. Why never
        // does: it means "they won it, and here is why I lost", so on a
        // point already theirs it re-affirms and opens the overlay rather
        // than silently un-scoring the point you came to explain.
        let next: Winner? = thenWhy
            ? side
            : (target.confirmedWinner == side ? nil : side)

        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        lastScored = next == nil ? nil : (id: target.id, at: Date())
        if next != target.confirmedWinner || target.isLet {
            let stamp = phase == .play && next != nil ? currentT : nil
            Task { await model.tapWinner(target, side, scoredAt: stamp, force: next != nil) }
        }

        if phase == .review {
            endPausedId = nil
            Task {
                try? await Task.sleep(nanoseconds: 400_000_000)
                nextReview()
            }
            return
        }

        // While a 'continue' holds the game open past the auto condition,
        // every answered point offers the one-tap boundary. Computed on
        // the answer as just applied — the optimistic update has not landed
        // in `points` yet.
        if let next, let i = points.firstIndex(of: target) {
            var upto = Array(points.prefix(i + 1)).map(pointRow)
            upto[i] = PointRow(
                id: target.id, matchId: target.matchId, idx: target.idx, t0: target.t0,
                confirmedWinner: next, isLet: false, deleted: false,
                gameEndOverride: target.gameEndOverride,
                gameWinnerOverride: target.gameWinnerOverride
            )
            if computeMatchScore(upto).open { showEndedNudge(target.id) }
        }

        if thenWhy, next != nil {
            player.pause()
            endPausedId = nil
            // The winner this tap just set, applied locally: `target` was
            // read before the write, so handing it over as-is would open on
            // a point the overlay still believes is unscored.
            var scored = target
            scored.confirmedWinner = next
            scored.isLet = false
            whyPoint = scored
            return
        }

        endPausedId = nil
        // ADVANCE ON ANY NEW ANSWER. Changing an existing outcome is a
        // correction: it never advances, the rally just keeps playing.
        guard !hadOutcome, next != nil else { return }
        offerSplitIfEarly(target)
        advance(from: target)
    }

    func tapSkip() {
        guard let target = tapTarget else { return }
        if target.isLet {
            // Already skipped — the press means "move on". Never a silent
            // no-op, and never an undo entry either: nothing changed.
            if let next = nextCutStart(points, after: target),
               let n = points.firstIndex(where: { $0.cutT0 == next }) {
                endPausedId = nil
                seek(to: next)
                play()
                showFlash("Point \(n + 1)")
            }
            return
        }
        let hadOutcome = target.confirmedWinner != nil
        pushUndo(target)
        Task { await model.tapSkip(target) }
        showFlash("Skipped")
        endPausedId = nil
        if phase == .review {
            Task {
                try? await Task.sleep(nanoseconds: 400_000_000)
                nextReview()
            }
            return
        }
        // A skipped point doesn't count — jump straight to the next rally.
        // Skipping one that already HAD a winner is a correction and stays.
        guard !hadOutcome else { return }
        jumpAfter(target)
    }

    func tapDelete() {
        guard let target = tapTarget else { return }
        undoStack.append(.delete(pointId: target.id, cutT0: target.cutT0))
        Task { await model.softDelete(target) }
        showFlash("Removed")
        endPausedId = nil
        jumpAfter(target)
    }

    /// A NEW answer advances. With real footage still to run, play the clip
    /// out instead of jumping over frames nobody has looked at — if a second
    /// rally is in there you now watch it happen, and the tail lands you on
    /// the next point a second later, which is what the jump would have done
    /// anyway.
    func advance(from p: MatchPoint) {
        switch advanceMove(
            from: p, now: currentT,
            nextStart: nextCutStart(points, after: p), pad: pad
        ) {
        case .playTail(let end):
            playTail = PlayTail(id: p.id, end: end)
            endPauseBlockedId = p.id // its own end must not stop us here
            play()
        case .jump(let to):
            playTail = nil
            endPauseBlockedId = nil // the destination's boundary re-arms
            seek(to: to)
            play()
        case .stay:
            playTail = nil
            play()
        }
    }

    func jumpAfter(_ p: MatchPoint) {
        playTail = nil
        if let next = nextCutStart(points, after: p) {
            endPauseBlockedId = nil
            seek(to: next)
        }
        play()
    }

    /// Modify is done and something changed.
    ///
    /// A split or a join rewrites which points exist, so the pass has to
    /// move: the landing is the first point past everything the edit
    /// touched, and it plays, because "the video started again somewhere
    /// new" is the clearest possible answer to "did that work?". The pins
    /// go first — the paused-at-the-end state belongs to a point that may
    /// not exist any more.
    ///
    /// The clip poll is started here rather than left to the pending-clip
    /// watcher: the edit sets `edited` on rows that were already pending
    /// often enough that the watcher sees no change at all.
    func modifyFinished(_ outcome: ModifyOutcome) {
        endPausedId = nil
        endPauseBlockedId = nil
        playTail = nil
        splitNudge = nil
        if let landing = outcome.landing {
            seek(to: landing)
        }
        if outcome.play { play() }
        showFlash(outcome.flash, seconds: 2.4)
        model.startClipPoll(match.id)
    }

    func replayTarget() {
        guard let target = displayTarget, let cutT0 = target.cutT0 else { return }
        // Explicitly re-arm: a short rally can be closer to its end than the
        // re-arm dip, and the replay MUST stop at that end again.
        endPauseBlockedId = nil
        endPausedId = nil
        playTail = nil
        seek(to: cutT0)
        play()
    }

    func nextReview() {
        if reviewIndex + 1 >= reviewQueue.count {
            phase = .summary
        } else {
            reviewIndex += 1
            seekToReview()
        }
    }

    /// "That clip might be two points": offered on the clip just answered
    /// when a rally's worth of footage was still to run. Non-blocking, and
    /// the clip advances on its own when the footage runs out.
    func offerSplitIfEarly(_ p: MatchPoint) {
        // One offer at a time, and answering anything retires the last one:
        // the tail it belonged to has been watched by then, and a stale
        // offer that outlives its clip is how you split the wrong point.
        splitNudge = nil
        guard phase == .play, let cutT0 = p.cutT0, let end = paddedEnd(p, pad),
              end - currentT > TAIL_WATCH_S
        else { return }
        // The detections sharpen it where they exist — an actual quiet
        // stretch places the cut and firms up the wording — but are never
        // required. Without them, cut a beat before where the answer came:
        // the tap always lands after the deciding shot.
        let gap = fusedSplitCut(p, pad)
        let atCut = gap ?? max(cutT0 + 0.4, currentT - SPLIT_LEAD_S)
        splitNudge = SplitNudge(pointId: p.id, atCut: atCut, certain: gap != nil)
    }

    func showEndedNudge(_ pointId: UUID) {
        endedNudgePointId = pointId
        Task {
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            if endedNudgePointId == pointId { endedNudgePointId = nil }
        }
    }

    // MARK: - Game boundary

    /// Pin or clear a boundary override, undoably. The named winner rides
    /// along: reopening a game clears the answer in the same write, so undo
    /// has to carry it back.
    func applyGameOverride(_ p: MatchPoint, _ value: GameEndOverride?) {
        undoStack.append(.override(
            pointId: p.id, previous: p.gameEndOverride, previousWinner: p.gameWinnerOverride
        ))
        Task { await model.setBoundary(p, next: value) }
    }

    /// Every "Game ended" path lands here: pin the end, skip the "did it
    /// though?" retarget for an end the user asked for, and ask who won when
    /// the closed score cannot say.
    func pinEndAt(_ p: MatchPoint) {
        explicitEndPointId = p.id
        lastScoreTapAt = Date() // so the score flash still confirms it
        applyGameOverride(p, .end)
        if let unproven = unprovenGameAt(p.id, points: points.map(pointRow)) {
            winnerAsk = WinnerAsk(pointId: p.id, you: unproven.you, them: unproven.them)
        }
    }

    func tapBoundary() {
        guard let offer = boundaryOffer else { return }
        switch offer.move {
        case .reopen(let id):
            guard let p = points.first(where: { $0.id == id }) else { return }
            applyGameOverride(p, reopenOverride(p.gameEndOverride))
            freshBoundary = nil
            showFlash("Game continues")
        case .pinEnd(let id):
            guard let p = points.first(where: { $0.id == id }) else { return }
            pinEndAt(p)
            endedNudgePointId = nil
            showFlash("Game ended")
        }
    }

    // MARK: - Undo

    func undo() {
        guard let entry = undoStack.popLast() else { return }
        switch entry {
        case .tap(let id, let winner, let isLet, let scoredAt, let starred):
            guard let current = points.first(where: { $0.id == id }) else { return }
            Task { await model.restoreScorerFields(
                current, winner: winner, isLet: isLet, scoredAt: scoredAt,
                deleted: false, starred: starred
            ) }
            replay(at: current.cutT0)
        case .delete(let id, let cutT0):
            // The point is not in the visible list any more, so the seek
            // target had to travel with the entry.
            guard let current = model.points.first(where: { $0.id == id }) else { return }
            Task { await model.restoreScorerFields(
                current, winner: current.confirmedWinner, isLet: current.isLet,
                scoredAt: current.scoredAtCutS, deleted: false, starred: current.starred
            ) }
            replay(at: cutT0)
        case .override(let id, let previous, let previousWinner):
            // Overrides never moved playback, so undo doesn't either.
            guard let current = model.points.first(where: { $0.id == id }) else { return }
            Task {
                await model.setBoundary(current, next: previous)
                if let previousWinner, previous == .end {
                    await model.setGameWinner(current, previousWinner)
                }
            }
            freshBoundary = nil
        case .bulkDelete(let ids, let cutT0):
            Task {
                for id in ids {
                    guard let p = model.points.first(where: { $0.id == id }) else { continue }
                    await model.restoreScorerFields(
                        p, winner: p.confirmedWinner, isLet: p.isLet,
                        scoredAt: p.scoredAtCutS, deleted: false, starred: p.starred
                    )
                }
            }
            replay(at: cutT0)
        }
    }

    func replay(at cutT0: Double?) {
        guard phase != .review, let cutT0 else { return }
        endPausedId = nil
        endPauseBlockedId = nil
        playTail = nil
        seek(to: cutT0)
        play()
    }

    // MARK: - Playback plumbing

    func start() async {
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        try? AVAudioSession.sharedInstance().setActive(true)

        player.replaceCurrentItem(with: AVPlayerItem(url: videoURL))
        NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: player.currentItem, queue: .main
        ) { _ in
            Task { @MainActor in
                if mode == .score { phase = .summary }
            }
        }
        observer = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.2, preferredTimescale: 600),
            queue: .main
        ) { time in
            Task { @MainActor in tick(time.seconds) }
        }

        firstServer = match.firstServer.flatMap(Winner.init(rawValue:))
        prevGamesCount = runningScore.games.count
        if mode == .score {
            // Resume where scoring stopped: the first unscored point. Also
            // from the very first entry — landing before it leaves the pad
            // dimmed with no chip, which reads as broken rather than as
            // "nothing here yet".
            //
            // Unless the caller named a point. Coming back from that point's
            // detail view, "where scoring stopped" is the wrong answer: you
            // were looking at THIS rally a second ago.
            let resumeTo = points.first {
                !$0.isLet && $0.confirmedWinner == nil && $0.cutT0 != nil
            }
            let base = startAt ?? resumeTo?.cutT0 ?? currentT
            let target = snapLanding(
                base, spans: deadSpans, firstPointStart: firstPointStart,
                alwaysToFirst: true
            )
            seek(to: target)
            if startAt == nil, let resumeTo, let i = points.firstIndex(of: resumeTo), i > 0 {
                pendingResumeToast = "Resuming from point \(i + 1)"
            }
            if firstServer == nil, !FirstServerPrompt.isSkipped(match.id) {
                // Presenting a sheet while the takeover's own animation is
                // still running leaves it half-alive with dead buttons —
                // the picker race all over again. Let the cover land first.
                try? await Task.sleep(for: .milliseconds(650))
                setupOpen = true
                return
            }
            if let resume = pendingResumeToast {
                showToast(resume)
                pendingResumeToast = nil
            }
        } else if let startAt {
            seek(to: snapLanding(
                startAt, spans: deadSpans, firstPointStart: firstPointStart,
                alwaysToFirst: false
            ))
        }
        // Discovery: the double tap first, hold-for-speed on a later open
        // once the double tap is learned or spent. One hint per open.
        if mode == .watch, let next = GestureHints.nextWatchHint() {
            showHint(next)
        }
        play()
    }

    func tick(_ t: Double) {
        let prev = lastTick
        currentT = t
        isPlaying = player.rate > 0
        loaded = (player.currentItem?.loadedTimeRanges ?? []).compactMap {
            let r = $0.timeRangeValue
            let start = r.start.seconds
            let end = r.end.seconds
            guard start.isFinite, end.isFinite, end > start else { return nil }
            return TimeSpan(start: start, end: end)
        }
        if duration == 0, let d = player.currentItem?.duration.seconds, d.isFinite, d > 0 {
            duration = d
        }

        // Stalled: the rate says playing and the clock is not moving. AVPlayer
        // does not drop the rate when it runs out of data, so the only honest
        // signal is the playhead itself standing still.
        if player.rate > 0, !scrubbing {
            if abs(t - stallWatchT) < 0.001 {
                if !stalled { stalled = true }
            } else {
                stallWatchT = t
                if stalled { stalled = false }
            }
        } else if stalled {
            stalled = false
        }

        // Anything other than continuous playback ends the run: the next
        // tick is a fresh one, and a jump must never read as a crossing.
        guard isPlaying, !scrubbing else {
            lastTick = nil
            return
        }
        lastTick = t
        if prev == nil { runStartT = t }

        // Deleted footage is dead in both modes: jump out of it rather than
        // play frames the owner removed. Only during playback — landing
        // inside a span on purpose (a scrub) stays put.
        if let out = spanEnd(deadSpans, at: t) {
            seek(to: out)
            return
        }

        // Highlights: everything between the picks is dead too. Unlike a
        // let, a deliberate scrub does NOT get to stay — the tape only
        // ever shows its rallies, so a landing outside snaps forward.
        // Past the last rally the tape ends: pause, chrome up.
        if let spans = highlightSpans,
           !spans.contains(where: { t >= $0.start - 0.05 && t < $0.end }) {
            if let next = spans.first(where: { $0.start > t }) {
                seek(to: next.start)
            } else {
                player.pause()
                chromeVisible = true
            }
            return
        }

        // Skipped rallies are dead in WATCH mode only. A let happened and is
        // still in the timeline, so score mode has to be able to land on one
        // and change its mind — but watching the match back, a let is
        // exactly the thing nobody needs to sit through. Only a crossing
        // qualifies: landing inside one deliberately is left alone, because
        // the previous tick is nil after any seek.
        if mode == .watch, let prev {
            for span in letSpans(points, pad: pad) {
                if t < span.start { break }
                if prev < span.start, t < span.end - 0.05 {
                    seek(to: span.end)
                    return
                }
            }
        }

        guard mode == .score else { return }

        if phase == .review {
            // Review clips stop at their padded end.
            if reviewQueue.indices.contains(reviewIndex),
               let p = points.first(where: { $0.id == reviewQueue[reviewIndex] }),
               let end = paddedEnd(p, pad), t >= end {
                player.pause()
                showChrome(autoHide: false)
            }
            return
        }
        guard phase == .play else { return }
        guard let prev, t > prev, t - prev < 1 else { return }

        // A tail that has played out: advance now, which is what the jump
        // would have done had the answer come at the boundary.
        if let tail = playTail, t >= tail.end {
            playTail = nil
            splitNudge = nil
            if let p = points.first(where: { $0.id == tail.id }) { jumpAfter(p) }
            return
        }

        // Re-arm: playing well before a consumed boundary again means the
        // user scrubbed back to REPLAY the point, so its end may stop the
        // video a second time. A small dip — resume jitter — never re-arms,
        // or resume would wedge at the same boundary forever.
        if let blockedId = endPauseBlockedId {
            let blocked = points.first { $0.id == blockedId }
            let end = blocked.flatMap(stopAt)
            if end == nil || t < end! - 1.5 { endPauseBlockedId = nil }
        }

        // The stop whose boundary this tick crossed. Every rally has one:
        // unanswered rallies stop at the answer beat, answered ones at the
        // end of their clip, because score mode is where a wrong call gets
        // corrected and playing straight past the evidence is no use.
        let guarded = Date().timeIntervalSince(lastPlayAt) < 0.5
        for p in points {
            guard let stop = stopAt(p), stop > prev, stop <= t else { continue }
            // Crossing a DIFFERENT rally's boundary retires the consumed
            // one — its end can stop the video again on a later replay.
            if p.id != endPauseBlockedId { endPauseBlockedId = nil }
            guard !guarded,
                  runWatched(p, points: points, runStart: runStartT, pad: pad)
            else { continue }
            endPauseBlockedId = p.id
            endPausedId = p.id
            player.pause()
            showChrome(autoHide: false)
            // The forced pause is the moment the question gets asked, so
            // it is the moment to say what answers it.
            if !firstHintShown, GestureHints.eligible(.score) {
                firstHintShown = true
                showHint(.score)
            }
            break
        }
    }

    /// Where a rally stops the video in score mode.
    func stopAt(_ p: MatchPoint) -> Double? {
        isUnscored(p)
            ? pauseEnd(p, pad, nextStart: nextCutStart(points, after: p))
            : paddedEnd(p, pad)
    }

    /// A game just closed under a live answer. The result is an announcement,
    /// not an event to acknowledge, so it goes through the same flash every
    /// other confirmation uses; the correction lives in the pad's boundary
    /// control, which reads "Didn't end" while this is fresh.
    ///
    /// Guarded on a recent tap because the running count also moves when the
    /// user SEEKS across a boundary, and navigating past a game end must
    /// never announce one.
    func watchGameBoundary() {
        let count = runningScore.games.count
        let previous = prevGamesCount
        prevGamesCount = count
        guard previous >= 0, count > previous, mode == .score else { return }
        guard Date().timeIntervalSince(lastScoreTapAt) < 1 else { return }
        let g = runningScore.games[count - 1]
        let closedAt = runningScore.boundaryAfter.first { $0.value.game == count }?.key
        let asked = closedAt != nil && closedAt == explicitEndPointId
        explicitEndPointId = nil
        if !asked, let closedAt {
            freshBoundary = FreshBoundary(pointId: closedAt, game: count, you: g.you, them: g.them)
            Task {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                if freshBoundary?.pointId == closedAt { freshBoundary = nil }
            }
        }
        showFlash("Game \(count) · \(g.you)-\(g.them)")
    }

    /// Chrome follows playback, not a toggle. Pausing always shows it —
    /// you stopped to do something. Playing shows it and then takes it away
    /// after a beat, so the footage is unobstructed while it runs and one
    /// tap brings it back.
    ///
    /// The old rule toggled on play, which inverted itself the moment
    /// anything paused the video without going through here (a note, a
    /// drawing, the end of the file): the bar was left hidden, and the next
    /// play SHOWED it mid-rally.
    func togglePlay() {
        if player.rate > 0 {
            player.pause()
            showChrome(autoHide: false)
        } else {
            play()
            showChrome(autoHide: true)
        }
    }

    /// Reveal the chrome, and schedule its exit when playback is running.
    func showChrome(autoHide: Bool) {
        withAnimation(.easeOut(duration: 0.18)) { chromeVisible = true }
        if autoHide { scheduleChromeHide() }
    }

    /// Take the chrome away 2.5s from now, unless something newer asks
    /// otherwise. The nonce is what makes the timer cancellable: a later
    /// reveal bumps it, and the older timer sees a stale value and does
    /// nothing — which is also what stops a scrub or a pause mid-countdown
    /// from being overruled a moment later.
    func scheduleChromeHide() {
        chromeNonce += 1
        let mine = chromeNonce
        Task {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            guard chromeNonce == mine, player.rate > 0, !scrubbing,
                  whyPoint == nil, !gesturesOpen
            else { return }
            withAnimation(.easeOut(duration: 0.25)) { chromeVisible = false }
        }
    }

    func play() {
        lastPlayAt = Date()
        runStartT = currentT
        endPausedId = nil
        lastTick = nil
        stallWatchT = -1
        player.play()
        if rate != 1 { player.rate = rate }
    }

    func seek(to seconds: Double) {
        lastTick = nil
        player.seek(
            to: CMTime(seconds: max(0, seconds), preferredTimescale: 600),
            toleranceBefore: .zero, toleranceAfter: .zero
        )
        currentT = max(0, seconds)
    }

    func step(_ direction: Int) {
        let withStarts = points.filter { $0.cutT0 != nil }
        guard !withStarts.isEmpty else { return }
        let currentId = playingPointId(points, at: currentT)
        var index: Int
        if let currentId, let i = withStarts.firstIndex(where: { $0.id == currentId }) {
            index = i + direction
        } else {
            index = direction > 0 ? 0 : withStarts.count - 1
        }
        index = max(0, min(withStarts.count - 1, index))
        let target = withStarts[index]
        guard let cutT0 = target.cutT0 else { return }
        endPausedId = nil
        seek(to: cutT0)
        play()
        if let n = points.firstIndex(of: target) {
            showFlash(direction > 0 ? "Next · point \(n + 1)" : "Back · point \(n + 1)")
        }
    }

    /// Teach one thing, once. The timer only clears the hint that raised
    /// it, so a later hint is never cut short by an earlier one's countdown.
    func showHint(_ next: GestureHint) {
        GestureHints.markShown(next)
        withAnimation(.easeOut(duration: 0.2)) { hint = next }
        Task {
            try? await Task.sleep(nanoseconds: 7_000_000_000)
            if hint == next { withAnimation { hint = nil } }
        }
    }

    /// The gesture was used for real, so its hint never shows again — on
    /// this open or any other.
    func retireHint(_ used: GestureHint) {
        GestureHints.markDone(used)
        if hint == used { withAnimation { hint = nil } }
    }

    func showFlash(_ message: String, seconds: Double = 1.2) {
        withAnimation { flash = message }
        Task {
            try? await Task.sleep(nanoseconds: UInt64(max(0.2, seconds) * 1_000_000_000))
            // A newer flash owns the slot by now; clearing it here would cut
            // the message the user is actually reading in half.
            if flash == message { withAnimation { flash = nil } }
        }
    }

    func timeString(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let s = Int(seconds.rounded())
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }
}

// MARK: - Analysis panel

/// The pad's Analysis door: everything you can record about the point
/// beyond who won it — the same questions the point sheet asks, sliding
/// over the pad so the video never goes anywhere (web's analysis variant).
/// The analysis panel: every follow-up question, plus a tag and a note, on
/// one point. A layer over the pad rather than a sheet — a card sliding up
/// from the bottom covers the picture, and the frame being judged is half
/// the reason the question is answerable at all.
struct PadAnalysisPanel: View {
    let match: MatchRow
    let model: MatchDetailModel
    let pointId: UUID
    let number: Int
    let reasonsStore: CustomReasonsStore
    let serving: [UUID: ServeInfo]
    var notesStore: NotesStore?
    var tagsStore: TagsStore?
    /// Sideways the phone is short and wide: the portrait stack wastes the
    /// width on long lines and doubles the scrolling, so the questions and
    /// the notes go side by side instead.
    var landscape = false
    let onClose: () -> Void

    @Environment(AppState.self) var app
    @State private var addingReason = false
    @State private var tagPickerOpen = false
    @State private var newReason = ""
    @State private var savingReason = false

    private var point: MatchPoint? {
        model.points.first { $0.id == pointId }
    }

    private var iServed: Bool? {
        guard let point else { return nil }
        guard let server = serving[point.id]?.server ?? point.displayServer else { return nil }
        return server == .user
    }

    @FocusState private var typing: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Point \(number)")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PL.text200)
                Spacer()
                Button("Done") { onClose() }
                    .buttonStyle(PLCyanGhostButtonStyle())
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .overlay(alignment: .bottom) {
                Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1)
            }
            ScrollView {
                if let point {
                    if landscape, asksQuestions(point) {
                        HStack(alignment: .top, spacing: 12) {
                            VStack(alignment: .leading, spacing: 18) { questions(point) }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            notesSection(point)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(14)
                    } else {
                        VStack(alignment: .leading, spacing: 18) {
                            questions(point)
                            notesSection(point)
                        }
                        .frame(maxWidth: landscape ? 560 : .infinity, alignment: .leading)
                        .frame(maxWidth: .infinity)
                        .padding(14)
                    }
                }
            }
            // Drag the content and the keyboard goes away, the way every
            // other scrolling form on the phone behaves. Without it the
            // composer sits under the keyboard with nothing to dismiss it.
            .scrollDismissesKeyboard(.interactively)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PL.ink)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { typing = false }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(PL.cyan)
            }
        }
    }

    /// A point you WON asks nothing, and an unscored one has no outcome to
    /// explain — so the two-column split would put an empty box beside the
    /// notes, which reads as something that failed to load.
    private func asksQuestions(_ p: MatchPoint) -> Bool {
        p.isLet || p.confirmedWinner == .opponent
    }

    @ViewBuilder
    private func questions(_ point: MatchPoint) -> some View {
        Group {
                    if point.isLet {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Why skip it?")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(PL.text200)
                            FlowLayout(spacing: 8) {
                                ForEach(SKIP_REASONS) { chip in
                                    chipView(
                                        chip.label,
                                        selected: canonicalSkipReason(point.confirmedHow) == chip.value
                                    ) {
                                        let next = canonicalSkipReason(point.confirmedHow) == chip.value
                                            ? nil : chip.value
                                        Task { await model.setSkipReason(point, next) }
                                    }
                                }
                            }
                        }
                    } else if point.confirmedWinner == .opponent {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Why did you lose it?")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(PL.text200)
                            if let iServed {
                                // Name the opponent rather than "they": on a
                                // match with a name set, "THEY SERVED" reads
                                // like the app forgot who it is watching.
                                Text(iServed ? "You served" : "\(match.opponentName ?? "They") served")
                                    .font(.plSection)
                                    .tracking(0.6)
                                    .textCase(.uppercase)
                                    .foregroundStyle(PL.text500)
                            }
                            FlowLayout(spacing: 8) {
                                ForEach(lossReasonsFor(iServed: iServed, custom: reasonsStore.reasons)) { chip in
                                    chipView(
                                        chip.label,
                                        selected: (point.lossReasons ?? []).contains(chip.value)
                                    ) {
                                        Task { await model.toggleReason(point, chip.value) }
                                    }
                                }
                                if !addingReason {
                                    Button {
                                        addingReason = true
                                    } label: {
                                        Text("Enter custom")
                                            .font(.system(size: 13, weight: .medium))
                                            .foregroundStyle(PL.text500)
                                            .padding(.horizontal, 14)
                                            .padding(.vertical, 8)
                                            .overlay(
                                                Capsule().strokeBorder(
                                                    PL.edge,
                                                    style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                                                )
                                            )
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            if addingReason {
                                HStack(spacing: 8) {
                                    TextField("Misread the pips", text: $newReason)
                                        .plField()
                                        .focused($typing)
                                        .onSubmit { Task { await submitNewReason(point) } }
                                    Button(savingReason ? "Adding…" : "Add") {
                                        Task { await submitNewReason(point) }
                                    }
                                    .buttonStyle(PLCyanGhostButtonStyle())
                                    .disabled(newReason.trimmingCharacters(in: .whitespaces).isEmpty)
                                }
                            }
                        }

                        if misreadKindApplies(point.lossReasons) {
                            question("What got you?", chips: MISREAD_KINDS, selected: point.misreadKind) { value in
                                Task { await model.setMisreadKind(point, point.misreadKind == value ? nil : value) }
                            }
                        }
                        if outOfPositionApplies(point.lossReasons) {
                            question("Where did they get you?", chips: DIRECTIONS, selected: point.direction) { value in
                                Task { await model.setDirection(point, point.direction == value ? nil : value) }
                            }
                        }
                        if serveApplies(point.lossReasons) {
                            VStack(alignment: .leading, spacing: 10) {
                                Text((point.lossReasons ?? []).contains("weak_serve")
                                    ? "Which serve did you play?"
                                    : "Which serve beat you?")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(PL.text200)
                                FlowLayout(spacing: 8) {
                                    ForEach(SERVE_SPINS) { chip in
                                        chipView(chip.label, selected: point.serveSpin == chip.value) {
                                            Task { await model.pickServeSpin(point, chip.value) }
                                        }
                                    }
                                    chipView("+ Sidespin", selected: point.serveSidespin == true) {
                                        Task { await model.toggleServeSidespin(point) }
                                    }
                                }
                                FlowLayout(spacing: 8) {
                                    ForEach(SERVE_LENGTHS) { chip in
                                        chipView(chip.label, selected: point.serveLength == chip.value) {
                                            Task {
                                                await model.setServeLength(
                                                    point,
                                                    point.serveLength == chip.value ? nil : chip.value
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else if point.confirmedWinner == .user {
                        Text("Points you won ask nothing. What you did right is not what a player comes back to a match to find out.")
                            .font(.plBody)
                            .foregroundStyle(PL.text500)
                    } else {
                        Text("Score the point first. The questions follow the outcome.")
                            .font(.plBody)
                            .foregroundStyle(PL.text500)
                    }

        }
    }

    /// Tags and the note thread, the second half of the web's panel. A point
    /// you won asks no questions, so without this the sheet would open on a
    /// single grey line and nothing to do.
    @ViewBuilder
    private func notesSection(_ point: MatchPoint) -> some View {
        if let notesStore, let uid = app.userId {
            VStack(alignment: .leading, spacing: 12) {
                Text("Notes")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PL.text200)
                if let tagsStore {
                    // Applied tags as chips, then one dashed pill to change
                    // them — the web's row. It said "Add to a pattern"
                    // before, which is the coach workspace's wording for a
                    // different job, and reading it here made a note-taking
                    // row look like somebody else's feature.
                    let applied = tagsStore.tags(for: point.id)
                    FlowLayout(spacing: 6) {
                        ForEach(applied) { tag in
                            Button { tagPickerOpen = true } label: {
                                Text(tag.label)
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(PL.cyan.opacity(0.9))
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 4)
                                    .background(PL.cyan.opacity(0.05), in: Capsule())
                                    .overlay(Capsule().strokeBorder(PL.cyan.opacity(0.4), lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                        }
                        Button { tagPickerOpen = true } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "tag").font(.system(size: 10))
                                Text(applied.isEmpty ? "Add tag" : "Edit")
                                    .font(.system(size: 11, weight: .medium))
                            }
                            .foregroundStyle(PL.text500)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .overlay(
                                Capsule().strokeBorder(
                                    PL.edge, style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                                )
                            )
                        }
                        .buttonStyle(.plain)
                    }
                    .sheet(isPresented: $tagPickerOpen) {
                        TagPickerSheet(
                            point: point, match: match,
                            tagsStore: tagsStore, userId: uid
                        )
                        .presentationDetents([.medium])
                        .presentationBackground(PL.surface)
                        .presentationDragIndicator(.visible)
                    }
                }
                let thread = notesStore.notes.filter { $0.pointId == point.id }
                if thread.isEmpty {
                    Text("No notes on this point yet.")
                        .font(.plBody)
                        .foregroundStyle(PL.text500)
                } else {
                    ForEach(thread) { note in
                        NoteItemView(
                            note: note, matchId: match.id, ownerId: match.userId,
                            viewerId: uid,
                            authorName: notesStore.authorNames[note.authorId],
                            notesStore: notesStore
                        )
                    }
                }
                NoteComposerView(
                    matchId: match.id, pointId: point.id, userId: uid,
                    notesStore: notesStore,
                    placeholder: "What did you notice?"
                )
            }
        }
    }

    private func submitNewReason(_ point: MatchPoint) async {
        let label = newReason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty, let uid = app.userId else { return }
        savingReason = true
        if let id = await reasonsStore.create(label: label, ownerId: uid) {
            newReason = ""
            addingReason = false
            await model.toggleReason(point, customReasonValue(id: id))
        }
        savingReason = false
    }

    private func question(
        _ text: String, chips: [ReasonChip], selected: String?,
        pick: @escaping (String) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(text)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(PL.text200)
            FlowLayout(spacing: 8) {
                ForEach(chips) { chip in
                    chipView(chip.label, selected: selected == chip.value) { pick(chip.value) }
                }
            }
        }
    }

    private func chipView(
        _ label: String, selected: Bool, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(selected ? PL.cyan : PL.text300)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(selected ? PL.cyan.opacity(0.15) : PL.ink.opacity(0.4), in: Capsule())
                .overlay(
                    Capsule().strokeBorder(selected ? PL.cyan.opacity(0.6) : PL.edge, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}
