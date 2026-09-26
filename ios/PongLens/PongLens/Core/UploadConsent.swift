import Foundation

/// What the upload routes refuse with, and the terms backstop.
///
/// Until 2026-09-26 this also held the one-time "I have the right to
/// upload this video" confirmation. That question is gone: its promise is
/// in the Terms, and what an upload needs now is the AI features
/// permission (`AiConsent`), because every match has still frames checked
/// by OpenAI. The routes answer 403 ai_consent_required without it, which
/// API.send turns into the permission sheet and one retry.
@Observable
final class UploadConsent {
    static let shared = UploadConsent()

    /// A route answered 403 terms_required: the account never accepted the
    /// terms. RootView watches this and sends the account back through
    /// onboarding.
    var termsRequired = false

    func reset() {
        termsRequired = false
    }

    /// The upload routes' refusals, in words an upload row can show beside
    /// its Retry. nil for anything else.
    static func refusalCopy(_ code: String) -> String? {
        switch code {
        case "ai_consent_required":
            return "This upload needs your permission first. Tap Retry to see it again."
        case "terms_required":
            return "Accept the terms to continue, then try again."
        default:
            return nil
        }
    }
}
