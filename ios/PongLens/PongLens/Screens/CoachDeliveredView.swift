import AVFoundation
import SwiftUI
import Supabase

/// The order after delivery, coach side: the status line, the completed-
/// order extras (testimonial, invite back, sample), the review exactly as
/// the student sees it, and the follow-up thread.
struct CoachDeliveredView: View {
    @Bindable var store: CoachOrderStore
    let detail: ReviewOrderDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            statusLine

            if detail.status == .completed {
                if let quote = detail.testimonial {
                    TestimonialCard(store: store, detail: detail, quote: quote)
                }
                InviteBackCard(store: store, detail: detail)
                FeatureSampleCard(store: store, detail: detail)
            }

            ReviewBodyView(store: store)

            FollowupThread(store: store, canAsk: detail.status == .delivered)
        }
    }

    private var statusLine: some View {
        var text = Text(
            detail.status == .delivered
                ? "Delivered. It completes when they mark it done, or after a quiet week."
                : "Completed. Your payout is on the way."
        ).foregroundStyle(PL.text300)
        if detail.reviewViewedAt != nil {
            text = text + Text(" They watched it.").foregroundStyle(PL.cyan)
        }
        return text
            .font(.plBody)
            .frame(maxWidth: .infinity, alignment: .leading)
            .plCard(padding: 18)
    }
}

// MARK: - Completed extras

private struct TestimonialCard: View {
    let store: CoachOrderStore
    let detail: ReviewOrderDetail
    let quote: String

    @State private var featured: Bool

    init(store: CoachOrderStore, detail: ReviewOrderDetail, quote: String) {
        self.store = store
        self.detail = detail
        self.quote = quote
        _featured = State(initialValue: detail.testimonialFeatured)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading("From \(detail.studentName)")
            Text("“\(quote)”")
                .font(.plBody)
                .foregroundStyle(PL.text200)
            HStack {
                Text("Show on your page")
                    .font(.plBody)
                    .foregroundStyle(PL.text300)
                Spacer()
                Toggle("", isOn: $featured)
                    .labelsHidden()
                    .tint(PL.cyan)
                    .onChange(of: featured) { previous, next in
                        Task {
                            if await store.setTestimonialFeatured(next) == false {
                                featured = previous
                            }
                        }
                    }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 18)
    }
}

private struct InviteBackCard: View {
    let store: CoachOrderStore
    let detail: ReviewOrderDetail

    @State private var sent: Bool
    @State private var busy = false

    init(store: CoachOrderStore, detail: ReviewOrderDetail) {
        self.store = store
        self.detail = detail
        _sent = State(initialValue: detail.invitedBackAt != nil)
    }

