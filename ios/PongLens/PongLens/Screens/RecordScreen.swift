import AVFoundation
import CoreMotion
import Supabase
import SwiftUI
import UIKit

/// The recorder's orientation, in one place because two screens need it.
///
/// The recorder needs landscape, and rotation lock stops the system
/// providing it — an app can still ask, and asking is what makes the
/// screen reachable at all for anyone who keeps the lock on.
///
/// The subtlety that cost two attempts: a geometry request made while a
/// presentation is moving is dropped on the floor. The recorder is opened
/// from a chooser sheet, so there is nearly always something moving. Hence
/// asking until the scene agrees rather than asking once, and hence the
/// presenter asking BEFORE it presents rather than the recorder asking
/// after it appears.
/// Isolation is explicit rather than inherited from
/// SWIFT_DEFAULT_ACTOR_ISOLATION: every call below is main-actor-only
/// UIKit, and a build setting is a long way from the code that depends
/// on it.
@MainActor
enum RecordOrientation {

    /// True while the recorder is actually on screen.
    ///
    /// The landscape allowance is claimed by the CHOOSER, before the
    /// recorder exists, and handed back by the recorder on its way out —
    /// two different screens. Every path where the first runs and the
    /// second never appears would pin the whole app to landscape with
    /// nothing left to unpin it, and the user would have no idea what
    /// they did. This is what lets the claim heal itself.
    private static var recorderIsUp = false
    private static var watchdog: Task<Void, Never>?

    static var isLandscape: Bool {
        scene?.interfaceOrientation.isLandscape ?? false
    }

    /// How far to turn a view so it reads upright to somebody holding the
    /// phone the normal way up, while the interface is pinned sideways.
    ///
    /// The record screen only ALLOWS landscape (see claim()), so a phone
    /// held upright still gets a landscape interface and everything in it
    /// runs down the screen instead of across it. That is fine for the
    /// viewfinder, which is the picture being filmed, and wrong for the
    /// one message that is addressed to somebody who has not turned the
    /// phone yet.
    ///
    /// The signs are the way round they are because they were CHECKED,
    /// not derived. Reading them off the camera preview's orientation
    /// table gives both of them backwards: videoRotationAngle turns one
    /// way and SwiftUI's rotationEffect turns the other, so the banner
    /// came out horizontal and upside down. Anything that touches this
    /// wants a real screenshot, not an argument about conventions.
    static var uprightFromLandscape: Double {
        switch scene?.interfaceOrientation {
        case .landscapeRight: -90
        case .landscapeLeft: 90
        default: 0
        }
    }

    private static var scene: UIWindowScene? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }.first
    }

    /// Ask for landscape until the scene agrees, or until `attempts` run
    /// out. Returns whether it took.
    ///
    /// Callers want different patience. Before presenting, the user is
    /// waiting on a tap, so four tries at 150 ms — about six tenths of a
    /// second at worst, and usually the first check. Once the recorder is
    /// up there is a cover over the screen, so it can afford to keep
    /// asking for longer.
    @discardableResult
    static func pinLandscape(attempts: Int = 4) async -> Bool {
        claim()
        for _ in 0..<max(1, attempts) {
            if isLandscape { return true }
            request(.landscape)
            try? await Task.sleep(for: .milliseconds(150))
        }
        return isLandscape
    }

    /// Turn upright and wait for it, for the details form.
    ///
    /// The mirror of pinLandscape and for the same reason: a window that
    /// resizes while something is already on screen looks broken. Going in,
    /// that something is a camera preview and it flickers; coming out, it is
    /// a form, and every field jumps as the keyboard and the layout resolve.
    /// Both are fixed by turning first and presenting second.
    ///
    /// No watchdog here. That net exists because the CHOOSER claims landscape
    /// for a recorder that might never appear; by this point the recorder is
    /// up and owns the allowance until it leaves.
    @discardableResult
    static func pinPortrait(attempts: Int = 4) async -> Bool {
        AppDelegate.allowedOrientations = .portrait
        for _ in 0..<max(1, attempts) {
            if !isLandscape { return true }
            request(.portrait)
            try? await Task.sleep(for: .milliseconds(150))
        }
        return !isLandscape
    }

    /// Take the allowance, and arm the net under it.
    private static func claim() {
        AppDelegate.allowedOrientations = .landscape
        watchdog?.cancel()
        watchdog = Task {
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled, !recorderIsUp else { return }
            // The recorder never arrived. Hand the scene back rather than
            // leave the app in a landscape nothing else will undo.
            release(heldSideways: false)
        }
    }

    /// The recorder is up and owns the allowance from here.
    static func recorderAppeared() {
        recorderIsUp = true
        watchdog?.cancel()
        watchdog = nil
    }

    /// Hand the scene back. A phone genuinely held sideways keeps what it
    /// has and lets auto-rotation decide; anything else returns to
    /// portrait, or the rest of the app inherits a landscape nobody asked
    /// for.
    static func release(heldSideways: Bool) {
        recorderIsUp = false
        watchdog?.cancel()
        watchdog = nil
        AppDelegate.allowedOrientations = .all
        request(heldSideways ? .all : .portrait)
    }

    private static func request(_ orientations: UIInterfaceOrientationMask) {
        guard let scene else { return }
        // The delegate's answer is cached until the controller is told to
        // ask for it again. Without this the scene keeps whatever it was
        // last pinned to and the request is quietly ignored — which left
        // the whole app in landscape after closing the recorder.
        scene.keyWindow?.rootViewController?
            .setNeedsUpdateOfSupportedInterfaceOrientations()
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: orientations))
    }
}

/// The badge that tells the room what is going on.
///
/// A phone on a tripod films the table with its screen facing back down
/// the hall, so the screen is a sign nobody was reading. Five minutes in
/// — long enough that the setup fiddling is over and this is a real match
/// — it becomes one.
///
/// Deliberately small and deliberately centred: the controls live on the
/// trailing edge, the banners at the top, the uploads shelf at the
/// bottom, so the middle is the one region nothing else claims. It is
/// also inert (`allowsHitTesting(false)` where it is placed), so even if
/// a future layout moves a control underneath it, the control still wins.
/// The permanent mark that filming is happening, top of the screen.
///
/// Up from the moment the shutter is pressed rather than five minutes in.
/// The old badge was a large centred card on a delay, which meant the one
/// thing it existed to say was absent for exactly as long as anyone was
/// still deciding whether the app was working.
struct RecordingStrip: View {
    var paused = false
    /// Somebody is at the phone right now, which is worth saying above
    /// everything else because it is the only feedback available while
    /// they are still speaking.
    var hearing = false

    @State private var live = false

    private var mark: Color {
        if paused { return PL.warningText }
        return hearing ? PL.cyan : PL.dangerFill
    }

    private var words: String {
        if paused { return "Recording paused" }
        return hearing ? "Listening" : "Recording in progress"
    }

    var body: some View {
        HStack(spacing: 9) {
            LogoMark(size: 18)
            HStack(spacing: 0) {
                Text("Pong").foregroundStyle(.white)
                Text("Lens").foregroundStyle(PL.cyan)
            }
            .font(.system(size: 14, weight: .semibold))
            .tracking(-0.3)

            Circle()
                .fill(mark)
                .frame(width: 6, height: 6)
                // The dot breathes; the strip does not. A sign that
                // pulses as a whole reads as a notification demanding
                // something, and this one is only stating a fact.
                .opacity(live && !hearing && !paused ? 0.35 : 1)
                .animation(.easeInOut(duration: 1.1)
                    .repeatForever(autoreverses: true), value: live)
                .animation(.easeOut(duration: 0.2), value: hearing)

            Text(words)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white.opacity(0.85))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
        .shadow(color: .black.opacity(0.3), radius: 12, y: 4)
        .onAppear { live = true }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("PongLens. \(words).")
    }
}

/// Games called out at the phone, as a scoreboard.
///
/// Two rows and a column per game, rather than a line per game: a match
/// can run to seven, and seven lines is a panel where seven columns is
/// still a strip. It also puts the two players' numbers directly above
/// and below each other, which is how a score is read anywhere else.
struct ScoreBoard: View {
    var scores: [SpokenGameScore]
    /// The user's own name when the account has one, "You" when it does
    /// not. The opponent has no name at this point in the flow — it is
    /// asked for after the recording stops — so that side is always
    /// "Opponent".
    var youLabel: String
    var missed: Int?
    /// What a tap on a game does. On the record screen it swaps the two
    /// numbers (the likeliest mistake mid-match, fixable blind); on the
    /// details sheet it opens the editor, because with both hands free
    /// the right correction is typing the real numbers.
    var onTap: ((Int) -> Void)?

