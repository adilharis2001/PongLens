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

private func roadmap(_ title: String, _ stage: String, position: Int, shipped: String? = nil,
                     created: String = "2026-09-01T00:00:00+00:00") -> RoadmapItem {
    let shippedJson = shipped.map { "\"\($0)\"" } ?? "null"
    let json = """
    {"id":"\(UUID().uuidString.lowercased())","title":"\(title)","description":"d",
     "stage":"\(stage)","position":\(position),"shipped_at":\(shippedJson),"link":null,
     "score":2,"created_at":"\(created)"}
    """
    return try! JSONDecoder().decode(RoadmapItem.self, from: Data(json.utf8))
}

func runFeedbackBoardChecks() {
    print("\n— feedback board —")

    let decoded = item("open", hidden: true)
    check(decoded.isHidden && decoded.commentCount == 2, "a board row decodes its thread fields")
    check(item("declined").isDone && item("done").isDone && !item("planned").isDone,
          "done and declined are finished; planned is still open")

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

    print("\n— roadmap —")
    let groups = Roadmap.groups([
        roadmap("planned", "planned", position: 1),
        roadmap("building", "building", position: 1),
    ])
    check(groups.map(\.stage) == [.building, .planned], "stages read building, planned, shipped; empty ones vanish")

    let ordered = Roadmap.groups([
        roadmap("second", "planned", position: 2),
        roadmap("first", "planned", position: 1),
        roadmap("older", "planned", position: 3, created: "2026-08-01T00:00:00+00:00"),
        roadmap("newer", "planned", position: 3, created: "2026-08-02T00:00:00+00:00"),
    ])
    check(ordered.first?.items.map(\.title) == ["first", "second", "older", "newer"],
          "within a stage, position wins and age breaks ties")

    let shipped = Roadmap.groups([
        roadmap("aug", "shipped", position: 1, shipped: "2026-08-20"),
        roadmap("sep", "shipped", position: 2, shipped: "2026-09-16"),
    ])
    check(shipped.first?.items.map(\.title) == ["sep", "aug"], "shipped reads newest first")

    check(Roadmap.shippedLabel("2026-09-16") == "Sep 2026", "the shipped label is month and year")
    check(Roadmap.shippedLabel(nil) == nil && Roadmap.shippedLabel("nonsense") == nil,
          "no date, no label")

    check(roadmap("b", "building", position: 1).takesVotes && roadmap("p", "planned", position: 1).takesVotes,
          "in development and planned take votes")
    check(!roadmap("s", "shipped", position: 1, shipped: "2026-09-01").takesVotes,
          "shipped entries take no votes")
    check(Roadmap.nextVote(current: 0, pressed: 1) == 1 && Roadmap.nextVote(current: 1, pressed: 1) == 0
          && Roadmap.nextVote(current: 1, pressed: -1) == -1,
          "the same arrow takes a vote back; the other arrow flips it")
    check(Roadmap.adjustedScore(3, from: 0, to: 1) == 4 && Roadmap.adjustedScore(3, from: 1, to: -1) == 1,
          "the optimistic score moves by the difference between old and new vote")
    check(Roadmap.scoreLabel(3) == "+3" && Roadmap.scoreLabel(0) == "0" && Roadmap.scoreLabel(-2) == "-2",
          "scores read as signed counts")
    check(roadmap("b", "building", position: 1).score == 2, "a roadmap row decodes its score")
}
