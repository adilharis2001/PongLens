import SwiftUI
import Supabase
import UniformTypeIdentifiers

/// One order, coach side: accept it, build the review, deliver it, answer
/// follow-ups. Mirrors CoachOrder.tsx at phone width. Match access rides
/// on the active order and ends at completion.
struct CoachOrderScreen: View {
    let orderId: UUID

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @Environment(CoachStore.self) private var coach
    @State private var store: CoachOrderStore

    init(orderId: UUID) {
        self.orderId = orderId
        _store = State(initialValue: CoachOrderStore(orderId: orderId))
    }

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Button { dismiss() } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Coaching")
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())

                    if let detail = store.detail {
                        header(detail)
                        statusBody(detail)
                    } else if store.loaded {
                        Text("This order could not be found.")
                            .font(.plBody)
                            .foregroundStyle(PL.text500)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .plCard(padding: 18)
                    } else {
                        RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                            .fill(PL.surface)
                            .frame(height: 160)
                            .opacity(0.6)
                    }
                }
                .padding(20)
                .padding(.bottom, 100)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        // Pushed screens sit outside MainTabView's keyboard inset, so the
        // workspace carries its own copy: the write-up, tactics, practice
        // plan and chat fields all get the hide-keyboard chevron.
        .plKeyboardDismiss()
        .task { await store.load() }
    }

    // MARK: - Header

    @ViewBuilder
    private func header(_ detail: ReviewOrderDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(detail.studentName)
                    .font(.plPageTitle)
                    .tracking(-0.6)
                    .foregroundStyle(PL.textBody)
                Spacer()
                if store.sponsored {
                    Text("Sponsored by you")
                        .font(.plCaption)
                        .foregroundStyle(PL.text400)
                } else {
                    (Text(formatUsd(detail.coachShareCents)).foregroundStyle(PL.text200)
                        + Text(" of \(formatUsd(detail.priceCents))").foregroundStyle(PL.text500))
                        .font(.system(size: 15, weight: .semibold))
                        .monospacedDigit()
                }
            }
            Text(offeringLine(detail))
                .font(.plBody)
                .foregroundStyle(PL.text400)
            if let match = store.match, match.status == .ready {
                NavigationLink(value: match) {
                    (Text("Open the full match").foregroundStyle(PL.cyan)
                        + Text(" for scores, placement and your notes.")
                        .foregroundStyle(PL.text500))
                        .font(.plBody)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func offeringLine(_ detail: ReviewOrderDetail) -> String {
        var line = detail.offeringTitle
        if detail.status == .inReview || detail.status == .clarification,
           let promised = detail.promisedBy, let date = PGDate.parse(promised) {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = "EEE, MMM d"
            line += " · promised by \(formatter.string(from: date))"
        }
        return line
    }

    // MARK: - Bodies per status

    @ViewBuilder
    private func statusBody(_ detail: ReviewOrderDetail) -> some View {
        switch detail.status {
        case .awaitingSubmission:
            Text("They haven't sent a match yet. The order starts when they do.")
                .font(.plBody)
                .foregroundStyle(PL.text400)
                .frame(maxWidth: .infinity, alignment: .leading)
                .plCard(padding: 18)
        case .submitted:
            briefCard(detail)
            AcceptDeclineCard(store: store, detail: detail) {
                Task { await coach.load(userId: app.userId) }
            }
        case .inReview, .clarification:
            briefCard(detail)
            questionsSection(detail)
            CoachFindingsSection(store: store)
            writeUpSection(detail)
            attachmentsSection
            ToolsCard(store: store)
            DeliverCard(store: store, detail: detail) {
                Task { await coach.load(userId: app.userId) }
            }
        case .delivered, .completed:
            CoachDeliveredView(store: store, detail: detail)
        case .declined:
            Text("You declined this order. They were refunded in full.")
                .font(.plBody)
                .foregroundStyle(PL.text400)
                .frame(maxWidth: .infinity, alignment: .leading)
                .plCard(padding: 18)
        case .awaitingPayment:
            Text("They haven't finished paying yet.")
                .font(.plBody)
                .foregroundStyle(PL.text400)
                .frame(maxWidth: .infinity, alignment: .leading)
                .plCard(padding: 18)
        case .cancelled:
            Text("This order was cancelled and refunded.")
                .font(.plBody)
                .foregroundStyle(PL.text400)
                .frame(maxWidth: .infinity, alignment: .leading)
                .plCard(padding: 18)
        }
    }

    // MARK: - Their brief

    @ViewBuilder
    private func briefCard(_ detail: ReviewOrderDetail) -> some View {
        let answered = detail.intakeAnswers.filter {
            !$0.answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        if !answered.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                SectionHeading("Their brief")
                ForEach(answered, id: \.id) { qa in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(qa.label).font(.plCaption).foregroundStyle(PL.text500)
                        Text(qa.answer).font(.plBody).foregroundStyle(PL.text200)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .plCard(padding: 18)
        }
    }

    // MARK: - Questions (clarification chat)

    private func questionsSection(_ detail: ReviewOrderDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Questions")
            ChatThreadView(
                store: store,
                messages: store.messages.filter { $0.kind == "clarification" },
                otherName: detail.studentName,
                canWrite: true
            )
        }
    }

    // MARK: - Write-up

    private func writeUpSection(_ detail: ReviewOrderDetail) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("Your write-up")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                if store.docSaving {
                    Text("saving").font(.plCaption).foregroundStyle(PL.text600)
                } else if store.docSaved {
                    Text("saved").font(.plCaption).foregroundStyle(PL.text600)
                }
            }
            ForEach(store.sections.indices, id: \.self) { i in
                WriteUpSectionField(store: store, index: i)
            }
            if let note = store.sectionNote {
                Text(note).font(.plCaption).foregroundStyle(PL.warningText)
            }
        }
    }

    // MARK: - Attachments

    private var attachmentsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Attachments")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
            AttachmentManagerView(store: store)
        }
    }
}

