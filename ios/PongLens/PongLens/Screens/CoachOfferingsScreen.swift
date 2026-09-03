import PhotosUI
import SwiftUI
import Supabase

/// The offerings builder. Mirrors OfferingsEditor.tsx: existing offerings
/// as expandable cards, new ones from a template, from scratch, or drafted
/// from a sentence. Nothing is live until Create.
struct CoachOfferingsScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @Environment(CoachStore.self) private var coach

    @State private var offerings: [OfferingRow] = []
    @State private var feeConfig = ReviewFeeConfig()
    @State private var loaded = false
    @State private var picking = false
    @State private var building: OfferingTemplate?
    @State private var describing: Int?
    @State private var drafted: [DraftedOffering]?

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

                    Text("Offerings")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    if !offerings.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeading("Your offerings")
                            ForEach(offerings) { offering in
                                OfferingCardView(
                                    offering: offering, feeConfig: feeConfig,
                                    onChanged: { Task { await refresh() } }
                                )
                                .id("\(offering.id)-\(offering.updatedAt)")
                            }
                        }
                    }

                    if let drafts = drafted {
                        if drafts.count > 1 {
                            Text("Your drafts")
                                .font(.plCardTitle)
                                .foregroundStyle(PL.text100)
                        }
                        ForEach(Array(drafts.enumerated()), id: \.offset) { i, item in
                            DraftBuilderView(
                                heading: drafts.count == 1
                                    ? "Your draft" : "Draft \(i + 1) of \(drafts.count)",
                                subline: "Written from what you told me. Change anything, and nothing is live until you create it.",
                                initial: OfferingDraft(from: item),
                                templateKey: "custom",
                                sortHint: offerings.count + i,
                                feeConfig: feeConfig,
                                onDone: {
                                    drafted = nil
                                    Task { await refresh() }
                                },
                                onDiscard: {
                                    drafted?.remove(at: i)
                                    if drafted?.isEmpty == true { drafted = nil }
                                }
                            )
                        }
                    } else if let count = describing {
                        DescribeBox(
                            count: count,
                            onCancel: { describing = nil },
                            onDrafts: { drafts in
                                describing = nil
                                drafted = drafts
                            }
                        )
                    } else if let template = building {
                        DraftBuilderView(
                            heading: template.key == "custom"
                                ? "New offering, from scratch"
                                : "The \(template.name.lowercased()) template",
                            subline: template.key == "custom"
                                ? "Nothing is live until you create it."
                                : "A starting point, not a finished offering. Change anything, and nothing is live until you create it.",
                            initial: OfferingDraft(from: template),
                            templateKey: template.key,
                            sortHint: offerings.count,
                            feeConfig: feeConfig,
                            onDone: {
                                building = nil
                                Task { await refresh() }
                            },
                            onDiscard: { building = nil }
                        )
                    } else if picking {
                        templatePicker
                    } else if loaded && offerings.isEmpty {
                        Button("Draft my offerings") { describing = 3 }
                            .buttonStyle(PLPrimaryButtonStyle())
                            .frame(maxWidth: .infinity)
                        dashedButton("+ Build one myself") { picking = true }
                    } else if loaded {
                        dashedButton("+ New offering") { picking = true }
                    }
                }
                .padding(20)
                .padding(.bottom, 60)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await refresh() }
    }

    private func dashedButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.plButtonSecondary)
                .foregroundStyle(PL.text300)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                        .strokeBorder(PL.edge, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                )
        }
        .buttonStyle(.plain)
    }

    private var templatePicker: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Start from a template")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
            ForEach(offeringTemplates, id: \.key) { template in
                Button {
                    building = template
                    picking = false
                } label: {
                    HStack(spacing: 12) {
                        stockThumb(template.image)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(template.name)
                                .font(.plRowTitle)
                                .foregroundStyle(PL.text100)
                            Text(template.blurb)
                                .font(.plCaption)
                                .foregroundStyle(PL.text500)
                        }
                        Spacer()
                    }
                    .plInnerRow()
                }
                .buttonStyle(.plain)
            }
            Button {
                describing = 1
                picking = false
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 15))
                        .foregroundStyle(PL.cyan)
                        .frame(width: 64, height: 42)
                        .background(PL.cyan.opacity(0.08), in: RoundedRectangle(cornerRadius: PL.rSmall, style: .continuous))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Write it for me")
                            .font(.plRowTitle)
                            .foregroundStyle(PL.cyan)
                        Text("Describe what you want and we'll write the draft.")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                    }
                    Spacer()
                }
                .padding(14)
                .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                        .strokeBorder(PL.cyan.opacity(0.4), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
            Button("Cancel") { picking = false }
                .buttonStyle(PLSecondaryButtonStyle())
                .frame(maxWidth: .infinity)
        }
    }

    private func refresh() async {
        guard let uid = app.userId?.uuidString.lowercased() else { return }
        async let offeringsQ: [OfferingRow]? = try? await supa
            .from("offerings").select(OfferingRow.fullSelect)
            .eq("coach_id", value: uid)
            .order("sort", ascending: true)
            .order("created_at", ascending: true)
            .execute().value
        async let feeQ = loadFeeConfig()
        let (rows, fee) = await (offeringsQ, feeQ)
        offerings = rows ?? []
        feeConfig = fee
        loaded = true
        await coach.load(userId: app.userId)
    }
}

