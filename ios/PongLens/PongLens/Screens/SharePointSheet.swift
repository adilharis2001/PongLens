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
    /// Mint and share a public link — the behaviour this sheet replaced,
    /// kept exactly as it was and owned by the caller.
    let onShareLink: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var model = StoryShareModel()
    @State private var fileToShare: URL?

    /// How long the clip runs, from the pads it was actually cut with.
    /// Known before anything is asked of the server, so a rally Instagram
    /// will not take can say so without a round trip.
    private var clipSeconds: Double? {
        guard let t0 = point.t0, let t1 = point.t1 else { return nil }
        let eff = effectivePad(pad, tightStart: point.tightStart,
                               tightEnd: point.tightEnd)
        return max(0, t1 - t0) + eff.pre + eff.post
    }

    private var tooLongForStory: Bool {
        guard let s = clipSeconds else { return false }
        return s > InstagramShare.Destination.story.maxSeconds
    }

    private var hasClip: Bool { point.clipPath != nil }

    var body: some View {
        PLChooserSheet(title: "Share this point") {
            if InstagramShare.isAvailable() {
                PLChooserRow(
                    icon: "camera.aperture",
                    title: instagramTitle,
                    detail: instagramDetail,
                    pending: !hasClip || tooLongForStory,
                    busy: model.busy
                ) {
                    Task { await runShare(to: .story) }
                }
            }

            // While the Instagram row is working this one goes flat rather
            // than spinning too, so only the row being acted on animates.
            PLChooserRow(
                icon: "square.and.arrow.down",
                title: "Save the video",
                detail: hasClip
                    ? "The same vertical clip, to save or send anywhere."
                    : "This rally has no video yet.",
                pending: !hasClip || model.busy
            ) {
                Task { await runShare(to: nil) }
            }

            PLChooserRow(
                icon: "link",
                title: "Share a link",
                detail: "Anyone with the link can watch this rally."
            ) {
                dismiss()
                onShareLink()
            }

            if let message = model.errorMessage {
                Text(message)
                    .font(.plCaption)
                    .foregroundStyle(PL.dangerText)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
        }
        .sheet(item: $fileToShare) { url in
            ActivityView(items: [url])
                .presentationDetents([.medium])
        }
    }

    private var instagramTitle: String {
        model.busy ? "Preparing…" : "Instagram Story"
    }

    private var instagramDetail: String {
        if !hasClip { return "This rally has no video yet." }
        if tooLongForStory, let s = clipSeconds {
            return "This rally runs \(Int(s.rounded())) seconds. "
                + "An Instagram Story takes 20."
        }
        if model.busy { return model.progressLine }
        return "Opens Instagram with this rally ready to post."
    }

    /// destination nil = hand the finished file to the system share sheet
    /// instead of to Instagram.
    private func runShare(to destination: InstagramShare.Destination?) async {
        guard let url = await model.prepare(match: match, point: point) else {
            return
        }
        if let destination {
            do {
                try InstagramShare.share(url, to: destination)
                dismiss()
            } catch {
                model.errorMessage = error.localizedDescription
            }
        } else {
            fileToShare = url
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
    private(set) var progressLine = "This takes a few seconds."
    var errorMessage: String?

    /// Rendering is queued, so the answer arrives by polling. Give up well
    /// after any real render would have finished rather than spin forever
    /// on a worker that is not running.
    private let pollInterval = Duration.milliseconds(1200)
    private let deadline: Duration = .seconds(90)

    func prepare(match: MatchRow, point: MatchPoint) async -> URL? {
        guard !busy else { return nil }
        busy = true
        errorMessage = nil
        progressLine = "This takes a few seconds."
        defer { busy = false }

        let matchId = match.id.uuidString.lowercased()
        let pointId = point.id.uuidString.lowercased()
        let scope = "v:point:\(pointId)"

        struct ReelReq: Encodable {
            let matchId: String
            let pointId: String
            let showScore: Bool
        }
        struct ReelRes: Decodable { let status: String? }
        do {
            // showScore is asked for, not asserted: the route turns it off
            // by itself when the match has no confirmed winners, which is
            // most matches early on. Printing 0-0 over a rally that was
            // really 8-6 would be worse than printing nothing.
            let _: ReelRes = try await API.post(
                "api/reel",
                ReelReq(matchId: matchId, pointId: pointId, showScore: true))
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

    private func waitForRender(matchId: String, scope: String) async -> Bool {
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