// MARK: - Accept / decline

private struct AcceptDeclineCard: View {
    let store: CoachOrderStore
    let detail: ReviewOrderDetail
    let onChanged: () -> Void

    @State private var declining = false
    @State private var declineNote = ""
    @State private var busy = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Accepting starts your \(detail.turnaroundDays)-day turnaround.")
                .font(.plBody)
                .foregroundStyle(PL.text300)

            if let errorMessage {
                Text(errorMessage).font(.plCaption).foregroundStyle(PL.warningText)
            }

            Button(busy && !declining ? "One moment" : "Accept and start") {
                Task {
                    busy = true
                    errorMessage = nil
                    if let code = await store.transition("accept") {
                        errorMessage = transitionErrorCopy(code)
                    } else {
                        await store.load()
                        onChanged()
                    }
                    busy = false
                }
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .frame(maxWidth: .infinity)
            .disabled(busy)

            if declining {
                TextField(
                    "A short note to them. They get a full refund.",
                    text: $declineNote, axis: .vertical
                )
                .lineLimit(2...5)
                .plField()
                Button(busy ? "One moment" : "Decline and refund") {
                    Task {
                        busy = true
                        _ = await store.transition(
                            "decline",
                            message: String(declineNote.prefix(500))
                        )
                        await store.load()
                        onChanged()
                        busy = false
                    }
                }
                .buttonStyle(PLSoftDestructiveButtonStyle())
                .disabled(busy)
            } else {
                Button("Decline this order") { declining = true }
                    .buttonStyle(PLSecondaryButtonStyle())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 18)
    }
}

/// Stable-code → sentence for the transition API.
func transitionErrorCopy(_ code: String) -> String {
    switch code {
    case "bad_state": "This order moved on. Pull to refresh."
    case "not_allowed": "You can't do that on this order."
    case "not_ready": "The review isn't ready to deliver yet."
    case "followups_used": "They have used their follow-up questions."
    default: "That did not work. Try again in a moment."
    }
}

