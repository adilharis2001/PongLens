import Foundation

private func item(_ status: String, hidden: Bool = false) -> FeedbackItem {
    let json = """
    {"id":"\(UUID().uuidString.lowercased())","user_id":"\(UUID().uuidString.lowercased())",
     "title":"t","body":"b","type":"idea","status":"\(status)","vote_count":1,
     "created_at":"2026-09-16T10:00:00+00:00","author_name":"Fin","author_avatar":null,
     "voted":false,"hidden":\(hidden),"comment_count":2,
     "last_activity_at":"2026-09-16T11:00:00+00:00","official_reply":null,"official_reply_at":null}
    """
    return try! JSONDecoder().decode(FeedbackItem.self, from: Data(json.utf8))
}

func runFeedbackBoardChecks() {
    print("\n— feedback board —")

    let items = [item("open"), item("planned"), item("building"), item("done"), item("declined")]

    check(
        FeedbackStage.visible(items, stage: nil).map(\.status) == ["open", "planned", "building"],
        "with no pill lit the list is everything still open"
    )
    check(
        FeedbackStage.visible(items, stage: .done).map(\.status) == ["done", "declined"],
        "Done gathers declined posts too"
    )
    check(
        FeedbackStage.visible(items, stage: .planned).map(\.status) == ["planned"],
        "a lit pill shows its stage alone"
    )
    check(
        FeedbackStage.counts(items) == [.planned: 1, .building: 1, .done: 2],
        "the rail counts each stage"
    )
    check(
        !FeedbackStage.railVisible([item("open"), item("open")]),
        "the rail stays hidden while nothing has moved"
    )
    check(
        FeedbackStage.railVisible([item("open"), item("planned")]),
        "the rail appears once one post has a stage"
    )

    let id = UUID()
    check(
        FeedbackLink.itemId(in: "/feedback/\(id.uuidString.lowercased())") == id,
        "a comment notification's link names its post"
    )
    check(
        FeedbackLink.itemId(in: "/feedback/\(id.uuidString.lowercased())?from=bell") == id,
        "a query string does not hide the post id"
    )
    check(FeedbackLink.itemId(in: "/feedback") == nil, "the board itself has no post id")
    check(FeedbackLink.itemId(in: "/feedback/not-a-uuid") == nil, "junk is not a post")
    check(FeedbackLink.isBoard("/feedback?compose=1"), "the compose link is still the board")
    check(!FeedbackLink.isBoard("/feedbackx"), "a different path is not the board")

    let decoded = item("open", hidden: true)
    check(decoded.isHidden && decoded.commentCount == 2, "a board row decodes its thread fields")

    let assist = try? JSONDecoder().decode(
        FeedbackAssist.self,
        from: Data("""
        {"questions":["Which screen?"],"similar":{"id":"\(id.uuidString)","title":"Same thing"},"visibility":"board"}
        """.utf8)
    )
    check(assist?.similar?.id == id && assist?.questions?.count == 1, "the assist reply decodes")
    let bare = try? JSONDecoder().decode(
        FeedbackAssist.self, from: Data("{\"questions\":[],\"similar\":null,\"visibility\":\"board\"}".utf8)
    )
    check(bare?.similar == nil && bare?.questions?.isEmpty == true, "an assist with nothing to add decodes")
}