    var body: some View {
        Group {
            if sent {
                Text("You invited them back. They got an email.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .plCard(padding: 18)
            } else {
                HStack {
                    Text("Worth another round?")
                        .font(.plBody)
                        .foregroundStyle(PL.text300)
                    Spacer()
                    Button(busy ? "Sending" : "Invite them back") {
                        Task {
                            busy = true
                            if await store.transition("invite_back") == nil { sent = true }
                            busy = false
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                    .disabled(busy)
                }
                .plCard(padding: 18)
            }
        }
    }
}

private struct FeatureSampleCard: View {
    let store: CoachOrderStore
    let detail: ReviewOrderDetail

    @State private var consent: String
    @State private var busy = false

    init(store: CoachOrderStore, detail: ReviewOrderDetail) {
        self.store = store
        self.detail = detail
        _consent = State(initialValue: detail.sampleConsent)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading("Sample review")
            switch consent {
            case "approved":
                Text("This is the public sample on your page. They said yes.")
                    .font(.plBody)
                    .foregroundStyle(PL.text300)
            case "requested":
                Text("You asked to make this the public sample. Waiting on their OK.")
                    .font(.plBody)
                    .foregroundStyle(PL.text300)
            default:
                Text("The whole review, their match included, shown publicly on your page. That needs their yes.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                Button(busy ? "Asking" : "Ask them") {
                    Task {
                        busy = true
                        if await store.requestSample() { consent = "requested" }
                        busy = false
                    }
                }
                .buttonStyle(PLSecondaryButtonStyle())
                .disabled(busy)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 18)
    }
}

// MARK: - The review, as the student sees it

struct ReviewBodyView: View {
    @Bindable var store: CoachOrderStore

    @State private var clipURLs: [UUID: URL] = [:]

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            ForEach(store.sections.filter {
                !$0.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }, id: \.key) { section in
                VStack(alignment: .leading, spacing: 8) {
                    Text(section.label)
                        .font(.plCardTitle)
                        .foregroundStyle(PL.text100)
                    Text(section.body)
                        .font(.system(size: 15))
                        .lineSpacing(4)
                        .foregroundStyle(PL.text200)
                }
            }

            if !store.findings.isEmpty {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Watch these points")
                        .font(.plCardTitle)
                        .foregroundStyle(PL.text100)
                    ForEach(store.findings) { finding in
                        DeliveredFindingCard(
                            store: store, finding: finding, clipURLs: clipURLs
                        )
                    }
                }
            }

            if !store.attachments.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Attachments")
                        .font(.plCardTitle)
                        .foregroundStyle(PL.text100)
                    ForEach(store.attachments) { attachment in
                        AttachmentRow(store: store, attachment: attachment)
                    }
                }
            }
        }
        .task {
            let cited = store.findings.flatMap { store.pointIds(for: $0.id) }
            guard !cited.isEmpty else { return }
            clipURLs = await store.clipURLs(pointIds: Array(Set(cited)))
        }
    }
}

private struct DeliveredFindingCard: View {
    let store: CoachOrderStore
    let finding: ReviewFindingRow
    let clipURLs: [UUID: URL]

    @State private var audioURL: URL?
    @State private var imageURL: URL?
    @State private var nowPlaying: UUID?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !finding.title.isEmpty {
                Text(finding.title)
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
            }
            if !finding.body.isEmpty {
                Text(finding.body)
                    .font(.plBody)
                    .lineSpacing(3)
                    .foregroundStyle(PL.text300)
            }
            if finding.audioPath != nil {
                if let audioURL {
                    AudioPlayButton(url: audioURL)
                } else {
                    ProgressView().tint(PL.cyan)
                }
            }
            if finding.imagePath != nil {
                VStack(alignment: .leading, spacing: 4) {
                    if let imageURL {
                        AsyncImage(url: imageURL) { phase in
                            if let image = phase.image {
                                image.resizable().scaledToFit()
                            } else {
                                RoundedRectangle(cornerRadius: PL.rSmall)
                                    .fill(PL.ink.opacity(0.4))
                                    .aspectRatio(16 / 9, contentMode: .fit)
                            }
                        }
                        .clipShape(RoundedRectangle(cornerRadius: PL.rSmall, style: .continuous))
                    }
                    if let pointId = finding.imagePointId,
                       let n = store.pointNumber(for: pointId) {
                        Text("From point \(n)")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                    }
                }
            }
            let pointIds = store.pointIds(for: finding.id)
            if !pointIds.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(pointIds, id: \.self) { pointId in
                            ClipCard(
                                url: clipURLs[pointId],
                                label: "Point \(store.pointNumber(for: pointId) ?? 0)",
                                isPlaying: nowPlaying == pointId,
                                onPlay: { nowPlaying = pointId }
                            )
                        }
                    }
                }
                .scrollTargetBehavior(.viewAligned)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
        .task {
            if finding.audioPath != nil {
                audioURL = await store.findingMediaURL(finding.id, kind: "audio")
            }
            if finding.imagePath != nil {
                imageURL = await store.findingMediaURL(finding.id, kind: "image")
            }
        }
    }
}

/// One cited clip: poster-less card with a play glyph; the player mounts
/// on first play, and only one clip in a reel plays at a time.
private struct ClipCard: View {
    let url: URL?
    let label: String
    let isPlaying: Bool
    let onPlay: () -> Void

