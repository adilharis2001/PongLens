import PhotosUI
import SwiftUI

// The pieces the journal composer and the coach's entry composer share:
// dictation, one photo, and the way an entry's text is drawn once it has
// been saved. They were one composer's private code until the coach side
// needed all three, and copying them is how two screens end up disagreeing
// about what the same entry is.

// MARK: - Dictation

/// Dictation as a row rather than a floating circle. Inside a form the
/// thing people press is a row, and a circle has to invent its own
/// recording banner beside it; a row can just say what it is doing.
struct DictationRow: View {
    @Bindable var dictation: Dictation
    var disabled = false
    /// Words to add to the draft. Appended by the caller, never replacing.
    let onWords: (String) -> Void

    var body: some View {
        Button {
            switch dictation.state {
            case .recording: dictation.stop(onWords)
            case .idle: Task { await dictation.start() }
            case .transcribing: break
            }
        } label: {
            HStack(spacing: 12) {
                if dictation.state == .transcribing {
                    ProgressView().tint(PL.cyan)
                    Text("Writing it down…")
                } else {
                    Image(systemName: dictation.state == .recording ? "stop.fill" : "mic")
                        .foregroundStyle(dictation.state == .recording ? PL.dangerText : PL.cyan)
                    Text(dictation.state == .recording ? "Stop and write it down" : "Dictate it")
                }
                Spacer()
                if dictation.state == .recording {
                    Text(String(format: "%d:%02d", dictation.elapsed / 60, dictation.elapsed % 60))
                        .monospacedDigit()
                        .foregroundStyle(PL.text400)
                }
            }
            .contentShape(Rectangle())
        }
        .disabled(disabled || dictation.state == .transcribing)
    }
}

// MARK: - One photo

/// A photo being attached, before the entry exists.
///
/// The picture is uploaded straight away because the route checks it
/// before storing anything, and a refusal is only useful while the
/// composer is still open. `path` is nil until that check has passed.
@Observable
@MainActor
final class EntryPhotoDraft {
    /// A photo the entry already has. The editor seeds this so Replace
    /// and Remove know what they are acting on, and so cancelling can put
    /// it back; the composer leaves it nil.
    private(set) var savedPath: String?
    /// Whose photo to draw when nothing new has been picked.
    private(set) var savedOn: UUID?

    /// Locally picked, not yet saved.
    private(set) var image: UIImage?
    private(set) var path: String?
    private(set) var checking = false
    var errorMessage: String?

    init(existing path: String? = nil, on lessonId: UUID? = nil) {
        savedPath = path
        savedOn = path == nil ? nil : lessonId
        self.path = path
    }

    /// Nothing to show at all: no saved photo and nothing picked.
    ///
    /// `image` counts even before the upload finishes. The path is
    /// deliberately cleared while a new photo is being checked, so asking
    /// the path alone made the row fall back to "Add a photo" for the
    /// seconds where it should have been saying "Checking the photo…".
    var isEmpty: Bool { image == nil && path == nil }
    var isBusy: Bool { checking }
    /// Whether the save needs to mention the photo.
    var changed: Bool { path != savedPath }
    /// Draw the saved one when the current photo IS the saved one.
    var showsSaved: Bool { image == nil && path != nil && path == savedPath }

    func attach(_ image: UIImage) async {
        guard !checking else { return }
        let replaced = uploadedHere
        self.image = image
        path = nil
        checking = true
        errorMessage = nil
        defer { checking = false }
        guard let jpeg = EntryPhoto.jpeg(image) else {
            self.image = nil
            path = savedPath
            errorMessage = "Couldn't read that photo."
            return
        }
        do {
            path = try await EntryPhoto.upload(jpeg)
            // Only an object uploaded in THIS session. The entry's own
            // photo is the server's to delete when the save lands, and
            // deleting it here would empty an entry nobody saved.
            if let replaced { await EntryPhoto.discard(path: replaced) }
        } catch {
            self.image = nil
            path = savedPath
            errorMessage = (error as? APIError)?.errorDescription
                ?? "Couldn't add that photo."
        }
    }

    /// Take the photo off the entry. The saved object stays until Save,
    /// because Cancel has to be able to put it back.
    func remove() {
        let mine = uploadedHere
        image = nil
        path = nil
        errorMessage = nil
        if let mine { Task { await EntryPhoto.discard(path: mine) } }
    }

    /// The composer or editor closed without saving.
    func discard() {
        let mine = uploadedHere
        image = nil
        path = savedPath
        errorMessage = nil
        if let mine { Task { await EntryPhoto.discard(path: mine) } }
    }

    /// Saved: the entry owns whatever is attached now.
    func release() {
        if let on = savedOn, changed { EntryPhoto.forget(lessonId: on) }
        image = nil
        savedPath = path
    }

    /// The object this session uploaded and the entry does not own yet.
    private var uploadedHere: String? {
        guard let path, path != savedPath else { return nil }
        return path
    }
}

/// The attach row and, once there is one, the photo with a way back out.
struct EntryPhotoRow: View {
    @Bindable var draft: EntryPhotoDraft
    var disabled = false

