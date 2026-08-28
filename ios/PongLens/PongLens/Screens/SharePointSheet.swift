import SwiftUI
import Supabase

/// What a rally's Share button opens.
///
/// The button used to mint a public link and drop straight into the system
/// share sheet. It still does that — it is the last row here — but sharing
/// a rally to Instagram is the thing people actually want to do with a
/// good point, and it needs a vertical video rather than a URL.
///
/// Rows, in the order they are reached for:
///   Instagram Story   render 9:16 and hand it to Instagram
///   Save the video    the same file, into the system share sheet
///   Share a link      a public link to this rally (the old behaviour)
struct SharePointSheet: View {
    let match: MatchRow
    let point: MatchPoint
    let pad: ClipPad
    /// The match's visible points in timeline order. Only the on-device
    /// renderer needs them, to work out the score entering this rally the
    /// same way /api/reel does — through computeMatchScore, the walk the
    /// match page already draws from, so this adds no third copy.
    var points: [MatchPoint] = []

    /// How tall to present this sheet.
    ///
    /// The Instagram row is absent on a phone without Instagram, and a
    /// fixed height sized for three rows leaves a third of the sheet empty
    /// on those phones — which reads as something failing to load rather
    /// than as a row that was never offered.
    static var detentHeight: CGFloat {
        InstagramShare.isAvailable() ? 490 : 390
    }

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @State private var model = StoryShareModel()
    /// The emergency switch (136). Read once per presentation; an
    /// unreadable row answers "on" — a config outage must not take the
    /// button away.
    @State private var sharingOn = true
    @AppStorage("shareShowNames") private var showNames = true
    @AppStorage("shareShowScore") private var showScore = true
    @AppStorage("shareShowLogo") private var showLogo = true
    /// Whatever is being handed to the system share sheet: the rendered
    /// video, or a public link. One presentation for both, so the two
    /// entry points into this sheet cannot drift apart.
    @State private var shareItem: URL?

    /// How long the clip runs, from the pads it was actually cut with.
    /// Known before anything is asked of the server, so a rally Instagram
    /// will not take can say so without a round trip.
    private var clipSeconds: Double? {
        guard let t0 = point.t0, let t1 = point.t1 else { return nil }
        let eff = effectivePad(pad, tightStart: point.tightStart,
                               tightEnd: point.tightEnd)
        var s = max(0, t1 - t0) + eff.pre + eff.post
        // A trim changes what actually renders — the winner tap (138) or,
        // on an unscored point, the observed rally end (143) — so the gate
        // must measure the trimmed file: a rally that only fits a Story
        // because of the trim should be offered as one. Legacy points
        // without cut offsets keep the pad formula.
        if app.tapEndPlayback || app.unscoredRallyEnd, let c = point.cutT0,
           let end = effectiveEnd(point, pad, app.endOptions) {
            s = min(s, end - c)
        }
        return s
    }

    /// Where this rally can go: a Story up to 20 seconds, a Reel up to
    /// 60, nothing past that. Both take the same file through the same
    /// handover; length is the only thing that picks between them.
    private var destination: InstagramShare.Destination? {
        guard let s = clipSeconds else { return .story }
        if s <= InstagramShare.Destination.story.maxSeconds { return .story }
        if s <= InstagramShare.Destination.reel.maxSeconds { return .reel }
        return nil
    }

    private var hasClip: Bool { point.clipPath != nil }

