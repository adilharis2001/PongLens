import PhotosUI
import SwiftUI
import Supabase

/// "Your page" — the storefront editor. Mirrors ProfileEditor.tsx: photo,
/// drafter, the labelled fields, your own sections, samples, publish.
struct CoachProfileScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(AppState.self) private var app
    @Environment(CoachStore.self) private var coach

    @State private var name = ""
    @State private var headline = ""
    @State private var credentials = ""
    @State private var bio = ""
    @State private var sections: [CoachSection] = []
    @State private var samples: [CoachSample] = []
    @State private var published = false
    @State private var hydrated = false
    @State private var saving = false
    @State private var savedFlash = false
    @State private var errorMessage: String?

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

                    Text("Your page")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    if let handle = coach.profile?.handle {
                        HStack(spacing: 4) {
                            Text("ponglens.com/coach/\(handle) ·")
                                .font(.plCaption)
                                .foregroundStyle(PL.text500)
                            Button("view it") {
                                openURL(AppConfig.apiBase.appendingPathComponent("coach/\(handle)"))
                            }
                            .font(.plCaption)
                            .foregroundStyle(PL.cyan)
                            .buttonStyle(.plain)
                        }
                    }

                    mainCard
                    samplesCard
                    publishCard
                }
                .padding(20)
                .padding(.bottom, 60)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await coach.load(userId: app.userId)
            hydrate()
        }
    }

    private func hydrate() {
        guard !hydrated, let profile = coach.profile else { return }
        hydrated = true
        name = profile.displayName
        headline = profile.headline
        credentials = profile.credentials.joined(separator: "\n")
        bio = profile.bio
        sections = profile.sections ?? []
        samples = profile.samples
        published = profile.published
    }

    // MARK: - Main card

    private var mainCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            PhotoBlock()
            ProfileDrafter { draft in
                if !draft.headline.isEmpty { headline = draft.headline }
                if !draft.credentials.isEmpty {
                    credentials = draft.credentials.joined(separator: "\n")
                }
                if !draft.bio.isEmpty { bio = draft.bio }
                // Sections merge, never replace: keep what exists, add
                // new titles, cap at six.
                let existing = Set(
                    sections.map { $0.title.trimmingCharacters(in: .whitespaces).lowercased() }
                )
                let fresh = draft.sections.filter {
                    !existing.contains($0.title.trimmingCharacters(in: .whitespaces).lowercased())
                }
                sections = Array((sections + fresh).prefix(6))
            }

            labelled("Name") {
                TextField("", text: $name).plField()
            }
            labelled("Headline") {
                TextField("Club coach, former national team", text: $headline)
                    .plField()
            }
            labelled("Credentials") {
                TextField(
                    "One per line\nLevel 2 certified\n20 years coaching",
                    text: $credentials, axis: .vertical
                )
                .lineLimit(3...8)
                .plField()
            }
            labelled("About you") {
                TextField(
                    "How you coach and who you work with.", text: $bio, axis: .vertical
                )
                .lineLimit(6...14)
                .plField()
            }

            sectionsBlock

            if let errorMessage {
                Text(errorMessage).font(.plCaption).foregroundStyle(PL.warningText)
            }

            Button(saving ? "Saving" : savedFlash ? "Saved" : "Save") {
                Task { await save(published) }
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .frame(maxWidth: .infinity)
            .disabled(saving)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 18)
    }

    private func labelled(
        _ label: String, @ViewBuilder content: () -> some View
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeading(label)
            content()
        }
    }

    private var sectionsBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionHeading("Your own sections")
                Spacer()
                if sections.count < 6 {
                    Button("+ Add a section") {
                        sections.append(CoachSection(title: "", body: ""))
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                }
            }
            if sections.isEmpty {
                Text("Anything else worth its own heading.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            ForEach(sections.indices, id: \.self) { i in
                VStack(alignment: .leading, spacing: 8) {
                    TextField("Section title, like Equipment", text: $sections[i].title)
                        .plField()
                    TextField(
                        "What you want to say under that heading.",
                        text: $sections[i].body, axis: .vertical
                    )
                    .lineLimit(3...8)
                    .plField()
                    Button("Remove") { sections.remove(at: i) }
                        .buttonStyle(PLSoftDestructiveButtonStyle())
                }
                .padding(12)
                .background(PL.surface2.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
            }
        }
    }

    private func save(_ nextPublished: Bool) async {
        guard let profile = coach.profile else { return }
        saving = true
        errorMessage = nil
        struct Update: Encodable {
            let display_name: String
            let headline: String
            let bio: String
            let credentials: [String]
            let sections: [CoachSection]
            let published: Bool
            let updated_at: String
        }
        let update = Update(
            display_name: String(name.trimmingCharacters(in: .whitespaces).prefix(80)),
            headline: String(
                headline.replacingOccurrences(of: "\n", with: " ")
                    .trimmingCharacters(in: .whitespaces).prefix(120)
            ),
            bio: String(bio.trimmingCharacters(in: .whitespacesAndNewlines).prefix(2000)),
            credentials: credentials.split(separator: "\n")
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
                .prefix(8).map { String($0.prefix(60)) },
            sections: sections.map {
                CoachSection(
                    title: String($0.title.trimmingCharacters(in: .whitespaces).prefix(60)),
                    body: String($0.body.trimmingCharacters(in: .whitespacesAndNewlines).prefix(600))
                )
            }.filter { !$0.title.isEmpty && !$0.body.isEmpty }.prefix(6).map { $0 },
            published: nextPublished,
            updated_at: ISO8601DateFormatter().string(from: Date())
        )
        do {
            try await supa.from("coach_profiles").update(update)
                .eq("user_id", value: profile.userId.uuidString.lowercased())
                .execute()
            published = nextPublished
            savedFlash = true
            Task {
                try? await Task.sleep(for: .seconds(1.6))
                savedFlash = false
            }
            await coach.load(userId: app.userId)
        } catch {
            errorMessage = "Could not save. Try again."
        }
        saving = false
    }

    // MARK: - Samples

    private var samplesCard: some View {
        SamplesBlock(samples: $samples) { next in
            guard let profile = coach.profile else { return }
            struct Update: Encodable {
                let samples: [CoachSample]
                let updated_at: String
            }
            _ = try? await supa.from("coach_profiles")
                .update(Update(
                    samples: next,
                    updated_at: ISO8601DateFormatter().string(from: Date())
                ))
                .eq("user_id", value: profile.userId.uuidString.lowercased())
                .execute()
        }
    }

    // MARK: - Publish

    private var publishCard: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(published ? "Your page is live" : "Your page is hidden")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Text(
                    published
                        ? "Anyone with the link can see it."
                        : "Publish it when your offerings are ready."
                )
                .font(.plCaption)
                .foregroundStyle(PL.text400)
            }
            Spacer()
            if published {
                Button("Hide") { Task { await save(false) } }
                    .buttonStyle(PLSecondaryButtonStyle())
                    .disabled(saving)
            } else {
                Button("Publish") { Task { await save(true) } }
                    .buttonStyle(PLPrimaryButtonStyle())
                    .disabled(saving)
            }
        }
        .plCard(padding: 18)
    }
}

