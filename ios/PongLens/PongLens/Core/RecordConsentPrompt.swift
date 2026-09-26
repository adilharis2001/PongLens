import Foundation

/// When the camera asks a new account for the upload rights confirmation.
///
/// Until 2026-09-26 the checkbox sat over the live picture, above the
/// shutter, for as long as the account had never confirmed. It is now a
/// small sheet that opens with the camera: the same sentence, Agree to
/// stay and record, Cancel (or a swipe down) to leave the camera. The
/// import and lesson screens keep their checkbox rows; they are forms.
///
/// Agree writes nothing, exactly as the tick wrote nothing. The answer is
/// saved at the shutter, when this recording's upload actually begins
/// (`UploadConsent.confirmIfNeeded`), so an account that agrees and then
/// leaves without recording is asked again next time. See
/// docs/app-store-review-checklist.md, "Upload rights confirmation is
/// saved at the upload".
///
/// Foundation only, so the headless suite can check it.
enum RecordConsentPrompt {
    /// Put the prompt up now.
    ///
    /// - needed: the account has never confirmed (`UploadConsent.needed`).
    ///   An account that has confirmed is never asked.
    /// - agreedThisVisit: Agree was tapped since the camera opened.
    /// - cameraReady: the picture is showing and nothing is recording.
    ///   A camera that cannot record (permission refused) has nothing to
    ///   ask about.
    static func shouldAsk(needed: Bool, agreedThisVisit: Bool, cameraReady: Bool) -> Bool {
        needed && !agreedThisVisit && cameraReady
    }

    /// The shutter may start a recording. When it may not, the shutter
    /// puts the prompt up instead of doing nothing: a segment that
    /// uploaded without the answer would be refused by the upload route.
    static func mayRecord(needed: Bool, agreedThisVisit: Bool) -> Bool {
        !needed || agreedThisVisit
    }

    /// The prompt closed. Anything other than Agree, Cancel or a swipe
    /// down alike, leaves the camera.
    static func closesCamera(agreedThisVisit: Bool) -> Bool {
        !agreedThisVisit
    }
}