    var body: some View {
        PLChooserSheet(title: "Share this point") {
            if sharingOn, InstagramShare.isAvailable(destination ?? .story) {
                PLChooserRow(
                    icon: "camera.aperture",
                    title: instagramTitle,
                    detail: instagramDetail,
                    pending: !hasClip || destination == nil,
                    busy: model.busy
                ) {
                    if let d = destination {
                        Task { await runShare(to: d) }
                    }
                }
            }

            // While the Instagram row is working this one goes flat rather
            // than spinning too, so only the row being acted on animates.
            PLChooserRow(
                icon: "square.and.arrow.down",
                title: "Save the video",
                detail: hasClip
                    ? "This rally as a vertical clip, to save or send anywhere."
                    : "This rally has no video yet.",
                pending: !hasClip || model.busy
            ) {
                Task { await runShare(to: nil) }
            }

            PLChooserRow(
                icon: "link",
                title: "Share a link",
                detail: "Anyone with the link can watch this rally.",
                busy: model.mintingLink
            ) {
                Task { shareItem = await model.mintLink(match: match, point: point) }
            }

            // What the frame carries. Both apply to the rendered video —
            // handed to Instagram or saved — never to the link. On a match
            // with no confirmed score the score never prints regardless:
            // 0-0 over a rally that was really 8-6 is worse than nothing.
            Toggle("Include names", isOn: $showNames)
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .tint(PL.cyan.opacity(0.5))
                .padding(.top, 4)
            Toggle("Include score", isOn: $showScore)
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .tint(PL.cyan.opacity(0.5))
            Toggle("Include logo", isOn: $showLogo)
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .tint(PL.cyan.opacity(0.5))

            if let message = model.errorMessage {
                Text(message)
                    .font(.plCaption)
                    .foregroundStyle(PL.dangerText)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
        }
        .sheet(item: $shareItem) { url in
            ActivityView(items: [url])
                .presentationDetents([.medium])
        }
        .task { sharingOn = await StoryShareModel.sharingEnabled() }
    }

    private var instagramTitle: String {
        if model.busy { return "Preparing…" }
        return (destination ?? .story).label
    }

    private var instagramDetail: String {
        if !hasClip { return "This rally has no video yet." }
        if destination == nil, let s = clipSeconds {
            return "This rally runs \(Int(s.rounded())) seconds. "
                + "Instagram takes up to 60."
        }
        if model.busy { return model.progressLine }
        return "Opens Instagram with this rally ready to post."
    }

    /// destination nil = hand the finished file to the system share sheet
    /// instead of to Instagram.
    private func runShare(to destination: InstagramShare.Destination?) async {
        guard let url = await model.prepare(
            match: match, point: point, points: points, pad: pad,
            ends: app.endOptions,
            showNames: showNames, showScore: showScore,
            showLogo: showLogo)
        else { return }
        if let destination {
            do {
                try InstagramShare.share(url, to: destination)
                dismiss()
            } catch {
                model.errorMessage = error.localizedDescription
            }
        } else {
            shareItem = url
        }
    }
}

// MARK: - Preparing the file

/// Renders the vertical clip and brings it back to the phone.
///
/// The render happens on the server, not here, so that the crop rule and
/// the frame design exist once rather than once in Swift and once in
/// ffmpeg — the shape of problem that put the placement mirror wrong in
/// two files at the same time. It is fast enough: a rally is a few seconds
/// out of the cut video, which ffmpeg range-seeks rather than downloads.
@MainActor
@Observable
final class StoryShareModel {
    private(set) var busy = false
    private(set) var mintingLink = false
    private(set) var progressLine = "This takes a few seconds."
    var errorMessage: String?

    /// A public link to this one rally — /s/<token>, the same link the
    /// Share button minted before this sheet existed.
    func mintLink(match: MatchRow, point: MatchPoint) async -> URL? {
        guard !mintingLink else { return nil }
        mintingLink = true
        errorMessage = nil
        defer { mintingLink = false }
        struct Req: Encodable {
            let matchId: String
            let pointId: String
        }
        struct Res: Decodable { let url: String }
        do {
            let res: Res = try await API.post(
                "api/share",
                Req(matchId: match.id.uuidString.lowercased(),
                    pointId: point.id.uuidString.lowercased()))
            return URL(string: res.url)
        } catch {
            errorMessage = friendly(error)
            return nil
        }
    }

    /// Rendering is queued, so the answer arrives by polling. Give up well
    /// after any real render would have finished rather than spin forever
    /// on a worker that is not running.
    private let pollInterval = Duration.milliseconds(1200)

    /// Which renderer runs, from app_config.instagram_render (136).
    /// Unreadable or unset answers "server", the path that has been through
    /// a real device.
    private func renderPath() async -> String {
        struct Row: Decodable { let key: String; let value: String }
        let rows: [Row]? = try? await supa
            .from("app_config")
            .select("key,value")
            .eq("key", value: "instagram_render")
            .execute()
            .value
        return rows?.first?.value == "device" ? "device" : "server"
    }