// MARK: - Photo

private struct PhotoBlock: View {
    @State private var url: URL?
    @State private var photoItem: PhotosPickerItem?
    @State private var uploading = false
    @State private var note: String?

    var body: some View {
        HStack(spacing: 14) {
            Group {
                if let url {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFill()
                        } else {
                            placeholder
                        }
                    }
                } else {
                    placeholder
                }
            }
            .frame(width: 64, height: 64)
            .clipShape(Circle())

            PhotosPicker(selection: $photoItem, matching: .images) {
                Text(uploading ? "Uploading" : url == nil ? "Add a photo" : "Replace photo")
                    .font(.plButtonSecondary)
                    .foregroundStyle(PL.text300)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
            }
            .disabled(uploading)

            if let note {
                Text(note).font(.plCaption).foregroundStyle(PL.warningText)
            }
        }
        .task { await refresh() }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task { await upload(item) }
        }
    }

    private var placeholder: some View {
        Circle()
            .strokeBorder(PL.edge, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
            .overlay(
                Image(systemName: "person")
                    .font(.system(size: 20))
                    .foregroundStyle(PL.text600)
            )
    }

    private func refresh() async {
        struct Res: Decodable { let url: String? }
        let res: Res? = try? await API.get("api/coach-photo")
        url = res?.url.flatMap(URL.init)
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
            note = "Photos are limited to 4 MB."
            return
        }
        struct Res: Decodable { let photo_path: String }
        do {
            let res: Res = try await API.postMultipart(
                "api/coach-photo", field: "image", filename: "photo.jpg",
                mime: "image/jpeg", data: data
            )
            struct Update: Encodable { let photo_path: String }
            _ = try? await supa.from("coach_profiles")
                .update(Update(photo_path: res.photo_path))
                .execute()
            await refresh()
        } catch {
            note = "Could not upload. Try again."
        }
    }
}

// MARK: - Drafter

/// "Write it for me" — a pure form filler. Nothing persists until Save.
private struct ProfileDrafter: View {
    let onDraft: (ProfileDraft) -> Void

    @State private var open = false
    @State private var brief = ""
    @State private var busy = false
    @State private var note: String?
    @State private var recorder = VoiceRecorderModel()