// MARK: - Fee config

/// Mirrors getReviewFeeConfig(): app_config keys with the same fallbacks.
struct ReviewFeeConfig {
    var mode = "percent"
    var percent = 15
    var fixedCents = 500

    func coachShareCents(price: Int) -> Int {
        let fee = mode == "fixed"
            ? min(max(fixedCents, 0), price)
            : min(max(Int((Double(price) * Double(percent) / 100).rounded()), 0), price)
        return price - fee
    }
}

func loadFeeConfig() async -> ReviewFeeConfig {
    struct Row: Decodable {
        let key: String
        let value: String
    }
    let rows: [Row]? = try? await supa.from("app_config").select("key,value")
        .in("key", values: ["review_fee_mode", "review_fee_percent", "review_fee_fixed_cents"])
        .execute().value
    var config = ReviewFeeConfig()
    for row in rows ?? [] {
        switch row.key {
        case "review_fee_mode": config.mode = row.value
        case "review_fee_percent": config.percent = Int(row.value) ?? config.percent
        case "review_fee_fixed_cents": config.fixedCents = Int(row.value) ?? config.fixedCents
        default: break
        }
    }
    return config
}

@ViewBuilder
func stockThumb(_ image: String?) -> some View {
    if let image, image.hasPrefix("stock:"),
       let url = URL(
        string: AppConfig.apiBase.absoluteString
            + "/img/offerings/\(image.dropFirst("stock:".count)).webp"
       ) {
        AsyncImage(url: url) { phase in
            if let img = phase.image {
                img.resizable().scaledToFill()
            } else {
                PL.surface2
            }
        }
        .frame(width: 64, height: 42)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: PL.rSmall, style: .continuous))
    } else {
        RoundedRectangle(cornerRadius: PL.rSmall, style: .continuous)
            .strokeBorder(PL.edge, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
            .frame(width: 64, height: 42)
            .overlay(
                Text("No image").font(.system(size: 9)).foregroundStyle(PL.text600)
            )
    }
}

// MARK: - Draft model

/// The editable form state; list fields are newline-joined text, exactly
/// like the web Draft.
struct OfferingDraft {
    var title = ""
    var description = ""
    var price = ""
    var turnaround = 4
    var includes = ""
    var questions = ""
    var sections = ""
    var patterns = ""
    var followups = 1
    var image: String?
    var active = true

    init(from template: OfferingTemplate) {
        title = template.title
        description = template.description
        price = Self.priceString(template.priceCents)
        turnaround = template.turnaroundDays
        includes = template.includes.joined(separator: "\n")
        questions = template.intakeQuestions.map {
            $0.optional == true ? "\($0.label) (optional)" : $0.label
        }.joined(separator: "\n")
        sections = template.reviewSections.map(\.label).joined(separator: "\n")
        patterns = template.suggestedPatterns.joined(separator: "\n")
        followups = template.followupRounds
        image = template.image
    }

    init(from row: OfferingRow) {
        title = row.title
        description = row.description
        price = Self.priceString(row.priceCents)
        turnaround = row.turnaroundDays
        includes = row.includes.joined(separator: "\n")
        questions = row.intakeQuestions.map {
            $0.optional == true ? "\($0.label) (optional)" : $0.label
        }.joined(separator: "\n")
        sections = row.reviewSections.map(\.label).joined(separator: "\n")
        patterns = row.suggestedPatterns.joined(separator: "\n")
        followups = row.followupRounds
        image = row.image
        active = row.active
    }