    /// A number, or the mark for a game that was called out and never
    /// scored. Two question marks rather than "XX", which in a row of
    /// numbers can be read as twenty.
    static func cell(_ value: Int?) -> String {
        value.map(String.init) ?? "??"
    }

    static func won(_ mine: Int?, _ theirs: Int?) -> Bool {
        guard let mine, let theirs else { return false }
        return mine > theirs
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !scores.isEmpty { board }
            if let missed {
                Text("Didn't catch game \(missed). Say it again.")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(PL.warningText)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        // Material rather than a flat fill, because this one sits over a
        // live picture; the border is the app's own edge token, so it
        // still reads as the same family as the score pills.
        .background(.ultraThinMaterial, in: RoundedRectangle(
            cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.3), radius: 14, y: 5)
    }

    private var board: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                // Holds the game-number row's height, so the two name
                // labels sit exactly on their own numbers.
                // Bright, not muted: this board sits over a live
                // picture, and a grey label that reads fine on a dark
                // form vanishes against a sunlit hall.
                Text("Game")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.75))
                Text(youLabel).foregroundStyle(PL.cyan)
                Text("Opponent").foregroundStyle(PL.magentaSoft)
            }
            .font(.system(size: 13, weight: .medium))
            .lineLimit(1)

            ForEach(scores) { score in
                Button {
                    onTap?(score.game)
                } label: {
                    VStack(spacing: 5) {
                        Text("\(score.game)")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.75))
                        // Cyan is the user and magenta the opponent
                        // everywhere else a score is drawn — the pill on
                        // every match card, the stats table, the running
                        // score in the player. The loser of each game is
                        // dimmed rather than recoloured, so who took what
                        // reads without comparing digits and the two
                        // sides stay the colours they always are.
                        Text(ScoreBoard.cell(score.you))
                            .foregroundStyle(PL.cyan)
                            .opacity(ScoreBoard.won(score.you, score.them) ? 1 : 0.45)
                        Text(ScoreBoard.cell(score.them))
                            .foregroundStyle(PL.magentaSoft)
                            .opacity(ScoreBoard.won(score.them, score.you) ? 1 : 0.45)
                    }
                    .font(.system(size: 15, weight: .semibold))
                    .monospacedDigit()
                    .frame(minWidth: 22)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(score.known
                    ? "Game \(score.game). \(youLabel) \(ScoreBoard.cell(score.you)), opponent \(ScoreBoard.cell(score.them)). Tap to swap."
                    : "Game \(score.game), not captured.")
            }
        }
    }
}

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    /// Fired with the rotation the preview settles on, so the table
    /// check's frame tap always sees the same upright world.
    var onAngle: ((CGFloat) -> Void)? = nil

    final class PreviewView: UIView {
        override static var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
        var onAngle: ((CGFloat) -> Void)?

        override func layoutSubviews() {
            super.layoutSubviews()
            guard let connection = previewLayer.connection,
                  let orientation = window?.windowScene?.interfaceOrientation else { return }
            let angle: CGFloat = switch orientation {
            case .landscapeRight: 0
            case .landscapeLeft: 180
            case .portraitUpsideDown: 270
            default: 90
            }
            if connection.isVideoRotationAngleSupported(angle) {
                connection.videoRotationAngle = angle
            }
            onAngle?(angle)
        }
    }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        view.backgroundColor = .black
        view.onAngle = onAngle
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}
}

/// Reads the phone's attitude for the level line — "raised a little, not
/// tilted" is a placement rule, so the viewfinder shows it live.
@Observable
final class LevelMonitor {
    private let manager = CMMotionManager()
    /// Degrees off level in the current hold; 0 is a straight horizon.
    var rollDegrees: Double = 0

    /// Whether the phone is physically on its side, whatever the screen
    /// is doing. These two used to be assumed the same thing, and the
    /// screen's shape was the one being read — so with rotation lock on,
    /// the app believed a phone on a tripod was being held upright, hid
    /// the overlay, fed the table check sideways frames and held the
    /// shutter. Gravity does not care about the lock.
    var sideways = false

    /// False where there is no motion hardware — the simulator, and in
    /// principle anything without it. Callers fall back to the screen's
    /// shape there, which is the old behaviour and is the right answer
    /// whenever nothing better is available.
    var motionAvailable: Bool { manager.isDeviceMotionAvailable }

    /// False until the first reading lands. Without it the screen shows
    /// its default answer for a frame or two — "turn your phone sideways"
    /// at a phone already on its side — and a correction that fast reads
    /// as a glitch rather than an update.
    private(set) var hasReading = false

    func start() {
        guard manager.isDeviceMotionAvailable else { return }
        manager.deviceMotionUpdateInterval = 1 / 15
        manager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let self, let g = motion?.gravity else { return }
            let angle = atan2(g.x, g.y) * 180 / .pi
            let nearest = (angle / 90).rounded() * 90
            self.rollDegrees = angle - nearest
            // Lying flat, gravity is nearly all in z and the other two
            // axes are noise — that says nothing about the hold, so keep
            // the last answer rather than flickering.
            guard (g.x * g.x + g.y * g.y).squareRoot() > 0.3 else { return }
            self.hasReading = true
            // A margin either side of the diagonal, so a phone at roughly
            // 45 degrees settles instead of chattering between the two.
            if abs(g.x) > abs(g.y) + 0.15 { self.sideways = true }
            else if abs(g.y) > abs(g.x) + 0.15 { self.sideways = false }
        }
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
    }
}

