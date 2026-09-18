import Foundation
import Supabase

/// The first-upload confirmation and the terms backstop, cached from
/// player_profiles at sign-in. New accounts only: existing rows were
/// backfilled, so `needed` is false for them from the first read.
@Observable
final class UploadConsent {
    static let shared = UploadConsent()

    private(set) var confirmedAt: String?
    private(set) var loaded = false
    /// A route answered 403 terms_required: the account never accepted the
    /// terms. RootView watches this and sends the account back through
    /// onboarding.
    var termsRequired = false

    /// Show the row. Unknown (the read failed) is treated as confirmed:
    /// guessing "no" would put the checkbox in front of every existing
    /// account that opened the app offline.
    var needed: Bool { loaded && confirmedAt == nil }

    static let label = "I have the right to upload this video, including a parent's permission for anyone under 18 in it."

    func seed(confirmedAt: String?, loaded: Bool) {
        self.confirmedAt = confirmedAt
        self.loaded = loaded
    }

    func reset() {
        confirmedAt = nil
        loaded = false
        termsRequired = false
    }

    /// A route said upload_confirmation_required: the row shows again
    /// wherever the next upload starts.
    func noteConfirmationRequired() {
        confirmedAt = nil
        loaded = true
    }

    /// Save the answer, at the moment an upload actually begins.
    ///
    /// The tick itself writes nothing. It used to: the box saved
    /// upload_confirmed_at the instant it was touched, so somebody who
    /// ticked it and then closed the app without uploading was confirmed
    /// for good, and their first real upload went up with no confirmation
    /// in front of it. The words on the box say "this video", so the
    /// answer belongs to the upload, not to the tap.
    ///
    /// True when there was nothing to save. False only when the write
    /// failed, which is the caller's cue to stop and say so: the upload
    /// route checks the same column and would refuse anyway.
    func confirmIfNeeded() async -> Bool {
        guard needed else { return true }
        return await confirm()
    }

    /// Writes upload_confirmed_at, after which the row never shows again
    /// on any device.
    private func confirm() async -> Bool {
        guard let uid = try? await supa.auth.session.user.id else { return false }
        let stamp = ISO8601DateFormatter().string(from: Date())
        struct Row: Encodable {
            let user_id: String
            let upload_confirmed_at: String
        }
        do {
            try await supa
                .from("player_profiles")
                .upsert(Row(user_id: uid.uuidString.lowercased(), upload_confirmed_at: stamp))
                .execute()
            confirmedAt = stamp
            loaded = true
            return true
        } catch {
            return false
        }
    }

    /// The two refusals the upload routes answer with, in words an upload
    /// row can show. nil for anything else.
    static func refusalCopy(_ code: String) -> String? {
        switch code {
        case "upload_confirmation_required":
            return "Confirm you have the right to upload this video, then try again."
        case "terms_required":
            return "Accept the terms to continue, then try again."
        default:
            return nil
        }
    }
}