    init(from drafted: DraftedOffering) {
        title = drafted.title
        description = drafted.description
        price = Self.priceString(drafted.price_cents)
        turnaround = drafted.turnaround_days
        includes = drafted.includes.joined(separator: "\n")
        questions = drafted.questions.joined(separator: "\n")
        sections = drafted.sections.joined(separator: "\n")
        patterns = drafted.patterns.joined(separator: "\n")
        followups = drafted.followup_rounds
        image = drafted.image
    }

    static func priceString(_ cents: Int) -> String {
        cents % 100 == 0
            ? String(cents / 100)
            : String(format: "%.2f", Double(cents) / 100)
    }

    /// nil when valid, else the sentence.
    var validationError: String? {
        if title.trimmingCharacters(in: .whitespaces).isEmpty {
            return "Give it a title."
        }
        guard let cents = parseUsdCents(price), cents >= 500, cents <= 50000 else {
            return "Price must be between $5 and $500."
        }
        return nil
    }
}

func offeringLines(_ text: String, cap: Int) -> [String] {
    text.split(separator: "\n").map {
        $0.trimmingCharacters(in: .whitespaces)
    }.filter { !$0.isEmpty }.prefix(cap).map { String($0) }
}

func offeringSlug(_ label: String, _ index: Int) -> String {
    let slug = label.lowercased()
        .replacingOccurrences(of: "[^a-z0-9]+", with: "_", options: .regularExpression)
        .trimmingCharacters(in: CharacterSet(charactersIn: "_"))
    let cut = String(slug.prefix(40))
    return cut.isEmpty ? "item_\(index + 1)" : cut
}

func offeringQuestions(_ text: String) -> [IntakeQuestion] {
    offeringLines(text, cap: 6).enumerated().map { i, line in
        let lower = line.lowercased()
        if lower.hasSuffix("(optional)") {
            let label = String(line.dropLast("(optional)".count))
                .trimmingCharacters(in: .whitespaces)
            return IntakeQuestion(id: offeringSlug(label, i), label: label, optional: true)
        }
        return IntakeQuestion(id: offeringSlug(line, i), label: line, optional: nil)
    }
}

func offeringSections(_ text: String) -> [ReviewSectionDef] {
    offeringLines(text, cap: 8).enumerated().map { i, line in
        ReviewSectionDef(key: offeringSlug(line, i), label: line)
    }
}

// MARK: - Row values (what gets written)

private struct OfferingValues: Encodable {
    let title: String
    let description: String
    let price_cents: Int
    let turnaround_days: Int
    let includes: [String]
    let intake_questions: [IntakeQuestion]
    let review_sections: [ReviewSectionDef]
    let suggested_patterns: [String]
    let followup_rounds: Int
    let image: String?
    let active: Bool

    init(_ draft: OfferingDraft, priceCents: Int) {
        title = String(draft.title.trimmingCharacters(in: .whitespaces).prefix(80))
        description = String(draft.description.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1000))
        price_cents = priceCents
        turnaround_days = draft.turnaround
        includes = offeringLines(draft.includes, cap: 10)
        intake_questions = offeringQuestions(draft.questions)
        review_sections = offeringSections(draft.sections)
        suggested_patterns = offeringLines(draft.patterns, cap: 8).map { String($0.prefix(80)) }
        followup_rounds = draft.followups
        image = draft.image
        active = draft.active
    }
}

// MARK: - New-offering builder

private struct DraftBuilderView: View {
    let heading: String
    let subline: String
    let initial: OfferingDraft
    let templateKey: String
    let sortHint: Int
    let feeConfig: ReviewFeeConfig
    let onDone: () -> Void
    let onDiscard: () -> Void

    @Environment(AppState.self) private var app
    @State private var draft: OfferingDraft
    @State private var busy = false
    @State private var errorMessage: String?

