import SwiftUI
import Supabase

/// The one gate in front of every feature that sends the account's content
/// to OpenAI or Deepgram (App Review 5.1.2(i)). Since 2026-09-26 that
/// includes recording and uploading a match: every match has still frames
/// checked by OpenAI, so the New match doors, the shutter and the upload
/// screen all ask here first. It replaced the one-time "I have the right
/// to upload this video" question, whose promise lives in the Terms.
///
/// Caches player_profiles.ai_features_enabled from sign-in. When it is not
/// true, `ensure()` raises the consent sheet over whatever is on screen and
/// answers with the tap. The routes enforce the same rule and answer 403
/// ai_consent_required; API.send turns that into the same sheet and one
/// retry, so a stale cache cannot leave a feature dead.
///
/// The sheet is presented through UIKit rather than a SwiftUI `.sheet`:
/// most of the callers are themselves sheets (the composers, the lesson
/// recorder), and a second SwiftUI presentation hung off the same tree is
/// silently dropped. The top view controller can always present one more.
@Observable
final class AiConsent {
    static let shared = AiConsent()

    /// nil: never asked. false: switched off in Account. Either shows the
    /// sheet on the next use.
    var enabled: Bool?
    /// app_config ai_consent_version, stamped on the row with Allow.
    var consentVersion: String?
    private(set) var presenting = false
    private var waiters: [CheckedContinuation<Bool, Never>] = []
    private weak var host: UIViewController?

    /// Thrown by the Core helpers whose callers expect a value, so a
    /// declined sheet reads as "nothing happened" rather than a failure.
    struct Declined: LocalizedError {
        var errorDescription: String? { "Not available until you allow it in Account." }
    }

    static let fallbackVersion = "2026-09-26"

    func seed(enabled: Bool?) { self.enabled = enabled }
    func reset() { enabled = nil }

    /// True straight away when allowed; otherwise the sheet, and the tap.
    func ensure() async -> Bool {
        if enabled == true { return true }
        return await ask()
    }

    /// A route said ai_consent_required while the cache said allowed. The
    /// server is the authority, so the cache yields and the sheet shows.
    func serverRequired() async -> Bool {
        if enabled == true { enabled = false }
        return await ask()
    }

    private func ask() async -> Bool {
        if presenting {
            return await withCheckedContinuation { waiters.append($0) }
        }
        guard let top = Self.topViewController() else { return false }
        presenting = true
        let sheet = UIHostingController(rootView: AiConsentSheet())
        sheet.view.backgroundColor = UIColor(PL.surface)
        sheet.overrideUserInterfaceStyle = .dark
        if let presentation = sheet.sheetPresentationController {
            presentation.detents = [.custom { _ in AiConsentSheet.detentHeight }]
            presentation.prefersGrabberVisible = true
        }
        host = sheet
        top.present(sheet, animated: true)
        return await withCheckedContinuation { waiters.append($0) }
    }

    /// The sheet's answer, handed to everyone waiting on it. Idempotent:
    /// the swipe-down that follows an Allow finds nothing left to resolve.
    func resolve(_ allowed: Bool) {
        guard presenting else { return }
        presenting = false
        let pending = waiters
        waiters = []
        for waiter in pending { waiter.resume(returning: allowed) }
    }

    /// Takes the sheet down, then runs `completion`. The answer is handed
    /// out from there rather than before, so a caller that presents
    /// something next (the camera, the Photos picker) is not refused by
    /// UIKit for presenting while the sheet is still leaving.
    func dismissSheet(completion: @escaping () -> Void = {}) {
        guard let sheet = host else {
            completion()
            return
        }
        host = nil
        sheet.dismiss(animated: true, completion: completion)
    }

    /// Writes the switch. On: true with the timestamp and the config
    /// version. Off: false, and the sheet returns on the next use.
    func setEnabled(_ value: Bool) async -> Bool {
        guard let uid = try? await supa.auth.session.user.id else { return false }
        struct Row: Encodable {
            let user_id: String
            let ai_features_enabled: Bool
            let ai_consent_at: String?
            let ai_consent_version: String?
        }
        let previous = enabled
        enabled = value
        do {
            try await supa
                .from("player_profiles")
                .upsert(Row(
                    user_id: uid.uuidString.lowercased(),
                    ai_features_enabled: value,
                    ai_consent_at: value ? ISO8601DateFormatter().string(from: Date()) : nil,
                    ai_consent_version: value ? (consentVersion ?? Self.fallbackVersion) : nil
                ))
                .execute()
            return true
        } catch {
            enabled = previous
            return false
        }
    }

    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive || $0.activationState == .foregroundInactive }
        let window = scenes.flatMap(\.windows).first { $0.isKeyWindow }
            ?? scenes.first?.windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController, !presented.isBeingDismissed {
            top = presented
        }
        return top
    }
}