/// The recording experience. Landscape is the format — portrait shows the
/// viewfinder but holds the shutter until the phone turns. The ghost draws
/// the SIDE-ON view the pipeline wants: filmed from the side of the table,
/// raised a little, the whole table in frame.
struct RecordScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(LibraryStore.self) private var library
    @Environment(Router.self) private var router
    /// Match or practice, chosen at the New match sheet. Read once here and
    /// handed down, so the recorder itself stays ignorant of the
    /// distinction: it films the same way either way.
    private var kind: MatchKind { router.recordKind }
    @Environment(AppState.self) private var app
    @State private var recorder = Recorder()
    @State private var level = LevelMonitor()
    @State private var settings = RecordSettings.load()
    @State private var settingsOpen = false
    /// Which overlay is drawn, at most one. See RecordOverlay.
    @State private var overlay: RecordOverlay = .ghost
    @State private var sessionId = UUID()
    @State private var draft = RecordingMetadata()
    @State private var metadataOpen = false
    @State private var cancelAsk = false
    /// Held shut until the screen is worth looking at. The cover is
    /// presented while the interface is still portrait and the rotation
    /// is asked for afterwards, so the window resizes with this screen
    /// already visible. A capture preview is a plain layer that does not
    /// resize with it, so for a few frames the picture is a
    /// portrait-width strip with black beside it and the controls sit
    /// where portrait left them. Better to hold the loading state that
    /// was already there than to show a broken-looking half screen.
    @State private var revealed = false
    /// The zoom a pinch started from, so the gesture is relative.
    @State private var zoomStart: Double?
    /// True once the recording has run long enough for the badge. Held in
    /// state rather than computed inline so the fade has something to
    /// animate, and so it cannot flicker on the second the clock crosses.
    @State private var listener = ScoreListener()
    /// The long-press debug readout of what the recogniser heard.
    @State private var showHeard = false
    /// "right" or "left" from the profile, nil until it answers (or if it
    /// never does — everything here degrades to the old behaviour).
    @State private var handedness: String?
    /// Mirrors of the ghost's own storage, so the wrong-side cue can stay
    /// quiet when the user has deliberately flipped against handedness.
    @AppStorage("pl-ghost-side") private var ghostRightSide = true
    @AppStorage("pl-ghost-side-chosen") private var ghostSideChosen = false

    private var queue: RecordingQueue { RecordingQueue.shared }

    var body: some View {
        GeometryReader { geo in
            let portrait = geo.size.height > geo.size.width
            ZStack {
                Color.black.ignoresSafeArea()

                switch recorder.state {
                case .ready, .recording:
                    #if targetEnvironment(simulator)
                    SimulatorViewfinder { angle in
                        recorder.setCaptureRotation(angle)
                    }
                    .ignoresSafeArea()
                    #else
                    CameraPreview(session: recorder.session) { angle in
                        recorder.setCaptureRotation(angle)
                    }
                    .ignoresSafeArea()
                    #endif
                    if overlay != .none, recorder.state == .ready,
                       heldSideways(screenIsPortrait: portrait) {
                        TableGhost(level: level.rollDegrees,
                                   session: recorder.session,
                                   preferredRightSide: handedness.map { $0 == "right" })
                            .ignoresSafeArea()
                    }
                case .denied:
                    permissionCard
                case .failed(let message):
                    Text(message)
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                        .padding(24)
                case .idle:
                    ProgressView().tint(PL.cyan)
                }

                if portrait {
                    portraitChrome(sideways: heldSideways(screenIsPortrait: true))
                } else {
                    landscapeChrome(sideways: heldSideways(screenIsPortrait: false))
                }

                // The one message meant for somebody who has NOT turned
                // the phone yet, so it is the one message that cannot be
                // drawn sideways. It sits in the middle of the screen and
                // turns to face them; the moment they do turn the phone
                // it has nothing left to say and goes.
                //
                // Deliberately outside statusBanners: rotated a quarter
                // turn its width becomes its height, and it would push
                // every other banner around the screen.
                if recorder.state == .ready,
                   !heldSideways(screenIsPortrait: portrait) {
                    banner("Turn your phone sideways to record.", tint: PL.cyan)
                        .rotationEffect(.degrees(
                            portrait ? 0 : RecordOrientation.uprightFromLandscape))
                        .transition(.opacity)
                        .animation(.easeOut(duration: 0.2), value: portrait)
                }

                if !revealed {
                    ZStack {
                        Color.black.ignoresSafeArea()
                        ProgressView().tint(PL.cyan)
                    }
                    .transition(.opacity)
                }
            }
            // Simultaneous, so the ghost's one-finger drag underneath
            // still gets its events. Two fingers zoom, one finger moves
            // the target, and neither has to know about the other.
            .simultaneousGesture(recorder.state == .ready ? zoomPinch : nil)
            .onAppear { settle(portrait: portrait) }
            .onChange(of: portrait) { _, _ in settle(portrait: portrait) }
            .onChange(of: recorder.state) { _, _ in settle(portrait: portrait) }
            .onChange(of: level.hasReading) { _, _ in settle(portrait: portrait) }
        }
        .alert("Discard this recording?", isPresented: $cancelAsk) {
            Button("Discard", role: .destructive) {
                recorder.cancel()
                queue.discardSession(sessionId)
            }
            Button("Keep recording", role: .cancel) {}
        } message: {
            Text("Nothing will be uploaded and the footage is deleted.")
        }
        .statusBarHidden()
        .onAppear {
            // Rotation lock stops the SYSTEM turning the interface; it
            // does not stop an app asking for the orientation it needs.
            // Without this a locked phone never leaves portrait, so the
            // record screen is a dead end for everyone who keeps the lock
            // on. The video player already does the same thing.
            //
            // Here rather than in the task below: this runs before the
            // first layout pass finishes, which covers most of the window
            // where the screen would otherwise be visibly resizing.
            RecordOrientation.recorderAppeared()
            Task { await RecordOrientation.pinLandscape() }
            // The door chosen at the New match sheet is an answer to the
            // Type question, so record it instead of asking again. Only
            // when nothing is set: a session reopened from the shelf
            // already carries the owner's own answer and must not have it
            // overwritten.
            if draft.matchType == nil { draft.matchType = kind.defaultType }
        }
        .task {
            // The chooser has usually done this already, in which case the
            // first check returns straight away. This is the belt to that
            // braces: the recorder is also reachable without the chooser
            // and must not depend on it.
            await RecordOrientation.pinLandscape(attempts: 14)
            // Whatever happened above, stop hiding shortly after it has.
            // Timed from the rotation rather than from appearing: the
            // first version counted 900 ms from here, the rotation
            // arrived later than that, and the cover came off in time to
            // show the very frame it existed to hide.
            try? await Task.sleep(for: .milliseconds(400))
            reveal()
        }
        .task {
            recorder.onSegment = { url, duration in
                queue.enqueue(
                    fileURL: url, durationS: duration, sessionId: sessionId,
                    metadata: draft,
                    processOn: kind.forcesProcessingOff ? false : settings.processAfterUpload,
                    placementOn: kind.forcesProcessingOff ? false : settings.placementMaps
                )
            }
            recorder.onSessionEnd = {
                // Hold before the sheet is even up: a short clip on fast
                // Wi-Fi can finish uploading before the sheet appears, and
                // it must not register with untouched fields.
                queue.holdCompletion(sessionId: sessionId)
                // Whatever was called out during the match, carried into
                // the sheet so it is confirmed rather than assumed.
                // Deliberately also when EMPTY: a non-nil empty list is
                // how the sheet knows the feature ran and offers manual
                // entry, which is the fallback for a match where the
                // phone heard nothing at all.
                if settings.callOutScore, hearsScores {
                    draft.spokenScores = listener.scores
                }
                // Filming is landscape; typing is not. The details sheet is
                // a form — opponent, venue, type — and a form in landscape
                // on a phone that has just come off a tripod is a row of
                // slots under a keyboard that owns most of the screen.
                //
                // Drop the cover first so the turn happens behind black
                // rather than across a live viewfinder, then present only
                // once the scene has actually come round. settle() will not
                // lift the cover while the screen is portrait, so it stays
                // down for the whole turn without needing to be told.
                Task {
                    revealed = false
                    await RecordOrientation.pinPortrait()
                    metadataOpen = true
                }
            }
            overlay = settings.overlay
            level.start()
            await recorder.configure(fps: settings.fps)
            await loadHandedness()
            // Before the shutter, never at it: the language pack is a
            // download and a club is the worst place to discover that.
            if settings.callOutScore, hearsScores { await listener.prepare() }
        }
        .onChange(of: recorder.state) { _, newState in
            if newState == .recording {
                startListening()
            } else {
                stopListening()
            }
        }
        // Held between points is exactly when people wander over and
        // chat next to the phone. Nothing said to a paused recording is
        // a score being reported.
        .onChange(of: recorder.isPaused) { _, paused in
            listener.suspended = paused
        }
        // Switched on mid-session: fetch the language pack now, while the
        // user is still looking at a settings screen, rather than at the
        // moment they press record.
        .onChange(of: settings.callOutScore) { _, on in
            if on, hearsScores { Task { await listener.prepare() } }
        }
        .onDisappear {
            // Hand the scene back. A phone genuinely held sideways keeps
            // what it has; anything else returns to portrait, or the rest
            // of the app inherits a landscape it never asked for.
            RecordOrientation.release(heldSideways: level.sideways)
            level.stop()
            recorder.teardown()
            // Never leave a completion hold behind; releasing twice is
            // harmless, leaking once strands the upload short of register.
            queue.releaseCompletion(sessionId: sessionId)
        }
        .sheet(isPresented: $settingsOpen) {
            RecordSettingsSheet(
                availableFrameRates:
                    recorder.supportedFrameRates(from: [30, 60]),
                settings: $settings, overlay: $overlay,
                offerScoreSetting: hearsScores
            ) { fps in
                // Apply to the live device. Rebuilding the session here is
                // what produced "the camera isn't available on this
                // device" on every frame-rate change.
                let got = recorder.setFrameRate(fps)
                if got != fps {
                    // Snap the picker back to what the camera is really
                    // doing; the banner says why.
                    settings.fps = got
                    settings.save()
                }
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $metadataOpen) {
            MatchDetailsSheet(
                sessionId: sessionId,
                draft: $draft,
                recentOpponents: library.recentValues(\.opponentName),
                recentVenues: library.recentValues(\.venue),
                kind: kind,
                processOn: kind.forcesProcessingOff ? false : settings.processAfterUpload,
                placementOn: kind.forcesProcessingOff ? false : settings.placementMaps
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .onAppear { queue.holdCompletion(sessionId: sessionId) }
            .onDisappear {
                queue.releaseCompletion(sessionId: sessionId)
                // The details sheet closing on a live session is the end
                // of this errand, the same as the upload flow: land in the
                // library, where the upload row and then the new match
                // card carry the story. A discarded session has no rows
                // and stays at the camera.
                if queue.items.contains(where: { $0.sessionId == sessionId }) {
                    recorder.teardown()
                    router.tab = .matches
                    router.recordOpen = false
                } else {
                    // Discarded, so this stays at the camera — and the
                    // camera needs the landscape that was handed back for
                    // the form. settle() lifts the cover on its own once
                    // the scene is sideways again.
                    Task { await RecordOrientation.pinLandscape() }
                }
            }
        }
    }

    // MARK: - Portrait: viewfinder visible, shutter held until landscape

    private func portraitChrome(sideways: Bool) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                elapsedPill
                Spacer()
                if recorder.state == .recording {
                    cancelButton
                } else {
                    ghostButton
                    settingsButton
                    closeButton
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)

            recordingStrip
            statusBanners(sideways: sideways)

            Spacer()

            HStack {
                scoreBoard
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)

            if recorder.state == .ready, !queue.active.isEmpty {
                uploadsShelf.padding(.horizontal, 16)
            }

            shutterRow(recordingAllowed: sideways)
                .padding(.bottom, 26)
        }
    }

    // MARK: - Landscape: camera-app layout, controls on the trailing edge

    private func landscapeChrome(sideways: Bool) -> some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                recordingStrip
                    .frame(maxWidth: .infinity)
                statusBanners(sideways: sideways)
                Spacer()
                scoreBoard
                    .padding(.bottom, 4)
                if recorder.state == .ready, !queue.active.isEmpty {
                    uploadsShelf
                        .frame(maxWidth: 420)
                        .padding(.bottom, 16)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 16)
            .padding(.top, 10)

            VStack(spacing: 18) {
                HStack(spacing: 10) {
                    if recorder.state == .recording {
                        cancelButton
                    } else {
                        ghostButton
                        settingsButton
                        closeButton
                    }
                }
                Spacer()
                sideSlot.frame(width: Self.slotWidth)
                shutter(recordingAllowed: sideways)
                Color.clear.frame(width: Self.slotWidth, height: 44)
                Spacer()
                elapsedPill
                    .frame(minHeight: 30)
            }
            .padding(.trailing, 16)
            .padding(.vertical, 14)
        }
    }

    /// Width of the slot on either side of the shutter. Fixed, because
    /// the zoom pill grows with the number of lenses and the shutter must
    /// stay in the middle of the screen regardless.
    private static let slotWidth: CGFloat = 132

    /// The slot beside the shutter: zoom while idle, pause while recording.
    @ViewBuilder
    private var sideSlot: some View {
        if recorder.state == .recording {
            pauseButton
        } else if recorder.zoomAvailable {
            zoomPill
        } else {
            Color.clear.frame(width: 44, height: 44)
        }
    }

    // MARK: - Shared chrome pieces

    @ViewBuilder
    private func statusBanners(sideways: Bool) -> some View {
        VStack(spacing: 8) {
            if recorder.thermalWarning {
                banner("The phone is running hot. Recording continues, but give it some shade if you can.", tint: PL.warningText)
            }
            if let note = recorder.interruptionNote {
                banner(note, tint: PL.warningText)
            }
            if let note = recorder.frameRateNote {
                banner(note, tint: PL.warningText)
            }
            // Turning the setting on and getting nothing, with no reason
            // given, is the worst version of this feature. Say why once.
            if settings.callOutScore, hearsScores, let note = listener.unavailable {
                banner("Calling out the score isn't working. \(note)",
                       tint: PL.warningText)
            }
            if recorder.state == .recording, !recorder.isPaused {
                let remaining = Recorder.maxSegmentS - recorder.elapsed
                if remaining <= 60 {
                    banner(
                        "Rolling to a new file in 0:\(String(format: "%02d", Int(max(0, remaining)))). Recording continues without a break.",
                        tint: PL.cyan
                    )
                }
            }
            if recorder.state == .ready, let block = recorder.preflightBlock {
                banner(block, tint: PL.dangerText)
            } else if recorder.state == .ready, recorder.lowBattery {
                banner("Battery is under 20%. A full match takes about 15%, so plug in if you can.", tint: PL.warningText)
            }
        }
    }

    @ViewBuilder
    private var elapsedPill: some View {
        if recorder.state == .recording {
            HStack(spacing: 8) {
                if recorder.isPaused {
                    Image(systemName: "pause.fill")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(PL.warningText)
                } else {
                    Circle().fill(PL.dangerFill).frame(width: 8, height: 8)
                }
                Text(recorder.isPaused ? "Paused · \(elapsedString)" : elapsedString)
                    .font(.system(size: 14, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                if recorder.segment > 1 {
                    Text("Part \(recorder.segment)")
                        .font(.plMicro)
                        .foregroundStyle(PL.text400)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(PL.ink.opacity(0.7), in: Capsule())
        }
    }

    private var settingsButton: some View {
        Button {
            settingsOpen = true
        } label: {
            Image(systemName: "gearshape")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(PL.text200)
                .frame(width: 44, height: 44)
                .background(PL.ink.opacity(0.7), in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(recorder.state == .recording)
        .opacity(recorder.state == .recording ? 0 : 1)
    }

    private var closeButton: some View {
        Button {
            recorder.teardown()
            dismiss()
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(PL.text300)
                .frame(width: 44, height: 44)
                .background(PL.ink.opacity(0.7), in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(recorder.state == .recording)
        .opacity(recorder.state == .recording ? 0.3 : 1)
    }

    /// During a recording the X means "throw this away", behind a
    /// confirmation. Closing the screen comes back once the camera stops.
    private var cancelButton: some View {
        Button {
            cancelAsk = true
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(PL.text300)
                .frame(width: 44, height: 44)
                .background(PL.ink.opacity(0.7), in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Discard the recording")
    }

    private var pauseButton: some View {
        Button {
            if recorder.isPaused {
                recorder.resume()
            } else {
                recorder.pause()
            }
        } label: {
            Image(systemName: recorder.isPaused ? "play.fill" : "pause.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(recorder.isPaused ? PL.ink : .white)
                .frame(width: 44, height: 44)
                .background(
                    recorder.isPaused ? AnyShapeStyle(.white) : AnyShapeStyle(PL.ink.opacity(0.7)),
                    in: Circle()
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(recorder.isPaused ? "Resume recording" : "Pause recording")
    }

    /// The Camera app's row of lens buttons, built from the lenses this
    /// phone actually has.
    private var zoomPill: some View {
        HStack(spacing: 3) {
            ForEach(recorder.zoomSteps, id: \.self) { step in
                let picked = abs(recorder.displayZoom - step) < 0.03
                Button {
                    recorder.setDisplayZoom(step)
                } label: {
                    Text(Self.zoomLabel(step))
                        .font(.system(size: 12, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(picked ? PL.cyan : PL.text200)
                        .frame(width: 36, height: 34)
                        .background(picked ? PL.ink : .clear, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Zoom \(Self.zoomLabel(step))")
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 4)
        .background(PL.ink.opacity(0.7), in: Capsule())
    }

    /// Pinch the viewfinder to zoom, between the same ends the buttons
    /// offer. Spread to come closer, exactly as every camera does.
    ///
    /// The ends are the buttons' ends on purpose: past the phone's
    /// longest real lens there is nothing left but a crop of the picture
    /// it already has, and this footage goes to a detector that needs the
    /// ball. A wall at a number the user can see beats a range that
    /// quietly stops being worth using.
    private var zoomPinch: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let steps = recorder.zoomSteps
                guard recorder.zoomAvailable,
                      let low = steps.first, let high = steps.last else { return }
                if zoomStart == nil { zoomStart = recorder.displayZoom }
                let next = (zoomStart ?? 1) * value.magnification
                recorder.setDisplayZoom(min(max(next, low), high))
            }
            .onEnded { _ in zoomStart = nil }
    }

    /// Whole numbers lose the decimal, everything else keeps one.
    private static func zoomLabel(_ value: Double) -> String {
        abs(value - value.rounded()) < 0.05
            ? "\(Int(value.rounded()))x"
            : String(format: "%.1fx", value)
    }

    /// Choosing an overlay turns the other one off, because the setting
    /// holds one value. Tapping the one already on turns it off.
    private func chooseOverlay(_ mode: RecordOverlay) {
        overlay = overlay == mode ? .none : mode
        settings.overlay = overlay
        settings.save()
    }

    private var ghostButton: some View {
        overlayButton(
            mode: .ghost,
            symbol: "rectangle.dashed",
            on: "Hide the placement guide",
            off: "Show the placement guide")
    }

    private func overlayButton(mode: RecordOverlay, symbol: String,
                               on: String, off: String) -> some View {
        let active = overlay == mode
        return Button {
            chooseOverlay(mode)
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(active ? PL.cyan : PL.text300)
                .frame(width: 44, height: 44)
                .background(PL.ink.opacity(0.7), in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(active ? on : off)
    }

    /// Lift the cover once there is nothing left to hide: the scene has
    /// finished rotating, the camera has answered, and the phone has said
    /// which way it is being held. Any one of those arriving late is a
    /// visible correction, so wait for all three.
    private func settle(portrait: Bool) {
        guard !portrait,
              recorder.state != .idle,
              level.hasReading || !level.motionAvailable else { return }
        reveal()
    }

    private func reveal() {
        guard !revealed else { return }
        withAnimation(.easeOut(duration: 0.2)) { revealed = true }
    }

    /// How the phone is actually held. Gravity when the hardware can
    /// say, the screen's shape when it cannot.
    private func heldSideways(screenIsPortrait: Bool) -> Bool {
        #if targetEnvironment(simulator)
        // There is no motion hardware and no way to turn the "phone", so
        // both branches below answer "held upright" and the placement
        // guide never draws — which is the one thing the landing video's
        // recorder shot has to show. A phone filming a match is on its
        // side; say so. Device builds do not compile this.
        return true
        #else
        return level.motionAvailable ? level.sideways : !screenIsPortrait
        #endif
    }

    /// Five minutes of actual recording, and not while paused: the badge
    /// says "recording in progress" and must not be able to say it over a
    /// stopped picture. Reads the session clock rather than `elapsed`,
    /// which resets to zero every time the file rolls at 45 minutes.
    /// Only a match has games to call a score for. Drills and practice
    /// are not played to a score and nobody is keeping one, so the setting
    /// is not offered behind that door at all — an option that could never
    /// do anything is worse than a missing one. Speaking notes during a
    /// practice session is a different feature and wants its own words.
    private var hearsScores: Bool {
        if case .match = kind { return true }
        return false
    }

    /// The user's own name for the scoreboard, when the account has one.
    ///
    /// Falls back to "You" for an account with no name, and for a name
    /// long enough to stretch the label column wider than the scores
    /// beside it — the board has to stay a strip in the corner.
    private var youLabel: String {
        let name = app.firstName
        guard name != "player", name.count <= 10 else { return "You" }
        return name.prefix(1).uppercased() + name.dropFirst()
    }

    @ViewBuilder
    private var recordingStrip: some View {
        if recorder.state == .recording {
            VStack(spacing: 6) {
                RecordingStrip(paused: recorder.isPaused,
                               hearing: listener.hearing)
                    .onLongPressGesture(minimumDuration: 0.6) {
                        withAnimation(.easeOut(duration: 0.2)) {
                            showHeard.toggle()
                        }
                    }
                // The debug view of what the recogniser produced for
                // approaches that captured nothing. Deliberately hidden
                // behind a long-press: bystanders' speech does not belong
                // on a recording screen, but without any record of what
                // was heard, every mishearing in a hall is unfixable
                // guesswork. In memory only, never uploaded, gone when
                // the screen closes.
                if showHeard, settings.callOutScore {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Heard, not captured — debug, not saved")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(PL.text500)
                        if listener.heardLog.isEmpty {
                            Text("Nothing yet.")
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(PL.text400)
                        }
                        ForEach(listener.heardLog.suffix(5).reversed(),
                                id: \.self) { line in
                            Text(line)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(.white.opacity(0.7))
                                .lineLimit(2)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: 340, alignment: .leading)
                    .background(Color.black.opacity(0.6), in: RoundedRectangle(
                        cornerRadius: 12, style: .continuous))
                    .transition(.opacity)
                }
            }
            .transition(.opacity)
        }
    }

    @ViewBuilder
    private var scoreBoard: some View {
        if recorder.state == .recording,
           !listener.scores.isEmpty || listener.missedGame != nil {
            ScoreBoard(scores: listener.scores,
                       youLabel: youLabel,
                       missed: listener.missedGame,
                       onTap: { listener.swapSides(game: $0) })
                .transition(.opacity.combined(with: .scale(scale: 0.97)))
        }
    }

    private func startListening() {
        guard settings.callOutScore, hearsScores else { return }
        // A fresh match gets a fresh board. The old scores were handed to
        // the previous session's details sheet when it stopped; leaving
        // them here painted last match's scoreboard over this one.
        listener.beginSession()
        guard recorder.audioTapReady else {
            listener.reportNoMicrophone()
            return
        }
        Task {
            await listener.start()
            guard listener.running else { return }
            recorder.onAudioBuffer = { [listener] buffer in
                listener.ingest(buffer)
            }
        }
    }

    private func stopListening() {
        recorder.onAudioBuffer = nil
        listener.stop()
    }

    /// The profile's handedness, fetched once per open. RLS scopes the
    /// select to the signed-in user, same as the Account screen.
    private func loadHandedness() async {
        struct Row: Decodable { var handedness: String? }
        let rows: [Row]? = try? await supa
            .from("player_profiles")
            .select("handedness")
            .execute().value
        handedness = rows?.first?.handedness
    }

    private func shutterRow(recordingAllowed: Bool) -> some View {
        HStack(spacing: 22) {
            sideSlot.frame(width: Self.slotWidth)
            shutter(recordingAllowed: recordingAllowed)
            Color.clear.frame(width: Self.slotWidth, height: 44)
        }
    }

    private func shutter(recordingAllowed: Bool) -> some View {
        let enabled = recorder.state == .recording
            || (recorder.state == .ready && recorder.preflightBlock == nil && recordingAllowed)
        return Button {
            if recorder.state == .recording {
                recorder.stop()
            } else {
                sessionId = UUID()
                draft = RecordingMetadata(
                    venue: UserDefaults.standard.string(forKey: "pl-last-venue")
                )
                recorder.start()
            }
        } label: {
            ZStack {
                Circle()
                    .strokeBorder(.white.opacity(enabled ? 0.9 : 0.35), lineWidth: 4)
                    .frame(width: 74, height: 74)
                if recorder.state == .recording {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(PL.dangerFill)
                        .frame(width: 30, height: 30)
                } else {
                    Circle()
                        .fill(PL.dangerFill.opacity(enabled ? 1 : 0.35))
                        .frame(width: 60, height: 60)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    private func banner(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.plCaption)
            .foregroundStyle(tint)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(PL.ink.opacity(0.75), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .padding(.horizontal, 24)
    }

    private var elapsedString: String {
        let s = Int(recorder.elapsed)
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    // MARK: - Uploads shelf

    private var uploadsShelf: some View {
        VStack(spacing: 8) {
            ForEach(queue.active.prefix(3)) { item in
                RecordingUploadRow(item: item, compact: true)
            }
        }
    }

    private var permissionCard: some View {
        VStack(spacing: 12) {
            Text("PongLens needs the camera to film your match.")
                .font(.plBody)
                .foregroundStyle(PL.text300)
                .multilineTextAlignment(.center)
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .buttonStyle(PLPrimaryButtonStyle())
        }
        .padding(24)
    }
}

// MARK: - Upload row (shared with the Matches banner)

/// One recording on its way up: state, progress, and the failure actions.
struct RecordingUploadRow: View {
    let item: QueuedRecording
    var compact = false

    private var queue: RecordingQueue { RecordingQueue.shared }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 13))
                .foregroundStyle(tint)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.text100)
                Text(detail)
                    .font(.plMicro)
                    .foregroundStyle(tint)
            }
            Spacer()
            if item.state == .failed {
                Button("Retry") { queue.retry(item.id) }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.cyan)
                    .buttonStyle(.plain)
            } else if item.state == .uploading, item.totalBytes > 0 {
                Text("\(Int(Double(item.uploadedBytes) / Double(item.totalBytes) * 100))%")
                    .font(.plMicro)
                    .monospacedDigit()
                    .foregroundStyle(PL.text400)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            compact ? AnyShapeStyle(PL.ink.opacity(0.75)) : AnyShapeStyle(PL.surface),
            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
        )
        .overlay {
            if !compact {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            }
        }
    }

    private var icon: String {
        switch item.state {
        case .failed: "exclamationmark.triangle"
        case .finishing: "checkmark.circle"
        default: "arrow.up.circle"
        }
    }

    private var tint: Color {
        item.state == .failed ? PL.warningText : PL.cyan
    }

    private var title: String {
        let minutes = max(1, Int(item.durationS / 60))
        return "\(minutes) min recording · \(ByteCountFormatter.string(fromByteCount: item.totalBytes, countStyle: .file))"
    }

    private var detail: String {
        switch item.state {
        case .preparing: "Getting ready to upload"
        case .uploading: "Uploading. It keeps going with the app closed."
        case .finishing: "Almost there"
        case .failed: item.errorMessage ?? "Upload failed. The footage is safe on this phone."
        case .done: "Uploaded"
        }
    }
}

// MARK: - Settings (a real Form, the way iOS settings read)

private struct RecordSettingsSheet: View {
    /// What the live camera says it can carry. Asked of the device rather
    /// than assumed, because a 1080p format that tops out at 30 is common
    /// enough that offering 60 regardless is a promise we cannot keep.
    let availableFrameRates: [Int]
    @Binding var settings: RecordSettings
    @Binding var overlay: RecordOverlay
    /// Matches only. See RecordScreen.hearsScores.
    let offerScoreSetting: Bool
    let onFrameRateChange: (Int) -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Frame rate", selection: Binding(
                        get: { settings.fps },
                        set: {
                            settings.fps = $0
                            settings.save()
                            onFrameRateChange($0)
                        }
                    )) {
                        // Only what this phone can actually deliver. An
                        // option that silently records something else is
                        // worse than an option that is not there.
                        ForEach(availableFrameRates, id: \.self) { rate in
                            Text("\(rate) fps").tag(rate)
                        }
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    Text("30 fps is what the pipeline is tuned for. 60 makes smoother slow motion at twice the file size.")
                }

                Section {
                    Picker("Overlay", selection: Binding(
                        get: { settings.overlay },
                        set: { settings.overlay = $0; overlay = $0; settings.save() }
                    )) {
                        Text("None").tag(RecordOverlay.none)
                        Text("Placement guide").tag(RecordOverlay.ghost)
                    }
                    Toggle("Upload on Wi-Fi only", isOn: Binding(
                        get: { settings.wifiOnlyUploads },
                        set: { settings.wifiOnlyUploads = $0; settings.save() }
                    ))
                } footer: {
                    Text("With Wi-Fi only on, recordings wait in the queue until the phone is on Wi-Fi.")
                }

                Section {
                    Toggle("Process when the upload finishes", isOn: Binding(
                        get: { settings.processAfterUpload },
                        set: { settings.processAfterUpload = $0; settings.save() }
                    ))
                    Toggle("Placement maps", isOn: Binding(
                        get: { settings.placementMaps },
                        set: { settings.placementMaps = $0; settings.save() }
                    ))
                } footer: {
                    Text("Video records at 1080p HEVC. A 45-minute match is about 2 GB at 30 fps.")
                }

                if offerScoreSetting {
                    Section {
                        Toggle("Call out the score", isOn: Binding(
                            get: { settings.callOutScore },
                            set: { settings.callOutScore = $0; settings.save() }
                        ))
                    } footer: {
                        // The phrase is spelled out because it has to be
                        // said exactly, and the example comes from the
                        // parser itself so the instruction cannot drift
                        // away from what is actually accepted.
                        Text("At the end of a game, step close to the phone and say \"\(SpokenScore.examplePhrase())\". The score appears on screen, and you can tap it to swap the two numbers round. The phone only listens while someone is close to it, and only the score is kept.")
                    }
                }
            }
            .tint(PL.cyan)
            .navigationTitle("Recording")
            .navigationBarTitleDisplayMode(.inline)
        }
        .preferredColorScheme(.dark)
    }
}

// MARK: - Match details (upload already running underneath)

/// The one sheet both flows share: a recording that just stopped and a
/// video picked from the library land here, over their running upload.
struct MatchDetailsSheet: View {
    let sessionId: UUID
    @Binding var draft: RecordingMetadata
    let recentOpponents: [String]
    let recentVenues: [String]

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @State private var poster: UIImage?
    /// The video's displayed shape. The track answers this long before a
    /// frame decodes, so the box is already the right shape and the row
    /// does not jump from landscape to portrait when the picture lands.
    @State private var posterAspect: CGFloat = 16 / 9
    @State private var discardAsk = false
    @State private var processOn: Bool
    @State private var placementOn: Bool
    @State private var minutesBalance: Int?

    private var queue: RecordingQueue { RecordingQueue.shared }

    /// Which door this recording came through, or nil when there was no
    /// door. Recording knows in advance; UPLOADING cannot, so it offers
    /// every type and lets the answer drive the toggles instead.
    ///
    /// This was `let kind: MatchKind` with a `.match` default, which meant
    /// the upload path silently lost Practice and Drills from its Type
    /// list — the regression this optional exists to prevent.
    let kind: MatchKind?

    private let settingsProcessDefault: Bool
    private let settingsPlacementDefault: Bool

    private var offeredTypes: [String] {
        kind?.types ?? (MatchKind.match.types + MatchKind.practice.types)
    }

    /// Serve rotation is not followed in drills, so asking who served
    /// first is asking for a number nobody has. Keyed on the type in the
    /// draft rather than on `kind`, so switching the picker to Match here
    /// brings the question back without leaving the sheet.
    private var tracksServe: Bool {
        MatchTitle.tracksServe(draft.matchType)
    }

    init(
        sessionId: UUID,
        draft: Binding<RecordingMetadata>,
        recentOpponents: [String],
        recentVenues: [String],
        kind: MatchKind? = nil,
        processOn: Bool,
        placementOn: Bool
    ) {
        self.sessionId = sessionId
        self._draft = draft
        self.recentOpponents = recentOpponents
        self.recentVenues = recentVenues
        self.kind = kind
        self._processOn = State(initialValue: processOn)
        self._placementOn = State(initialValue: placementOn)
        // What the owner's Record settings said on the way in. Switching the
        // Type from Practice back to Match restores THIS rather than a
        // hardcoded true, so the setting keeps meaning something.
        self.settingsProcessDefault = processOn
        self.settingsPlacementDefault = placementOn
    }

    var body: some View {
        PLSheetScaffold(title: "Match details") {
            Form {
                Section {
                    progressRow
                }

                // Above Processing on purpose: this is the moment the
                // score gets typed into a league app, and it is the last
                // screen before the recording disappears into the queue.
                // The microphone can fail — a loud hall, a mumbled
                // number — so this is also where hands take over: tap a
                // game to type the real numbers, add one the phone never
                // heard, remove one it invented.
                if let spoken = draft.spokenScores {
                    Section {
                        if !spoken.isEmpty {
                            ScoreBoard(scores: spoken,
                                       youLabel: youLabel,
                                       missed: nil,
                                       onTap: { game in
                                           spokenEdit = SpokenEditTarget(game: game)
                                       })
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .listRowInsets(EdgeInsets(top: 10, leading: 12,
                                                          bottom: 10, trailing: 12))
                                .listRowBackground(Color.clear)
                        }
                        if spoken.count < SpokenScore.maxGame {
                            Button {
                                spokenEdit = SpokenEditTarget(game: nil)
                            } label: {
                                Text("Add a game")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(PL.cyan)
                            }
                        }
                    } header: {
                        Text("Spoken score")
                    } footer: {
                        Text(spoken.contains { !$0.known }
                             ? "What you called out during the match. A game showing ?? was heard but not understood. Tap a game to type it in."
                             : spoken.isEmpty
                             ? "Nothing was caught this match. You can add the games by hand."
                             : "What you called out during the match. Tap a game to correct it.")
                    }
                }

                Section {
                    Toggle("Process when the upload finishes", isOn: $processOn)
                    Toggle("Placement maps", isOn: $placementOn)
                        .disabled(!processOn)
                } header: {
                    Text("Processing")
                } footer: {
                    Text(processingFootnote)
                }

                Section {
                    entryRow("Opponent", text: opponentBinding, options: recentOpponents)
                    entryRow("Club or location", text: venueBinding, options: recentVenues)
                    Picker("Type", selection: typeBinding) {
                        Text("Not set").tag("")
                        ForEach(offeredTypes, id: \.self) { value in
                            Text(MatchTitle.typeLabel[value] ?? value).tag(value)
                        }
                    }
                } footer: {
                    Text("The upload is already running. Fill in what you know and close this whenever.")
                }

                Section {
                    sidePicker
                        .listRowInsets(EdgeInsets(top: 10, leading: 10, bottom: 10, trailing: 10))
                } header: {
                    Text("Your side")
                } footer: {
                    Text("Tap the side you played at the start of the video. Players swap ends between games, so this is about the first game only.")
                }

                if tracksServe {
                    Section {
                        firstServerPicker
                    } header: {
                        Text("Who served first")
                    } footer: {
                        Text("Skip this if you don't remember. A wrong answer puts the serve on the wrong player for the whole match.")
                    }
                }

                Section {
                    // Centred, like every other standalone action row in
                    // the app. A destructive row left-aligned in a form
                    // reads as one more setting.
                    Button(role: .destructive) {
                        discardAsk = true
                    } label: {
                        Text("Discard recording")
                            .frame(maxWidth: .infinity, alignment: .center)
                    }
                }
            }
            .alert("Discard this recording?", isPresented: $discardAsk) {
                Button("Discard", role: .destructive) {
                    queue.discardSession(sessionId)
                    dismiss()
                }
                Button("Keep uploading", role: .cancel) {}
            } message: {
                Text("The upload stops and the footage is deleted.")
            }
            .plKeyboardDismiss()
        }
        .sheet(item: $spokenEdit) { target in
            spokenEditorSheet(target)
        }
        .task { await loadPoster() }
        .task {
            struct ProcessingRow: Decodable {
                let minutesBalance: Double?
                enum CodingKeys: String, CodingKey { case minutesBalance = "minutes_balance" }
            }
            let rows: [ProcessingRow]? = try? await supa
                .rpc("my_processing_state").execute().value
            minutesBalance = rows?.first?.minutesBalance.map(Int.init)
        }
        .onChange(of: processOn) { pushProcessing() }
        .onChange(of: placementOn) { pushProcessing() }
        // The Type answer is the only thing that knows whether this footage
        // is worth processing minutes, and on the upload path it arrives
        // AFTER the toggles were set. So the toggles follow it: choosing
        // Practice or Drills turns them off, choosing a match type restores
        // the owner's Record settings. Set as defaults, not locks — the
        // owner can turn either back on straight afterwards.
        .onChange(of: draft.matchType) { _, next in
            let tracked = MatchTitle.tracksServe(next)
            processOn = tracked ? settingsProcessDefault : false
            placementOn = tracked ? settingsPlacementDefault : false
            // Answering "who served first" and THEN switching to Practice
            // hid the section but kept the answer, so the row was written
            // with a first server that nothing will ever read. Drop it
            // with the question.
            if !tracked { draft.firstServer = nil }
        }
        // A recording still merging when the sheet opened enqueues late;
        // re-apply the choices the moment its rows exist.
        .onChange(of: sessionCount) { pushProcessing() }
    }

    private var sessionCount: Int {
        queue.items.count { $0.sessionId == sessionId }
    }

    private var processingFootnote: String {
        if !processOn {
            return "The video just lands in your library. You can process it any time from the match page."
        }
        let session = queue.items.filter { $0.sessionId == sessionId }
        let charge = session.reduce(0) { $0 + max(1, Int(ceil($1.durationS / 60))) }
        var text = charge > 0
            ? "Uses \(charge) minute\(charge == 1 ? "" : "s") of your balance."
            : "Its length in minutes comes off your balance."
        if let minutesBalance {
            text += " You have \(minutesBalance)."
        }
        if placementOn {
            text += " Placement maps show where every ball landed and add processing time."
        }
        return text
    }

    /// Which spoken game the editor is open for; nil game means adding.
    @State private var spokenEdit: SpokenEditTarget?

    /// The uploader's own first name for the board's top row, matching the
    /// record screen. "You" when the account has no name to use.
    private var youLabel: String {
        let name = app.firstName
        guard name != "player", name.count <= 10 else { return "You" }
        return name.prefix(1).uppercased() + name.dropFirst()
    }

    private func saveSpoken(game: Int, you: Int, them: Int) {
        var rows = draft.spokenScores ?? []
        rows.removeAll { $0.game == game }
        rows.append(SpokenGameScore(game: game, you: you, them: them))
        rows.sort { $0.game < $1.game }
        draft.spokenScores = rows
        pushDraft()
    }

    private func removeSpoken(game: Int) {
        var rows = draft.spokenScores ?? []
        rows.removeAll { $0.game == game }
        draft.spokenScores = rows
        pushDraft()
    }

    private func pushProcessing() {
        queue.updateProcessing(sessionId: sessionId, process: processOn, placement: placementOn && processOn)
    }

    // MARK: - Fields

    private var opponentBinding: Binding<String> {
        Binding(
            get: { draft.opponent ?? "" },
            set: {
                draft.opponent = $0.isEmpty ? nil : $0
                pushDraft()
            }
        )
    }

    private var venueBinding: Binding<String> {
        Binding(
            get: { draft.venue ?? "" },
            set: {
                draft.venue = $0.isEmpty ? nil : $0
                UserDefaults.standard.set($0, forKey: "pl-last-venue")
                pushDraft()
            }
        )
    }

    private var typeBinding: Binding<String> {
        Binding(
            get: { draft.matchType ?? "" },
            set: {
                draft.matchType = $0.isEmpty ? nil : $0
                pushDraft()
            }
        )
    }

    /// A field you can type into, with the recent answers one tap away
    /// behind the chevron.
    private func entryRow(
        _ placeholder: String, text: Binding<String>, options: [String]
    ) -> some View {
        HStack(spacing: 10) {
            TextField(placeholder, text: text)
            if !options.isEmpty {
                Menu {
                    ForEach(options, id: \.self) { value in
                        Button(value) { text.wrappedValue = value }
                    }
                } label: {
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PL.text400)
                        .frame(width: 30, height: 30)
                        .contentShape(Rectangle())
                }
            }
        }
    }

    // MARK: - Upload progress

    @ViewBuilder
    private var progressRow: some View {
        let session = queue.items.filter { $0.sessionId == sessionId }
        if session.isEmpty {
            HStack(spacing: 12) {
                ProgressView().tint(PL.cyan)
                Text("Saving the recording")
                    .font(.plBody)
                    .foregroundStyle(PL.text300)
            }
        } else {
            let total = session.reduce(Int64(0)) { $0 + $1.totalBytes }
            let sent = session.reduce(Int64(0)) { $0 + $1.uploadedBytes }
            let done = session.allSatisfy { $0.state == .done }
            HStack(spacing: 12) {
                if done {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(PL.successText)
                    Text("Uploaded. It's in your library.")
                        .font(.plBody)
                        .foregroundStyle(PL.successText)
                } else {
                    ProgressView(value: Double(sent), total: Double(max(1, total)))
                        .tint(PL.cyan)
                    Text("\(Int(Double(sent) / Double(max(1, total)) * 100))%")
                        .font(.system(size: 13, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(PL.text400)
                }
            }
        }
    }

    // MARK: - Side picker

    /// Which side the player was on, answered by tapping the recording's
    /// own first frame. Sides change every game, so the question is
    /// anchored to the opening frame, not to memory.
    private var sidePicker: some View {
        ZStack {
            if let poster {
                Image(uiImage: poster)
                    .resizable()
                    .scaledToFit()
            } else {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(PL.ink.opacity(0.5))
                    .aspectRatio(posterAspect, contentMode: .fit)
            }
            VStack(spacing: 0) {
                sideBand("Top of the video", value: "far")
                sideBand("Bottom of the video", value: "near")
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func sideBand(_ label: String, value: String) -> some View {
        let active = draft.userSide == value
        return Button {
            draft.userSide = active ? nil : value
            pushDraft()
        } label: {
            HStack(spacing: 6) {
                if active {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                }
                Text(label)
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(active ? PL.ink : PL.text100)
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(
                active ? AnyShapeStyle(PL.cyan) : AnyShapeStyle(PL.ink.opacity(0.55)),
                in: Capsule()
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .background(active ? PL.cyan.opacity(0.15) : .clear)
        }
        .buttonStyle(.plain)
    }

    // MARK: - First server

    /// Who served the first point. Answering here retires the question
    /// everywhere else: the scoring pad's setup sheet and the match page's
    /// banner are both gated on first_server being null.
    ///
    /// Nothing is selected until it is tapped and tapping again clears it,
    /// so an unanswered sheet leaves the value null and the detector's
    /// guess still runs. That is deliberate — a guessed first server
    /// suppresses both the fallback and the prompt that would fix it.
    private var firstServerPicker: some View {
        // Their real name when the sheet has one. "Your opponent" rather
        // than "Them": the other button says "You", and the pair should
        // read as two people rather than as a pronoun drill.
        let typed = (draft.opponent ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return HStack(spacing: 8) {
            firstServerBand("You", value: "user")
            firstServerBand(typed.isEmpty ? "Your opponent" : typed,
                            value: "opponent")
        }
        .padding(.vertical, 2)
    }

    private func firstServerBand(_ label: String, value: String) -> some View {
        let active = draft.firstServer == value
        return Button {
            draft.firstServer = active ? nil : value
            pushDraft()
        } label: {
            Text(label)
                .font(.system(size: 14, weight: .semibold))
                .lineLimit(1)
                .foregroundStyle(active ? PL.ink : PL.text300)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 9)
                .background(
                    active ? AnyShapeStyle(PL.cyan) : AnyShapeStyle(PL.ink.opacity(0.55)),
                    in: Capsule()
                )
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func pushDraft() {
        queue.updateMetadata(sessionId: sessionId, draft)
    }

    @ViewBuilder
    fileprivate func spokenEditorSheet(_ target: SpokenEditTarget) -> some View {
        let rows = draft.spokenScores ?? []
        let existing = target.game.flatMap { g in rows.first { $0.game == g } }
        SpokenScoreEditor(
            youLabel: youLabel,
            fixedGame: target.game,
            freeGames: (1...SpokenScore.maxGame).filter { candidate in
                !rows.contains { $0.game == candidate }
            },
            initialYou: existing?.you ?? 11,
            initialThem: existing?.them ?? 0,
            canRemove: existing != nil,
            onSave: { game, you, them in saveSpoken(game: game, you: you, them: them) },
            onRemove: { game in removeSpoken(game: game) }
        )
    }

    /// The first frame, fetched with patience: the file may still be
    /// merging when the sheet opens, and a fragmented HEVC capture needs a
    /// tolerant, precisely-timed reader before it gives up a frame.
    private func loadPoster() async {
        for _ in 0..<20 {
            if Task.isCancelled { return }
            if let image = await posterAttempt() {
                poster = image
                return
            }
            try? await Task.sleep(for: .seconds(1))
        }
    }

    private func posterAttempt() async -> UIImage? {
        guard let item = queue.items.first(where: { $0.sessionId == sessionId }) else { return nil }
        let url = queue.fileURL(item)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let asset = AVURLAsset(
            url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true]
        )
        await readAspect(asset)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 900, height: 900)
        generator.requestedTimeToleranceBefore = .positiveInfinity
        generator.requestedTimeToleranceAfter = .positiveInfinity
        for seconds in [1.0, 0.1] {
            if let cg = try? await generator.image(
                at: CMTime(seconds: seconds, preferredTimescale: 600)
            ).image {
                return UIImage(cgImage: cg)
            }
        }
        return nil
    }

    /// A phone hands back both shapes, and the picture's own transform is
    /// what decides which — the stored frame of a portrait clip is still a
    /// landscape one, rotated on the way out.
    private func readAspect(_ asset: AVURLAsset) async {
        guard let track = try? await asset.loadTracks(withMediaType: .video).first,
              let size = try? await track.load(.naturalSize),
              let transform = try? await track.load(.preferredTransform)
        else { return }
        let shown = size.applying(transform)
        let width = abs(shown.width), height = abs(shown.height)
        guard width > 0, height > 0 else { return }
        posterAspect = width / height
    }
}

extension LibraryStore {
    /// Recent distinct values from the library, newest first, for the
    /// dropdowns beside the opponent and venue fields.
    func recentValues(_ key: KeyPath<MatchRow, String?>, limit: Int = 8) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for match in matches {
            guard let value = match[keyPath: key]?.trimmingCharacters(in: .whitespaces),
                  !value.isEmpty, seen.insert(value.lowercased()).inserted else { continue }
            out.append(value)
            if out.count == limit { break }
        }
        return out
    }
}

/// The placement ghost, drawn for the view the pipeline wants: filmed from
/// the SIDE of the table, raised a little — the table runs across the
/// frame with the net upright in the middle. Never recorded into footage.
// The placement guide lives in Components/TableGhost.swift: a table drawn
// in true perspective from the camera poses that processed well, replacing
// the side-on trapezoid that taught the one angle the pipeline handles
// worst.

// MARK: - Fixing a spoken score by hand

/// Which spoken game the details sheet's editor is open on. A nil game
/// is a new one being added.
struct SpokenEditTarget: Identifiable {
    let id = UUID()
    var game: Int?
}

/// The hands-on fallback for everything the microphone gets wrong.
///
/// Asks the way players answer: who won, and how many the loser got.
/// "Won it 11-7" is one tap and one wheel; deuce derives itself, since a
/// loser on ten means the winner finished two clear. The two-wheel free
/// mode stays one tap away for the scores that are not standard games —
/// an abandoned game, a different rule set — and an existing score that
/// is not standard opens straight into it rather than being rounded to
/// something it is not.
struct SpokenScoreEditor: View {
    let youLabel: String
    /// Set when editing an existing game; nil offers the free numbers.
    let fixedGame: Int?
    let freeGames: [Int]
    let initialYou: Int
    let initialThem: Int
    let canRemove: Bool
    let onSave: (Int, Int, Int) -> Void
    let onRemove: (Int) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var game: Int
    @State private var youWon: Bool
    @State private var loserPoints: Int
    /// The two-wheel escape, for scores that are not standard games.
    @State private var freeMode: Bool
    @State private var freeYou: Int
    @State private var freeThem: Int

    init(youLabel: String, fixedGame: Int?, freeGames: [Int],
         initialYou: Int, initialThem: Int, canRemove: Bool,
         onSave: @escaping (Int, Int, Int) -> Void,
         onRemove: @escaping (Int) -> Void) {
        self.youLabel = youLabel
        self.fixedGame = fixedGame
        self.freeGames = freeGames
        self.initialYou = initialYou
        self.initialThem = initialThem
        self.canRemove = canRemove
        self.onSave = onSave
        self.onRemove = onRemove
        _game = State(initialValue: fixedGame ?? freeGames.first ?? 1)
        if let standard = SpokenScore.standardLoser(you: initialYou,
                                                    them: initialThem) {
            _youWon = State(initialValue: standard.youWon)
            _loserPoints = State(initialValue: standard.loserPoints)
            _freeMode = State(initialValue: false)
        } else if initialYou == 0, initialThem == 0, canRemove {
            // A ?? row being filled in: nothing was heard, so nothing is
            // worth prefilling beyond the defaults.
            _youWon = State(initialValue: true)
            _loserPoints = State(initialValue: 0)
            _freeMode = State(initialValue: false)
        } else if canRemove {
            // An existing score that is not a standard game belongs in
            // the free wheels exactly as it is.
            _youWon = State(initialValue: initialYou >= initialThem)
            _loserPoints = State(initialValue: min(initialYou, initialThem))
            _freeMode = State(initialValue: true)
        } else {
            _youWon = State(initialValue: true)
            _loserPoints = State(initialValue: 0)
            _freeMode = State(initialValue: false)
        }
        _freeYou = State(initialValue: initialYou)
        _freeThem = State(initialValue: initialThem)
    }

    private var saved: (you: Int, them: Int) {
        if freeMode { return (freeYou, freeThem) }
        let standard = SpokenScore.standardGame(loserPoints: loserPoints)
        return youWon ? (standard.winner, standard.loser)
                      : (standard.loser, standard.winner)
    }

    var body: some View {
        PLSheetScaffold(title: fixedGame.map { "Game \($0)" } ?? "Add a game",
                        showDone: false) {
            VStack(spacing: 22) {
                if fixedGame == nil, freeGames.count > 1 {
                    Picker("Game", selection: $game) {
                        ForEach(freeGames, id: \.self) { number in
                            Text("Game \(number)").tag(number)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 20)
                }

                if freeMode {
                    freeWheels
                } else {
                    standardEntry
                }

                // The result being saved, spelled out in the score's own
                // colours, so nothing is committed sight unseen.
                HStack(spacing: 6) {
                    Text("\(saved.you)")
                        .foregroundStyle(PL.cyan)
                    Text("\u{2013}").foregroundStyle(PL.text500)
                    Text("\(saved.them)")
                        .foregroundStyle(PL.magentaSoft)
                }
                .font(.system(size: 30, weight: .bold))
                .monospacedDigit()
                .animation(.easeOut(duration: 0.12), value: saved.you)
                .animation(.easeOut(duration: 0.12), value: saved.them)

                VStack(spacing: 10) {
                    Button("Save") {
                        onSave(game, saved.you, saved.them)
                        dismiss()
                    }
                    .buttonStyle(PLPrimaryButtonStyle())

                    HStack(spacing: 10) {
                        Button(freeMode ? "Standard game" : "Other score") {
                            withAnimation(.easeOut(duration: 0.15)) {
                                if !freeMode {
                                    freeYou = saved.you
                                    freeThem = saved.them
                                }
                                freeMode.toggle()
                            }
                        }
                        .buttonStyle(PLSecondaryButtonStyle())

                        if canRemove, let fixedGame {
                            Button("Remove this game") {
                                onRemove(fixedGame)
                                dismiss()
                            }
                            .buttonStyle(PLSoftDestructiveButtonStyle())
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
            }
            .padding(.top, 10)
            .frame(maxHeight: .infinity, alignment: .top)
            .background(PL.ink)
        }
        .presentationDetents([.height(fixedGame == nil ? 470 : 420)])
        // Opaque on purpose. The system material let the sheet underneath
        // bleed through — toggles glowing inside the game picker.
        .presentationBackground(PL.ink)
    }

    private var standardEntry: some View {
        VStack(spacing: 18) {
            Picker("Who won", selection: $youWon) {
                Text("\(youLabel) won").tag(true)
                Text("Opponent won").tag(false)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 20)

            VStack(spacing: 2) {
                Text(youWon ? "Opponent's points" : "\(youLabel)'s points")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(youWon ? PL.magentaSoft : PL.cyan)
                Picker("Loser's points", selection: $loserPoints) {
                    // Thirty is far past any real deuce without the wheel
                    // becoming a scroll.
                    ForEach(0...30, id: \.self) { n in
                        Text("\(n)").tag(n)
                    }
                }
                .pickerStyle(.wheel)
                .frame(height: 120)
            }
        }
    }

    private var freeWheels: some View {
        HStack(spacing: 0) {
            VStack(spacing: 2) {
                Text(youLabel)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.cyan)
                    .lineLimit(1)
                Picker(youLabel, selection: $freeYou) {
                    ForEach(0...40, id: \.self) { n in Text("\(n)").tag(n) }
                }
                .pickerStyle(.wheel)
                .frame(height: 130)
            }
            .frame(maxWidth: .infinity)
            Text("\u{2013}")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(PL.text500)
            VStack(spacing: 2) {
                Text("Opponent")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.magentaSoft)
                Picker("Opponent", selection: $freeThem) {
                    ForEach(0...40, id: \.self) { n in Text("\(n)").tag(n) }
                }
                .pickerStyle(.wheel)
                .frame(height: 130)
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, 12)
    }
}