    init(
        heading: String, subline: String, initial: OfferingDraft, templateKey: String,
        sortHint: Int, feeConfig: ReviewFeeConfig,
        onDone: @escaping () -> Void, onDiscard: @escaping () -> Void
    ) {
        self.heading = heading
        self.subline = subline
        self.initial = initial
        self.templateKey = templateKey
        self.sortHint = sortHint
        self.feeConfig = feeConfig
        self.onDone = onDone
        self.onDiscard = onDiscard
        _draft = State(initialValue: initial)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(heading).font(.plCardTitle).foregroundStyle(PL.text100)
                Text(subline).font(.plCaption).foregroundStyle(PL.text500)
            }
            OfferingFieldsView(draft: $draft, feeConfig: feeConfig, offeringId: nil, showActive: false)
            if let errorMessage {
                Text(errorMessage).font(.plCaption).foregroundStyle(PL.warningText)
            }
            HStack {
                Button("Discard") { onDiscard() }
                    .buttonStyle(PLSoftDestructiveButtonStyle())
                Spacer()
                Button(busy ? "Creating" : "Create offering") {
                    Task { await create() }
                }
                .buttonStyle(PLPrimaryButtonStyle())
                .disabled(busy)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 18)
    }

    private func create() async {
        if let problem = draft.validationError {
            errorMessage = problem
            return
        }
        guard let uid = app.userId?.uuidString.lowercased(),
              let cents = parseUsdCents(draft.price) else { return }
        busy = true
        errorMessage = nil
        struct Insert: Encodable {
            let coach_id: String
            let template_key: String
            let sort: Int
            let values: OfferingValues

            func encode(to encoder: Encoder) throws {
                try values.encode(to: encoder)
                var container = encoder.container(keyedBy: Keys.self)
                try container.encode(coach_id, forKey: .coach_id)
                try container.encode(template_key, forKey: .template_key)
                try container.encode(sort, forKey: .sort)
            }

            enum Keys: String, CodingKey { case coach_id, template_key, sort }
        }
        do {
            try await supa.from("offerings").insert(
                Insert(
                    coach_id: uid, template_key: templateKey, sort: sortHint,
                    values: OfferingValues(draft, priceCents: cents)
                )
            ).execute()
            onDone()
        } catch {
            errorMessage = "Could not create it. Try again."
        }
        busy = false
    }
}

// MARK: - Existing offering card

private struct OfferingCardView: View {
    let offering: OfferingRow
    let feeConfig: ReviewFeeConfig
    let onChanged: () -> Void

    @State private var open = false
    @State private var draft: OfferingDraft
    @State private var saving = false
    @State private var confirmDelete = false
    @State private var errorMessage: String?

    init(offering: OfferingRow, feeConfig: ReviewFeeConfig, onChanged: @escaping () -> Void) {
        self.offering = offering
        self.feeConfig = feeConfig
        self.onChanged = onChanged
        _draft = State(initialValue: OfferingDraft(from: offering))
    }