// MARK: - Chat

struct ChatThreadView: View {
    let store: CoachOrderStore
    let messages: [ReviewMessageRow]
    let otherName: String
    let canWrite: Bool

    @State private var draft = ""
    @State private var sending = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(messages) { message in
                bubble(message)
            }
            if let errorMessage {
                Text(errorMessage).font(.plCaption).foregroundStyle(PL.warningText)
            }
            if canWrite {
                HStack(alignment: .bottom, spacing: 10) {
                    TextField("Write to \(otherName)", text: $draft, axis: .vertical)
                        .lineLimit(1...6)
                        .plField()
                    Button {
                        Task { await send() }
                    } label: {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(PL.ink)
                            .frame(width: 44, height: 44)
                            .background(PL.cyan, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .opacity(
                        sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            ? 0.55 : 1
                    )
                }
            }
        }
    }

    private func bubble(_ message: ReviewMessageRow) -> some View {
        let mine = message.authorId == store.viewerId
        return VStack(alignment: mine ? .trailing : .leading, spacing: 3) {
            Text(message.body)
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    mine ? PL.cyan.opacity(0.12) : PL.surface,
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(mine ? PL.cyan.opacity(0.25) : PL.edge, lineWidth: 1)
                )
            Text("\(mine ? "You" : otherName) · \(PGDate.shortDate(message.createdAt))")
                .font(.system(size: 10))
                .foregroundStyle(PL.text600)
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
    }

    private func send() async {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        sending = true
        errorMessage = nil
        if await store.transition("message", message: body) != nil {
            errorMessage = "Could not send it. Try again."
        } else {
            draft = ""
            await store.load()
        }
        sending = false
    }
}

// MARK: - Write-up field

private struct WriteUpSectionField: View {
    @Bindable var store: CoachOrderStore
    let index: Int

    @State private var recorder = VoiceRecorderModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                SectionHeading(store.sections[index].label)
                Spacer()
                DictateButton(recorder: recorder) { result in
                    guard let transcript = result.transcript?
                        .trimmingCharacters(in: .whitespacesAndNewlines),
                        !transcript.isEmpty
                    else { return }
                    let body = store.sections[index].body
                    store.sections[index].body =
                        body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            ? transcript : body + "\n" + transcript
                    store.scheduleDocumentSave()
                } onError: {
                    store.sectionNote = "Could not process the recording."
                }
            }
            TextField(
                "", text: Binding(
                    get: { store.sections[index].body },
                    set: {
                        store.sections[index].body = $0
                        store.scheduleDocumentSave()
                    }
                ), axis: .vertical
            )
            .lineLimit(4...16)
            .plField()
        }
    }
}

// MARK: - Attachments

private struct AttachmentManagerView: View {
    let store: CoachOrderStore

    @State private var importing = false
    @State private var busy = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(store.attachments) { attachment in
                HStack(spacing: 12) {
                    Text(attachment.filename)
                        .font(.plBody)
                        .foregroundStyle(PL.text200)
                        .lineLimit(1)
                    Spacer()
                    Button("Remove") {
                        Task { await store.removeAttachment(attachment) }
                    }
                    .buttonStyle(PLSoftDestructiveButtonStyle())
                }
                .plInnerRow()
            }
            HStack(spacing: 12) {
                Button(busy ? "Uploading" : "Add a file") { importing = true }
                    .buttonStyle(PLSecondaryButtonStyle())
                    .disabled(busy)
                Text("A practice plan, a drill sheet, anything up to 50 MB.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            if let errorMessage {
                Text(errorMessage).font(.plCaption).foregroundStyle(PL.warningText)
            }
        }
        .fileImporter(
            isPresented: $importing,
            allowedContentTypes: [
                .pdf, .jpeg, .png, .webP, .mpeg4Movie, .quickTimeMovie, .plainText,
                .init(filenameExtension: "doc") ?? .data,
                .init(filenameExtension: "docx") ?? .data,
            ]
        ) { result in
            guard case .success(let url) = result else { return }
            Task {
                busy = true
                errorMessage = await store.uploadAttachment(url)
                busy = false
            }
        }
    }
}