    @State private var picked: PhotosPickerItem?

    var body: some View {
        Group {
            if draft.isEmpty {
                PhotosPicker(selection: $picked, matching: .images) {
                    HStack(spacing: 12) {
                        Image(systemName: "photo")
                            .foregroundStyle(PL.cyan)
                        Text("Add a photo")
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .disabled(disabled)
            } else {
                HStack(spacing: 12) {
                    if let image = draft.image {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 44, height: 44)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .opacity(draft.checking ? 0.5 : 1)
                    } else if draft.showsSaved, let on = draft.savedOn {
                        EntryPhotoThumb(lessonId: on)
                    }
                    if draft.checking {
                        ProgressView().tint(PL.cyan)
                        Text("Checking the photo…")
                            .foregroundStyle(PL.text400)
                    } else {
                        Text("Photo attached")
                    }
                    Spacer()
                    if !draft.checking {
                        // Replace lives on the picker so it is one tap,
                        // not "remove, then add".
                        PhotosPicker(selection: $picked, matching: .images) {
                            Text("Replace")
                        }
                        .disabled(disabled)
                        Button("Remove") { draft.remove() }
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(PL.text400)
                            .buttonStyle(.plain)
                            .disabled(disabled)
                    }
                }
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(PL.text400)
            }
        }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            // Cleared straight away so choosing the same photo twice in a
            // row still registers as a change.
            picked = nil
            Task {
                guard let data = try? await item.loadTransferable(type: Data.self),
                      let image = UIImage(data: data) else {
                    draft.errorMessage = "Couldn't read that photo."
                    return
                }
                await draft.attach(image)
            }
        }
    }
}

// MARK: - Drawing a saved entry

/// An entry's text, with its web addresses tappable.
///
/// `Linkify` finds the addresses; the text itself is never treated as
/// markup, so what a reader sees is always where the tap goes. Only http
/// and https are opened, which is why a `javascript:` or an app's own
/// scheme written into a note can never deep-link out of here.
struct EntryText: View {
    let text: String
    var font: Font = .plBody
    var color: Color = PL.text200
    var lineSpacing: CGFloat = 3

    var body: some View {
        Text(attributed)
            .font(font)
            .foregroundStyle(color)
            .lineSpacing(lineSpacing)
            .tint(PL.cyan)
            .environment(\.openURL, OpenURLAction { url in
                let scheme = url.scheme?.lowercased()
                guard scheme == "http" || scheme == "https" || scheme == "mailto" else {
                    return .discarded
                }
                return .systemAction
            })
    }

    private var attributed: AttributedString {
        var out = AttributedString()
        for span in Linkify.segments(text) {
            var piece = AttributedString(span.text)
            if let href = span.href, let url = URL(string: href) {
                piece.link = url
                piece.underlineStyle = .single
                piece.foregroundColor = PL.cyan
            }
            out.append(piece)
        }
        return out
    }
}

/// The photo on a saved entry. Signed on appear rather than behind a tap,
/// because a photo should just be there. One that comes back refused draws
/// nothing at all: the words are the entry, and a broken frame beside them
/// is worse than no frame.
struct EntryPhotoView: View {
    let lessonId: UUID

    @State private var url: URL?
    @State private var asked = false

    /// A VStack rather than a Group, and this is not a style choice. A
    /// Group whose contents resolve to nothing is an EmptyView, EmptyView
    /// never joins the render tree, and the `.task` hung off it never runs
    /// — so the photo sat there never asking for its own URL. A stack with
    /// no children is still a view, and still runs its modifiers.
    var body: some View {
        VStack(spacing: 0) {
            if let url {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else if phase.error != nil {
                        Color.clear
                    } else {
                        skeleton
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 180)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12).stroke(PL.edge, lineWidth: 1)
                )
            } else if !asked {
                skeleton
                    .frame(maxWidth: .infinity)
                    .frame(height: 180)
            }
        }
        .task(id: lessonId) {
            asked = false
            url = await EntryPhoto.url(lessonId: lessonId)
            asked = true
        }
    }

    private var skeleton: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12).fill(PL.edge.opacity(0.5))
            ProgressView().tint(PL.cyan)
        }
    }
}

/// The same photo at row size, for a list of entries. A card that stands
/// for an entry shows what the entry holds; a photo hidden until you open
/// it makes "see the photo" read like a broken note.
struct EntryPhotoThumb: View {
    let lessonId: UUID
    var side: CGFloat = 44

    @State private var url: URL?

    var body: some View {
        // A stack, not a Group, for the same reason EntryPhotoView is one:
        // modifiers on an empty view never run, so the task never fires.
        VStack(spacing: 0) {
            if let url {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        RoundedRectangle(cornerRadius: 8).fill(PL.edge.opacity(0.5))
                    }
                }
                .frame(width: side, height: side)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PL.edge, lineWidth: 1))
            } else {
                RoundedRectangle(cornerRadius: 8)
                    .fill(PL.edge.opacity(0.5))
                    .frame(width: side, height: side)
            }
        }
        .task(id: lessonId) { url = await EntryPhoto.url(lessonId: lessonId) }
    }
}