    private var stillTemplate: Bool {
        guard let template = offeringTemplates.first(where: { $0.key == offering.templateKey }),
              template.key != "custom", !template.description.isEmpty
        else { return false }
        return offering.description == template.description
            && offering.includes.joined(separator: "\n")
                == template.includes.joined(separator: "\n")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                open.toggle()
            } label: {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 12) {
                        stockThumb(offering.image)
                        (Text(offering.title.isEmpty ? "Untitled" : offering.title)
                            .foregroundStyle(PL.text100)
                            + Text(offering.active ? "" : "  off").foregroundStyle(PL.text500))
                            .font(.plRowTitle)
                            .lineLimit(1)
                        Spacer()
                        Text(formatUsd(offering.priceCents))
                            .font(.plBody)
                            .monospacedDigit()
                            .foregroundStyle(PL.text200)
                    }
                    if !open && stillTemplate {
                        Text("Still the template wording.")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                    }
                }
                .padding(14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if open {
                VStack(alignment: .leading, spacing: 14) {
                    OfferingFieldsView(
                        draft: $draft, feeConfig: feeConfig,
                        offeringId: offering.id, showActive: true
                    )
                    if let errorMessage {
                        Text(errorMessage).font(.plCaption).foregroundStyle(PL.warningText)
                    }
                    HStack {
                        if confirmDelete {
                            Text("Delete this offering?")
                                .font(.plCaption)
                                .foregroundStyle(PL.text400)
                            Button("Yes, delete") { Task { await remove() } }
                                .buttonStyle(PLSoftDestructiveButtonStyle())
                            Button("Keep") { confirmDelete = false }
                                .buttonStyle(PLSecondaryButtonStyle())
                        } else {
                            Button("Delete") { confirmDelete = true }
                                .buttonStyle(PLSoftDestructiveButtonStyle())
                        }
                        Spacer()
                        Button(saving ? "Saving" : "Save") { Task { await save() } }
                            .buttonStyle(PLPrimaryButtonStyle())
                            .disabled(saving)
                    }
                }
                .padding(14)
            }
        }
        .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
    }

    private func save() async {
        if let problem = draft.validationError {
            errorMessage = problem
            return
        }
        guard let cents = parseUsdCents(draft.price) else { return }
        saving = true
        errorMessage = nil
        struct Update: Encodable {
            let values: OfferingValues
            let updated_at: String

            func encode(to encoder: Encoder) throws {
                try values.encode(to: encoder)
                var container = encoder.container(keyedBy: Keys.self)
                try container.encode(updated_at, forKey: .updated_at)
            }

            enum Keys: String, CodingKey { case updated_at }
        }
        do {
            try await supa.from("offerings").update(
                Update(
                    values: OfferingValues(draft, priceCents: cents),
                    updated_at: ISO8601DateFormatter().string(from: Date())
                )
            )
            .eq("id", value: offering.id.uuidString.lowercased())
            .execute()
            open = false
            onChanged()
        } catch {
            errorMessage = "Could not save. Try again."
        }
        saving = false
    }

    private func remove() async {
        do {
            try await supa.from("offerings").delete()
                .eq("id", value: offering.id.uuidString.lowercased()).execute()
            onChanged()
        } catch {
            errorMessage = "This offering has orders. Turn it off instead."
            confirmDelete = false
        }
    }
}

// MARK: - The fields

private struct OfferingFieldsView: View {
    @Binding var draft: OfferingDraft
    let feeConfig: ReviewFeeConfig
    let offeringId: UUID?
    let showActive: Bool

