import Foundation

func runAutomaticHighlightsChecks() {
    print("\n— automatic highlight manifest —")
    let json = """
    {
      "status":"ready",
      "url":"https://media.example/highlights.mp4",
      "durationS":16.4,
      "manifest":{
        "v":2,
        "rule":"quality-first-v2",
        "max_seconds":150,
        "points_revision":"abc",
        "duration_s":16.4,
        "points":[
          {"point_id":"00000000-0000-0000-0000-000000000001","cut_start_s":2.0,"cut_end_s":10.0,"output_start_s":0.0,"output_end_s":8.0,"n_hits":7,"connected_crossings":6,"table_bounces":3,"alternating_table_landings":5},
          {"point_id":"00000000-0000-0000-0000-000000000002","cut_start_s":20.0,"cut_end_s":29.0,"output_start_s":7.7,"output_end_s":16.7,"n_hits":6,"connected_crossings":5,"table_bounces":3,"alternating_table_landings":4}
        ]
      }
    }
    """.data(using: .utf8)!
    do {
        let response = try JSONDecoder().decode(AutomaticHighlightsResponse.self, from: json)
        check(response.status == "ready", "ready state decodes")
        check(response.url?.lastPathComponent == "highlights.mp4", "signed URL decodes")
        check(response.summary == "2 rallies · 0:16", "ready summary matches web")
        guard let manifest = response.manifest else {
            check(false, "manifest decodes")
            return
        }
        check(manifest.points.count == 2, "manifest points decode")
        check(manifest.pointId(at: 7.6) == uuid(1), "first rally owns time before overlap")
        check(manifest.pointId(at: 7.8) == uuid(2), "incoming rally owns crossfade overlap")
        check(manifest.outputStart(for: uuid(2)) == 7.7, "navigation uses output time")
    } catch {
        check(false, "ready response decodes: \(error)")
    }

    let states: [(String, String)] = [
        ("rendering", "Preparing highlights"),
        ("empty", "No highlight rallies"),
        ("unavailable", "No highlight rallies"),
        ("failed", "Highlights unavailable"),
    ]
    for (status, summary) in states {
        let data = "{\"status\":\"\(status)\"}".data(using: .utf8)!
        let response = try? JSONDecoder().decode(AutomaticHighlightsResponse.self, from: data)
        check(response?.summary == summary, "\(status) state copy matches web")
    }
}
