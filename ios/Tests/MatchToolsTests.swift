import Foundation

func runMatchToolsChecks() {
    print("\n— match tools —")
    check(
        shareLinkTargets(processed: true, highlightsReady: true)
            == [.match, .highlights, .starred],
        "ready matches show the three primary public-link targets"
    )
    check(
        shareLinkTargets(processed: true, highlightsReady: false)
            == [.match, .starred],
        "the link sheet does not start missing highlights"
    )
    check(
        shareLinkTargets(processed: false, highlightsReady: false)
            == [.match],
        "unprocessed matches offer only their live whole-match link"
    )
}