// MARK: - Tools + gates

private struct ToolsCard: View {
    @Bindable var store: CoachOrderStore

    @State private var busyTool: String?
    @State private var toolNote: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeading("Tools")
            HStack(spacing: 10) {
                Button(busyTool == "tidy" ? "Tidying" : "Tidy up") {
                    Task { await run("tidy") }
                }
                .buttonStyle(PLSecondaryButtonStyle())
                .disabled(busyTool != nil)
                if store.undoSections != nil {
                    Button("Undo") {
                        store.undoTidy()
                        toolNote = "Put back the way you wrote it."
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                }
                Button(busyTool == "check" ? "Checking" : "Review") {
                    Task { await run("check") }
                }
                .buttonStyle(PLSecondaryButtonStyle())
                .disabled(busyTool != nil)
            }
            if let toolNote {
                Text(toolNote).font(.plCaption).foregroundStyle(PL.text500)
            }
            Rectangle().fill(PL.edge.opacity(0.5)).frame(height: 1)
            checkRow(
                done: store.sections.contains {
                    !$0.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                },
                "The write-up has something in it"
            )
            checkRow(
                done: store.findings.contains { !store.pointIds(for: $0.id).isEmpty },
                "A pattern has at least one point on it"
            )
            checkRow(done: store.sectionWordCount >= 120, "Long enough to feel worth the price")
            ForEach(store.answeredQuestions, id: \.question) { item in
                checkRow(
                    done: item.covered,
                    item.covered ? "Covered \(item.question)" : "Nothing yet on \(item.question)"
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 18)
    }

    private func checkRow(done: Bool, _ label: String) -> some View {
        HStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(done ? PL.cyan.opacity(0.15) : .clear)
                    .frame(width: 18, height: 18)
                Circle()
                    .strokeBorder(done ? .clear : PL.edge, lineWidth: 1.5)
                    .frame(width: 18, height: 18)
                if done {
                    Image(systemName: "checkmark")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(PL.cyan)
                }
            }
            Text(label)
                .font(.plBody)
                .foregroundStyle(done ? PL.text400 : PL.text300)
        }
    }

    private func run(_ action: String) async {
        busyTool = action
        toolNote = nil
        toolNote = await store.runAssist(action)
        busyTool = nil
    }
}

// MARK: - Deliver

private struct DeliverCard: View {
    let store: CoachOrderStore
    let detail: ReviewOrderDetail
    let onChanged: () -> Void

    @State private var confirming = false
    @State private var busy = false
    @State private var errorMessage: String?

    var body: some View {
        let blocker = store.deliveryBlockerSentence
        VStack(alignment: .leading, spacing: 12) {
            if confirming {
                Text("Deliver this review to \(detail.studentName)? It locks when it ships.")
                    .font(.plBody)
                    .foregroundStyle(PL.text200)
                HStack(spacing: 10) {
                    Button(busy ? "Delivering" : "Deliver") {
                        Task { await deliver() }
                    }
                    .buttonStyle(PLPrimaryButtonStyle())
                    .disabled(busy)
                    Button("Not yet") { confirming = false }
                        .buttonStyle(PLSecondaryButtonStyle())
                        .disabled(busy)
                }
            } else {
                Button("Deliver the review") { confirming = true }
                    .buttonStyle(PLPrimaryButtonStyle())
                    .frame(maxWidth: .infinity)
                    .disabled(blocker != nil)
                if let blocker {
                    Text(blocker)
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                }
            }
            if let errorMessage {
                Text(errorMessage).font(.plCaption).foregroundStyle(PL.warningText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 18)
    }

    private func deliver() async {
        busy = true
        errorMessage = nil
        await store.flushDocumentSave()
        if let code = await store.transition("deliver") {
            errorMessage = transitionErrorCopy(code)
        } else {
            await store.load()
            onChanged()
        }
        busy = false
    }
}
