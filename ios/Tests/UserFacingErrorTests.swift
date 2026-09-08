import Foundation

func runUserFacingErrorChecks() {
    print("\n— what is worth telling a person —")

    // The three ways an abandoned request ends. None is a failure.
    check(
        UserFacingError.isCancellation(
            NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled)),
        "a cancelled request is not a failure")
    check(
        UserFacingError.isCancellation(CancellationError()),
        "a cancelled task is not a failure")
    check(
        UserFacingError.isCancellation(
            NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError)),
        "a picker the reader dismissed is not a failure")

    // ...and nothing is said about any of them.
    check(
        UserFacingError.message(
            NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled)) == nil,
        "a cancelled request says nothing")

    // Real failures still speak. This is the half that matters most: the
    // point of the rule is to stop crying wolf, not to go quiet.
    let offline = NSError(
        domain: NSURLErrorDomain, code: NSURLErrorNotConnectedToInternet,
        userInfo: [NSLocalizedDescriptionKey: "The Internet connection appears to be offline."])
    check(!UserFacingError.isCancellation(offline), "being offline is a real failure")
    eq(
        UserFacingError.message(offline),
        "The Internet connection appears to be offline.",
        "a real failure is reported in its own words")

    let server = NSError(
        domain: "PongLens", code: 500,
        userInfo: [NSLocalizedDescriptionKey: "Could not load lesson videos. Try again."])
    eq(
        UserFacingError.message(server),
        "Could not load lesson videos. Try again.",
        "a server sentence reaches the reader unchanged")
}