    func prepare(match: MatchRow, point: MatchPoint,
                 points: [MatchPoint], pad: ClipPad, ends: EndOptions,
                 showNames: Bool = true, showScore: Bool = true,
                 showLogo: Bool = true) async -> URL? {
        guard !busy else { return nil }
        busy = true
        errorMessage = nil
        progressLine = "This takes a few seconds."
        defer { busy = false }

        // On-device first when it is selected, but never as a one-way door.
        // The server path is the one that has been through a real handset
        // and out to Instagram; if the phone cannot do it — an older chip
        // refusing the composition, a cut video that will not range-read,
        // anything unforeseen — the share still goes out, just slower.
        // Worst case is the old speed, never a broken button.
        if await renderPath() == "device" {
            if let local = await prepareOnDevice(
                match: match, point: point, points: points, pad: pad,
                ends: ends,
                showNames: showNames, showScore: showScore,
                showLogo: showLogo) {
                return local
            }
            errorMessage = nil
            progressLine = "Taking a little longer."
        }

        let matchId = match.id.uuidString.lowercased()
        let pointId = point.id.uuidString.lowercased()
        let scope = "v:point:\(pointId)"

        struct ReelReq: Encodable {
            let matchId: String
            let pointId: String
            let showScore: Bool
            let showNames: Bool
        }
        struct ReelRes: Decodable { let status: String? }
        do {
            // showScore is asked for, not asserted: the route turns it off
            // by itself when the match has no confirmed winners, which is
            // most matches early on. Printing 0-0 over a rally that was
            // really 8-6 would be worse than printing nothing.
            let _: ReelRes = try await API.post(
                "api/reel",
                ReelReq(matchId: matchId, pointId: pointId,
                        showScore: showScore, showNames: showNames))
        } catch {
            errorMessage = friendly(error)
            return nil
        }

        guard await waitForRender(matchId: matchId, scope: scope) else {
            return nil
        }

        struct MediaReq: Encodable {
            let matchId: String
            let reel: Bool
            let scope: String
        }
        struct MediaRes: Decodable { let url: String? }
        do {
            let res: MediaRes = try await API.post(
                "api/media-url",
                MediaReq(matchId: matchId, reel: true, scope: scope))
            guard let link = res.url.flatMap(URL.init) else {
                errorMessage = "Couldn't prepare that clip. Try again."
                return nil
            }
            return try await download(link, named: "PongLens-\(pointId).mp4")
        } catch {
            errorMessage = friendly(error)
            return nil
        }
    }

    // MARK: - On device
    //
    // The same clip, built here instead of on the Mac. Nothing about the
    // FRAME is decided locally: the crop window was worked out on the
    // server from the table quad and stored on the match row, and the score
    // comes from the walk the match page already uses.