    private static let turnaroundChoices = [1, 2, 3, 4, 5, 7, 10, 14, 21, 30]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            field("Title", hint: "The name on your card and in their orders. Keep it short, since students scan a page of these.") {
                TextField("What you'd call it to a student", text: $draft.title)
                    .plField()
            }
            field("Description", hint: "A sentence or two under the title, on what you look at and what comes back.") {
                TextField(
                    "What you look at and what they get back.",
                    text: $draft.description, axis: .vertical
                )
                .lineLimit(3...8)
                .plField()
            }
            field("Card image", hint: "The picture on your card. Use one of ours or upload your own.") {
                OfferingImagePicker(image: $draft.image, offeringId: offeringId)
            }
            HStack(alignment: .top, spacing: 12) {
                field("Price", hint: "What a student pays. The line underneath shows what reaches you once our fee and the card charges come out.") {
                    HStack(spacing: 4) {
                        Text("$").font(.plBody).foregroundStyle(PL.text500)
                        TextField("30", text: $draft.price)
                            .keyboardType(.decimalPad)
                            .font(.plBody)
                            .foregroundStyle(PL.text100)
                            .tint(PL.cyan)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(PL.surface2.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                            .strokeBorder(PL.edge, lineWidth: 1)
                    )
                }
                field("Turnaround", hint: "How long you have to write the review. The clock starts when you accept the order, not when they pay.") {
                    Menu {
                        ForEach(Self.turnaroundChoices, id: \.self) { d in
                            Button(d == 1 ? "1 day" : "\(d) days") { draft.turnaround = d }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text(draft.turnaround == 1 ? "1 day" : "\(draft.turnaround) days")
                                .font(.plBody)
                                .foregroundStyle(PL.text100)
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(PL.text400)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .background(PL.surface2.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                                .strokeBorder(PL.edge, lineWidth: 1)
                        )
                    }
                }
            }
            if let cents = parseUsdCents(draft.price), cents >= 500, cents <= 50000 {
                Text("You receive \(formatUsd(feeConfig.coachShareCents(price: cents))). The rest covers card processing, video processing and hosting.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            field("What's included", hint: "The ticked list on your card. One per line. Say what actually arrives: how many patterns, whether there is a voice note, what the write-up covers.") {
                TextField("One per line", text: $draft.includes, axis: .vertical)
                    .lineLimit(4...10)
                    .plField()
            }
            field("Questions for the student", hint: "Students answer these when they send you the match, so ask for what changes how you watch it. One per line. End a line with (optional) and they can skip it.") {
                TextField(
                    "One per line. End a line with (optional) to make it optional.",
                    text: $draft.questions, axis: .vertical
                )
                .lineLimit(3...8)
                .plField()
            }
            field("Sections of your write-up", hint: "The headings you fill in while writing the review. One per line. Anything you leave empty never reaches the student, so a section that does not apply costs you nothing.") {
                TextField("One per line", text: $draft.sections, axis: .vertical)
                    .lineLimit(3...8)
                    .plField()
            }
            HStack(alignment: .top, spacing: 12) {
                field("Follow-up questions included", hint: "How many questions they can ask you after you deliver.") {
                    Menu {
                        ForEach(0...3, id: \.self) { n in
                            Button(String(n)) { draft.followups = n }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text(String(draft.followups))
                                .font(.plBody)
                                .foregroundStyle(PL.text100)
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(PL.text400)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .background(PL.surface2.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                                .strokeBorder(PL.edge, lineWidth: 1)
                        )
                    }
                }
                if showActive {
                    Toggle("Available to buy", isOn: $draft.active)
                        .font(.plBody)
                        .foregroundStyle(PL.text200)
                        .tint(PL.cyan)
                        .padding(.top, 22)
                }
            }
            field("Patterns to look for", hint: "Reminders to yourself, waiting in the workspace when you review a match. One per line. Tap one and it opens a pattern already named. Students never see them.") {
                TextField(
                    "One per line. Just for you, never shown to a student.",
                    text: $draft.patterns, axis: .vertical
                )
                .lineLimit(3...8)
                .plField()
            }
        }
    }

    @State private var openHint: String?

    private func field(
        _ label: String, hint: String, @ViewBuilder content: () -> some View
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                SectionHeading(label)
                Button {
                    openHint = openHint == label ? nil : label
                } label: {
                    Image(systemName: "info.circle")
                        .font(.system(size: 12))
                        .foregroundStyle(PL.text600)
                }
                .buttonStyle(.plain)
            }
            if openHint == label {
                Text(hint)
                    .font(.plCaption)
                    .foregroundStyle(PL.text400)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(PL.surface2.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
            }
            content()
        }
    }
}

// MARK: - Image picker

private struct OfferingImagePicker: View {
    @Binding var image: String?
    let offeringId: UUID?

    @State private var open = false
    @State private var photoItem: PhotosPickerItem?
    @State private var uploading = false
    @State private var note: String?
    @State private var uploadedPreview: UIImage?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                if let uploadedPreview, image?.hasPrefix("r2://") == true {
                    Image(uiImage: uploadedPreview)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 84, height: 56)
                        .clipped()
                        .clipShape(RoundedRectangle(cornerRadius: PL.rSmall, style: .continuous))
                } else if image?.hasPrefix("r2://") == true, let offeringId {
                    SignedOfferingImage(offeringId: offeringId)
                } else {
                    stockThumb(image)
                }
                Button(open ? "Done" : "Change image") { open.toggle() }
                    .buttonStyle(PLSecondaryButtonStyle())
                if image != nil && !open {
                    Button("Remove") { image = nil }
                        .buttonStyle(PLSoftDestructiveButtonStyle())
                }
            }
            if open {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(stockOfferingImages, id: \.self) { stock in
                            Button {
                                image = stock
                            } label: {
                                stockThumb(stock)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: PL.rSmall, style: .continuous)
                                            .strokeBorder(
                                                image == stock ? PL.cyan : .clear, lineWidth: 2
                                            )
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                        PhotosPicker(selection: $photoItem, matching: .images) {
                            Text(uploading ? "Uploading" : "Your own")
                                .font(.plCaption)
                                .foregroundStyle(PL.text400)
                                .frame(width: 72, height: 48)
                                .overlay(
                                    RoundedRectangle(cornerRadius: PL.rSmall, style: .continuous)
                                        .strokeBorder(PL.edge, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                                )
                        }
                        .disabled(uploading)
                    }
                }
            }
            if let note {
                Text(note).font(.plCaption).foregroundStyle(PL.warningText)
            }
        }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task { await upload(item) }
        }
    }

    private func upload(_ item: PhotosPickerItem) async {
        uploading = true
        note = nil
        defer {
            uploading = false
            photoItem = nil
        }
        guard let data = try? await item.loadTransferable(type: Data.self) else {
            note = "Could not read that image."
            return
        }
        guard data.count <= 4 * 1024 * 1024 else {
            note = "Images are limited to 4 MB."
            return
        }
        struct Res: Decodable { let image: String }
        do {
            let res: Res = try await API.postMultipart(
                "api/offering-image", field: "image", filename: "card.jpg",
                mime: "image/jpeg", data: data
            )
            image = res.image
            uploadedPreview = UIImage(data: data)
        } catch {
            note = "Could not upload. Try again."
        }
    }
}