    var body: some View {
        if open {
            VStack(alignment: .leading, spacing: 10) {
                Text("Tell me about your coaching")
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                Text("Who you coach, what you are good at, how long you have been at it.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text400)
                TextField(
                    "Nine years at my club, mostly adults in the local league.",
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
                    Button("Cancel") { open = false }
                        .buttonStyle(PLSecondaryButtonStyle())
                    Spacer()
                    Button(busy ? "Writing" : "Write my page") {
                        Task { await write() }
                    }
                    .buttonStyle(PLPrimaryButtonStyle())
                    .disabled(busy || brief.trimmingCharacters(in: .whitespaces).count < 15)
                }
            }
            .padding(14)
            .background(PL.surface2.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                    .strokeBorder(PL.cyan.opacity(0.4), lineWidth: 1)
            )
        } else {
            Button {
                open = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 13))
                    Text("Write it for me")
                        .font(.plButton)
                }
                .foregroundStyle(PL.cyan)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .overlay(Capsule().strokeBorder(PL.cyan.opacity(0.4), lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }

    private func write() async {
        busy = true
        note = nil
        struct Req: Encodable { let brief: String }
        do {
            let draft: ProfileDraft = try await API.post(
                "api/profile/draft",
                Req(brief: brief.trimmingCharacters(in: .whitespacesAndNewlines))
            )
            onDraft(draft)
            open = false
        } catch let APIError.http(_, code) {
            note = draftErrorCopy(code)
        } catch {
            note = "Could not write it. Try again."
        }
        busy = false
    }
}

struct ProfileDraft: Decodable {
    let headline: String
    let credentials: [String]
    let bio: String
    let sections: [CoachSection]
}

// MARK: - Samples

/// "Your play" — link a match or any video so students can watch you.
private struct SamplesBlock: View {
    @Binding var samples: [CoachSample]
    let persist: ([CoachSample]) async -> Void

    @Environment(AppState.self) private var app
    @State private var pickerOpen = false
    @State private var myMatches: [MatchRow]?
    @State private var label = ""
    @State private var urlText = ""
    @State private var note: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Your play")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
            Text("Students trust a coach they can watch. Link a match or any video.")
                .font(.plCaption)
                .foregroundStyle(PL.text400)

            ForEach(samples, id: \.url) { sample in
                HStack(spacing: 12) {
                    Text(sample.label)
                        .font(.plBody)
                        .foregroundStyle(PL.text200)
                        .lineLimit(1)
                    Spacer()
                    Button("Remove") {
                        var next = samples
                        next.removeAll { $0.url == sample.url }
                        samples = next
                        Task { await persist(next) }
                    }
                    .buttonStyle(PLSoftDestructiveButtonStyle())
                }
                .plInnerRow()
            }

            HStack(spacing: 10) {
                Button(pickerOpen ? "Close" : "One of your matches") {
                    pickerOpen.toggle()
                    if pickerOpen && myMatches == nil {
                        Task { await loadMatches() }
                    }
                }
                .buttonStyle(PLSecondaryButtonStyle())
                Text("or paste any video link")
                    .font(.plCaption)
                    .foregroundStyle(PL.text600)
            }

            if pickerOpen {
                if let matches = myMatches {
                    if matches.isEmpty {
                        Text("No ready matches yet.")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                    } else {
                        VStack(spacing: 6) {
                            ForEach(matches.prefix(20)) { match in
                                Button {
                                    Task { await addMatchSample(match) }
                                } label: {
                                    HStack {
                                        Text(matchLabel(match))
                                            .font(.plBody)
                                            .foregroundStyle(PL.text200)
                                            .lineLimit(1)
                                        Spacer()
                                    }
                                    .plInnerRow(padding: 10)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                } else {
                    Text("Loading your matches…")
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                }
            }

            HStack(spacing: 8) {
                TextField("Label", text: $label)
                    .plField()
                    .frame(width: 110)
                TextField("https://", text: $urlText)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .plField()
                Button("Add") { Task { await addLink() } }
                    .buttonStyle(PLCyanGhostButtonStyle())
                    .disabled(urlText.isEmpty)
            }

            if let note {
                Text(note).font(.plCaption).foregroundStyle(PL.warningText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 18)
    }

    private func matchLabel(_ match: MatchRow) -> String {
        var parts: [String] = []
        if let opponent = match.opponentName, !opponent.isEmpty {
            parts.append("vs \(opponent)")
        }
        parts.append(PGDate.shortDate(match.playedAt))
        return parts.joined(separator: " · ")
    }

    private func loadMatches() async {
        guard let uid = app.userId?.uuidString.lowercased() else { return }
        let rows: [MatchRow]? = try? await supa.from("matches")
            .select(MatchRow.librarySelect)
            .eq("user_id", value: uid)
            .eq("status", value: "ready")
            .order("created_at", ascending: false)
            .limit(20)
            .execute().value
        myMatches = rows ?? []
    }

    private func addMatchSample(_ match: MatchRow) async {
        struct Req: Encodable { let matchId: String }
        struct Res: Decodable { let url: String }
        note = nil
        guard let res: Res = try? await API.post(
            "api/share", Req(matchId: match.id.uuidString.lowercased())
        ) else {
            note = "Could not create the link. Try again."
            return
        }
        guard !samples.contains(where: { $0.url == res.url }) else { return }
        var next = samples
        next.append(CoachSample(label: matchLabel(match), url: res.url))
        samples = next
        await persist(next)
    }

    private func addLink() async {
        guard urlText.range(of: "^https?://.+", options: .regularExpression) != nil else {
            note = "Links start with http or https."
            return
        }
        note = nil
        var next = samples
        next.append(
            CoachSample(
                label: label.trimmingCharacters(in: .whitespaces).isEmpty
                    ? "Watch" : String(label.prefix(60)),
                url: urlText
            )
        )
        samples = next
        label = ""
        urlText = ""
        await persist(next)
    }
}