    private func prepareOnDevice(match: MatchRow, point: MatchPoint,
                                 points: [MatchPoint], pad: ClipPad,
                                 ends: EndOptions,
                                 showNames: Bool,
                                 showScore: Bool,
                                 showLogo: Bool) async -> URL? {
        let matchId = match.id.uuidString.lowercased()
        progressLine = "Building it here."

        // The cut video's signed URL, and the crop window, together — the
        // renderer range-reads the video rather than downloading it.
        struct CutReq: Encodable {
            let matchId: String
            let preview: Bool
        }
        struct CutRes: Decodable { let url: String? }
        // The names live on the match row but not on MatchRow — the app has
        // never needed them. Read here rather than widening the shared
        // model, so this feature touches nothing anyone else is editing.
        struct MatchBits: Decodable {
            let story_crop: StoryRenderer.Crop?
            let player_near_name: String?
            let player_far_name: String?
        }

        async let cutTask: CutRes? = try? await API.post(
            "api/media-url", CutReq(matchId: matchId, preview: true))
        async let cropTask: [MatchBits]? = try? await supa
            .from("matches")
            .select("story_crop,player_near_name,player_far_name")
            .eq("id", value: matchId)
            .execute()
            .value

        let (cutRes, cropRows) = await (cutTask, cropTask)
        guard let cutURL = cutRes?.url.flatMap(URL.init) else {
            errorMessage = "Couldn't reach that match's video. Try again."
            return nil
        }

        guard let cutT0 = point.cutT0, let t0 = point.t0, let t1 = point.t1 else {
            errorMessage = "This rally has no video to share."
            return nil
        }
        let eff = effectivePad(pad, tightStart: point.tightStart,
                               tightEnd: point.tightEnd)
        let segStart = max(0, cutT0)
        // Playhead.effectiveEnd, the same maths route.ts's segment block
        // runs — the same rally must render identically whichever path
        // app_config.instagram_render picks (136/138).
        let segEnd = effectiveEnd(point, pad, ends)
            ?? cutT0 + max(0, t1 - t0) + eff.pre + eff.post

        // Score ENTERING this rally, and the games already completed. A
        // match with no confirmed winners has no score to print, and
        // printing 0-0 over a rally that was really 8-6 is worse than
        // printing nothing — the same rule /api/reel applies.
        let rows = points.map {
            PointRow(id: $0.id, matchId: $0.matchId, idx: $0.idx, t0: $0.t0,
                     confirmedWinner: $0.confirmedWinner, isLet: $0.isLet,
                     deleted: $0.deleted, gameEndOverride: $0.gameEndOverride,
                     gameWinnerOverride: $0.gameWinnerOverride)
        }
        let scored = computeMatchScore(rows).confirmedCount > 0
        let withScore = scored && showScore
        let idx = points.firstIndex { $0.id == point.id } ?? 0
        let entering = computeMatchScore(Array(rows.prefix(idx)))
        let score: (you: Int, them: Int)? =
            withScore ? (entering.current.you, entering.current.them) : nil
        let games = withScore ? entering.games.map { ($0.you, $0.them) } : []

        // Same fallback chain /api/reel uses, including the account first
        // name — without it a match with untagged sides would say "Player"
        // here and "Adil" on the server, which is exactly the kind of drift
        // two renderers invite.
        let bits = cropRows?.first
        let userIsFar = match.userSide == "far"
        let near = (bits?.player_near_name ?? "").trimmingCharacters(in: .whitespaces)
        let far = (bits?.player_far_name ?? "").trimmingCharacters(in: .whitespaces)
        let account = ((try? await supa.auth.session.user.userMetadata["full_name"]?
            .stringValue) ?? nil)?
            .split(separator: " ").first.map(String.init) ?? ""
        let you = [userIsFar ? far : near, account, "Player"]
            .first { !$0.isEmpty } ?? "Player"
        let them = [userIsFar ? near : far,
                    match.opponentName ?? "", "Opponent"]
            .first { !$0.isEmpty } ?? "Opponent"

        do {
            // Bounded: an export over a stalled connection can hang far
            // past anything a person will wait through, and the server
            // fallback right behind this is the better answer by then.
            return try await withShareTimeout(seconds: 25) {
                try await StoryRenderer.render(
                    cutURL: cutURL, segStart: segStart, segEnd: segEnd,
                    crop: cropRows?.first?.story_crop, you: you, them: them,
                    score: score, games: games, showNames: showNames,
                    showLogo: showLogo)
            }
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    /// The starred rallies as ONE vertical video — scope v:starred,
    /// stitched by the worker. Always the server: joining several clips
    /// with crossfades is exactly the machinery render_story already has,
    /// and a phone rebuilding it would be a third copy of the frame.
    func prepareHighlights(match: MatchRow, showNames: Bool,
                           showScore: Bool,
                           showLogo: Bool = true) async -> URL? {
        guard !busy else { return nil }
        busy = true
        errorMessage = nil
        progressLine = "This takes a little while."
        defer { busy = false }
        let matchId = match.id.uuidString.lowercased()
        struct Req: Encodable {
            let matchId: String
            let vertical: Bool
            let showScore: Bool
            let showNames: Bool
            let showLogo: Bool
        }
        struct Res: Decodable { let status: String? }
        do {
            let _: Res = try await API.post(
                "api/reel",
                Req(matchId: matchId, vertical: true,
                    showScore: showScore, showNames: showNames,
                    showLogo: showLogo))
        } catch {
            errorMessage = friendly(error)
            return nil
        }
        // Several rallies take several times longer than one; the deadline
        // stretches with them rather than declaring a working render dead.
        guard await waitForRender(matchId: matchId, scope: "v:starred",
                                  deadline: .seconds(180)) else { return nil }
        struct MediaReq: Encodable {
            let matchId: String
            let reel: Bool
            let scope: String
        }
        struct MediaRes: Decodable { let url: String? }
        do {
            let res: MediaRes = try await API.post(
                "api/media-url",
                MediaReq(matchId: matchId, reel: true, scope: "v:starred"))
            guard let link = res.url.flatMap(URL.init) else {
                errorMessage = "Couldn't prepare the video. Try again."
                return nil
            }
            return try await download(link, named: "PongLens-highlights.mp4")
        } catch {
            errorMessage = friendly(error)
            return nil
        }
    }

    /// One of the automatic cuts — highlight 'story' | 'reel' | 'long'.
    /// The PICKER runs on the server with the same rule the phone
    /// previews (Core/Highlights.swift, parity-tested); the phone only
    /// names the budget. Renders on the worker like every stitched cut.
    func prepareAuto(match: MatchRow, kind: String,
                     showNames: Bool, showScore: Bool,
                     showLogo: Bool = true) async -> URL? {
        guard !busy else { return nil }
        busy = true
        errorMessage = nil
        progressLine = "This takes a little while."
        defer { busy = false }
        let matchId = match.id.uuidString.lowercased()
        struct Req: Encodable {
            let matchId: String
            let highlight: String
            let showScore: Bool
            let showNames: Bool
            let showLogo: Bool
        }
        struct Res: Decodable { let status: String? }
        do {
            let _: Res = try await API.post(
                "api/reel",
                Req(matchId: matchId, highlight: kind,
                    showScore: showScore, showNames: showNames,
                    showLogo: showLogo))
        } catch {
            errorMessage = friendly(error)
            return nil
        }
        // The long cut is two minutes of output; give the worker room.
        guard await waitForRender(
            matchId: matchId, scope: "v:hl:\(kind)",
            deadline: .seconds(kind == "long" ? 240 : 180))
        else { return nil }
        struct MediaReq: Encodable {
            let matchId: String
            let reel: Bool
            let scope: String
        }
        struct MediaRes: Decodable { let url: String? }
        do {
            let res: MediaRes = try await API.post(
                "api/media-url",
                MediaReq(matchId: matchId, reel: true,
                         scope: "v:hl:\(kind)"))
            guard let link = res.url.flatMap(URL.init) else {
                errorMessage = "Couldn't prepare the video. Try again."
                return nil
            }
            return try await download(link, named: "PongLens-highlights.mp4")
        } catch {
            errorMessage = friendly(error)
            return nil
        }
    }

    /// app_config.instagram_sharing (136), the emergency switch. An
    /// unreadable row answers "on": a config outage must not take the
    /// feature away — only the stored value 'off' does.
    static func sharingEnabled() async -> Bool {
        struct Row: Decodable { let value: String }
        let rows: [Row]? = try? await supa
            .from("app_config")
            .select("value")
            .eq("key", value: "instagram_sharing")
            .execute()
            .value
        return rows?.first?.value != "off"
    }

    private func waitForRender(matchId: String, scope: String,
                               deadline: Duration = .seconds(90)) async -> Bool {
        struct Row: Decodable {
            let status: String
            let error: String?
        }
        let started = ContinuousClock.now
        while ContinuousClock.now - started < deadline {
            let rows: [Row]? = try? await supa
                .from("match_reels")
                .select("status,error")
                .eq("match_id", value: matchId)
                .eq("scope", value: scope)
                .execute()
                .value
            switch rows?.first?.status {
            case "ready":
                return true
            case "failed":
                errorMessage = "Couldn't prepare that clip. Try again."
                return false
            case "rendering":
                progressLine = "Almost there."
            default:
                break
            }
            try? await Task.sleep(for: pollInterval)
        }
        errorMessage = "That took too long. Try again in a minute."
        return false
    }

    private func download(_ url: URL, named name: String) async throws -> URL {
        let (tmp, _) = try await URLSession.shared.download(from: url)
        let dest = FileManager.default.temporaryDirectory
            .appendingPathComponent(name)
        try? FileManager.default.removeItem(at: dest)
        try FileManager.default.moveItem(at: tmp, to: dest)
        return dest
    }

    /// API errors arrive as a sentence or a stable code; a code is not
    /// something to put in front of a player.
    private func friendly(_ error: Error) -> String {
        if case APIError.http(_, let message) = error {
            if message == "render_queue_full" {
                return "Something else is still rendering. Try again shortly."
            }
            if message == "too_long" {
                return "That rally is too long for Instagram."
            }
            if !message.isEmpty, message.contains(" ") {
                return message
            }
        }
        return "Couldn't prepare that clip. Try again."
    }
}

// MARK: - Bounding the device render

private struct ShareTimeout: Error, LocalizedError {
    var errorDescription: String? { "That took too long." }
}

/// Race the work against a clock. On timeout the group cancels the work
/// task; an export already writing keeps going briefly and its file is
/// simply never used — the point is unblocking the person, not reclaiming
/// the cycles.
func withShareTimeout<T: Sendable>(
    seconds: Double, _ work: @escaping @Sendable () async throws -> T
) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await work() }
        group.addTask {
            try await Task.sleep(for: .seconds(seconds))
            throw ShareTimeout()
        }
        let result = try await group.next()!
        group.cancelAll()
        return result
    }
}