/// The signed preview for an already-uploaded card image.
private struct SignedOfferingImage: View {
    let offeringId: UUID

    @State private var url: URL?

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        PL.surface2
                    }
                }
            } else {
                PL.surface2
            }
        }
        .frame(width: 84, height: 56)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: PL.rSmall, style: .continuous))
        .task {
            struct Res: Decodable { let url: String? }
            let res: Res? = try? await API.get(
                "api/offering-image", query: ["id": offeringId.uuidString.lowercased()]
            )
            url = res?.url.flatMap(URL.init)
        }
    }
}

// MARK: - AI drafts

struct DraftedOffering: Decodable {
    let title: String
    let description: String
    let includes: [String]
    let price_cents: Int
    let turnaround_days: Int
    let followup_rounds: Int
    let questions: [String]
    let sections: [String]
    let patterns: [String]
    let image: String
}

private struct DescribeBox: View {
    let count: Int
    let onCancel: () -> Void
    let onDrafts: ([DraftedOffering]) -> Void

    @State private var brief = ""
    @State private var busy = false
    @State private var note: String?
    @State private var recorder = VoiceRecorderModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(count == 1 ? "Describe this offering" : "Describe your coaching")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
            Text("What would you offer players, and who are you good for?")
                .font(.plBody)
                .foregroundStyle(PL.text400)
            TextField(
                "League players who keep losing to blockers.",
                text: $brief, axis: .vertical
            )
            .lineLimit(3...8)
            .plField()
            HStack(spacing: 10) {
                DictateButton(recorder: recorder) { result in
                    if let transcript = result.transcript?
                        .trimmingCharacters(in: .whitespacesAndNewlines), !transcript.isEmpty {
                        brief = brief.isEmpty ? transcript : brief + "\n" + transcript
                    }
                } onError: {
                    note = "Could not process the recording."
                }
                Text("or say it out loud")
                    .font(.plCaption)
                    .foregroundStyle(PL.text600)
            }
            if let note {
                Text(note).font(.plCaption).foregroundStyle(PL.warningText)
            }
            HStack {
                Button("Cancel") { onCancel() }
                    .buttonStyle(PLSecondaryButtonStyle())
                Spacer()
                Button(
                    busy ? "Writing" : count == 1 ? "Write a draft" : "Write three drafts"
                ) {
                    Task { await write() }
                }
                .buttonStyle(PLPrimaryButtonStyle())
                .disabled(busy || brief.trimmingCharacters(in: .whitespaces).count < 15)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 18)
    }

    private func write() async {
        busy = true
        note = nil
        struct Req: Encodable {
            let brief: String
            let count: Int
        }
        struct Res: Decodable { let drafts: [DraftedOffering] }
        do {
            let res: Res = try await API.post(
                "api/offerings/draft",
                Req(brief: brief.trimmingCharacters(in: .whitespacesAndNewlines), count: count)
            )
            if res.drafts.isEmpty {
                note = "Could not write it. Try again."
            } else {
                onDrafts(res.drafts)
            }
        } catch let APIError.http(_, code) {
            note = draftErrorCopy(code)
        } catch {
            note = "Could not write it. Try again."
        }
        busy = false
    }
}

/// Shared error copy for both AI drafters.
func draftErrorCopy(_ code: String) -> String {
    switch code {
    case "too_short": "Tell me a little more and I can make a better start."
    case "too_many": "That is enough drafting for now. Try again in an hour."
    case "not_a_coach": "Set up your coach page first."
    case "unavailable": "Drafting is not available right now."
    default: "Could not write it. Try again."
    }
}
