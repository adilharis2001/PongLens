import Foundation

/// Whether a failure is worth telling a person about, and what to say.
///
/// A cancelled request is not a failure. It is how an in-flight request
/// ends when a screen goes away, the app is put in the background, or a
/// pull to refresh retracts before its work finished. URLSession reports
/// it with the localized description "cancelled" — one lowercase word —
/// and every screen in this app used to paint that word in red over a
/// page where nothing had gone wrong. Adil saw it sitting above a lesson
/// upload that was running perfectly, and again every time he pulled to
/// refresh.
///
/// There is a trap in verifying this, and it cost a wrong diagnosis
/// before the right one: a URLError you CONSTRUCT carries no userInfo, so
/// `URLError(.cancelled).localizedDescription` reads as the generic "The
/// operation couldn't be completed. (NSURLErrorDomain error -999.)".
/// Only a real one, from a request URLSession actually cancelled, carries
/// "cancelled". So check this against a real cancellation, never against
/// a hand-made error.
enum UserFacingError {
    /// The ordinary ends of an abandoned request, in all three dialects
    /// this app can meet them in.
    static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain, ns.code == NSURLErrorCancelled { return true }
        if ns.domain == NSCocoaErrorDomain, ns.code == NSUserCancelledError { return true }
        return false
    }

    /// What to show, or nil when the honest answer is to say nothing.
    ///
    /// Everywhere the app turns a caught error into words for a reader
    /// goes through here, so the rule is stated once rather than
    /// remembered fourteen times.
    static func message(_ error: Error) -> String? {
        isCancellation(error) ? nil : error.localizedDescription
    }
}