    @State private var player: AVPlayer?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack {
                if let player, isPlaying {
                    PlayerLayerView(player: player)
                } else {
                    PL.ink
                    Image(systemName: "play.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.9))
                        .frame(width: 44, height: 44)
                        .background(.black.opacity(0.45), in: Circle())
                }
            }
            .frame(width: 280, height: 158)
            .clipShape(RoundedRectangle(cornerRadius: PL.rSmall, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rSmall, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
            .contentShape(Rectangle())
            .onTapGesture {
                guard let url else { return }
                if isPlaying {
                    player?.pause()
                } else {
                    let p = player ?? AVPlayer(url: url)
                    player = p
                    onPlay()
                    p.play()
                }
            }
            Text(label)
                .font(.plCaption)
                .foregroundStyle(PL.text500)
        }
        .onChange(of: isPlaying) { _, playing in
            if !playing { player?.pause() }
        }
        .onDisappear { player?.pause() }
    }
}

private struct AttachmentRow: View {
    let store: CoachOrderStore
    let attachment: ReviewAttachmentRow

    @Environment(\.openURL) private var openURL
    @State private var busy = false

    var body: some View {
        Button {
            Task {
                busy = true
                if let url = await store.attachmentURL(attachment.id) { openURL(url) }
                busy = false
            }
        } label: {
            HStack(spacing: 12) {
                Text(attachment.filename)
                    .font(.plBody)
                    .foregroundStyle(PL.text200)
                    .lineLimit(1)
                Spacer()
                Text(sizeLabel)
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                Image(systemName: "arrow.down.circle")
                    .font(.system(size: 14))
                    .foregroundStyle(busy ? PL.text600 : PL.text400)
            }
            .plInnerRow()
        }
        .buttonStyle(.plain)
        .disabled(busy)
    }

    private var sizeLabel: String {
        let bytes = attachment.sizeBytes
        if bytes >= 1_000_000 {
            return String(format: "%.1f MB", Double(bytes) / 1_000_000)
        }
        return "\(bytes / 1000) KB"
    }
}

// MARK: - Follow-ups

/// Post-delivery Q&A. The student's questions are counted; coach replies
/// are not. Cards carry a left border: cyan for yours, amber for theirs.
struct FollowupThread: View {
    @Bindable var store: CoachOrderStore
    let canAsk: Bool

    @State private var draft = ""
    @State private var sending = false
    @State private var errorMessage: String?

    private var followups: [ReviewMessageRow] {
        store.messages.filter { $0.kind == "followup" }
    }

    var body: some View {
        if !followups.isEmpty || canAsk {
            VStack(alignment: .leading, spacing: 12) {
                Text("Follow-up")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                ForEach(followups) { message in
                    let mine = message.authorId == store.viewerId
                    VStack(alignment: .leading, spacing: 4) {
                        Text(message.body)
                            .font(.plBody)
                            .foregroundStyle(PL.text200)
                        Text(PGDate.shortDate(message.createdAt))
                            .font(.system(size: 10))
                            .foregroundStyle(PL.text600)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .plCard(padding: 14)
                    .overlay(alignment: .leading) {
                        UnevenRoundedRectangle(
                            topLeadingRadius: PL.rCard, bottomLeadingRadius: PL.rCard
                        )
                        .fill((mine ? PL.cyan : PL.warning).opacity(0.5))
                        .frame(width: 3)
                    }
                }
                if let errorMessage {
                    Text(errorMessage).font(.plCaption).foregroundStyle(PL.warningText)
                }
                if canAsk {
                    HStack(spacing: 10) {
                        TextField("Reply", text: $draft)
                            .plField()
                            .onSubmit { Task { await send() } }
                        Button(sending ? "Sending" : "Send") {
                            Task { await send() }
                        }
                        .buttonStyle(PLSecondaryButtonStyle())
                        .disabled(sending || draft.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
        }
    }

    private func send() async {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        sending = true
        errorMessage = nil
        if let code = await store.transition("followup", message: body) {
            errorMessage = transitionErrorCopy(code)
        } else {
            draft = ""
            await store.load()
        }
        sending = false
    }
}
