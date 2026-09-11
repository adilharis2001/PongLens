import Foundation

func runAutomaticHighlightsChecks() {
    print("\n— automatic highlight manifest —")
    check(
        automaticHighlightActions(includePlay: true, sharingEnabled: true)
            == [.play, .instagram, .shareLink, .saveVideo],
        "the Highlights sheet keeps four clear top-level choices"
    )
    check(
        automaticHighlightActions(includePlay: false, sharingEnabled: true)
            == [.instagram, .shareLink, .saveVideo],
        "the player share sheet reuses the share choices without a second play row"
    )
    check(
        automaticHighlightActions(includePlay: true, sharingEnabled: false)
            == [.play, .shareLink, .saveVideo],
        "the sharing switch hides Instagram but keeps links and saving"
    )
    check(
        automaticHighlightsSheetHeight(hasActions: true) == 570,
        "the ready Highlights sheet makes room for playback and sharing"
    )
    check(
        automaticHighlightsSheetHeight(hasActions: false) == 250,
        "non-ready Highlights states stay compact"
    )
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
        ("needs_generation", "Generate"),
        ("needs_update", "Update needed"),
        ("updating", "Updating rally clips"),
        ("empty", "No highlight rallies"),
        ("unavailable", "No highlight rallies"),
        ("failed", "Highlights unavailable"),
    ]
    for (status, summary) in states {
        let data = "{\"status\":\"\(status)\"}".data(using: .utf8)!
        let response = try? JSONDecoder().decode(AutomaticHighlightsResponse.self, from: data)
        check(response?.summary == summary, "\(status) state copy matches web")
    }

    let gatedJSON = """
    {
      "status":"needs_scoring",
      "scoredPoints":7,
      "scorablePoints":10,
      "requiredPoints":8,
      "requiredPercent":75,
      "eligible":false
    }
    """.data(using: .utf8)!
    do {
        let gated = try JSONDecoder().decode(
            AutomaticHighlightsResponse.self, from: gatedJSON
        )
        check(gated.summary == "7 of 10 scored", "score gate summary matches web")
        let view = automaticHighlightsRequestView(response: gated)
        check(view?.title == "Score more of this match", "score gate uses the shared sheet title")
        check(
            view?.body == "Score at least 75% of the points before generating highlights. You've scored 7 of 10.",
            "score gate explains the exact coverage"
        )
        check(view?.actionLabel == "Score the Match", "score gate has one scoring action")
        check(view?.action == .score, "score gate opens the existing scorekeeper")
    } catch {
        check(false, "score gate response decodes: \(error)")
    }

    let generation = automaticHighlightsRequestView(status: "needs_generation")
    check(generation?.title == "Generate highlights?", "legacy matches use the generation title")
    check(generation?.actionLabel == "Generate highlights", "legacy matches require one explicit action")
    check(generation?.running == false, "legacy matches do not start processing on open")
    check(
        generation?.body == "Highlights haven't been generated for this match. You can generate them from Tools.",
        "legacy matches explain that generation is available"
    )

    let request = automaticHighlightsRequestView(status: "needs_update")
    check(request?.title == "Update highlights", "stale highlights use the request title")
    check(request?.actionLabel == "Update highlights", "stale highlights have one explicit action")
    check(request?.running == false, "stale highlights do not start processing on open")
    check(
        request?.body == "This match changed after these highlights were prepared. Update them to use your latest rally edits.",
        "highlight refresh explains why an update is needed"
    )
    let updating = automaticHighlightsRequestView(status: "updating")
    check(updating?.running == true, "edited rally clips report their existing work")
    check(updating?.actionLabel == nil, "refresh cannot race rally clip edits")

    let manifestWithMarker = """
    {
      "v":2,"rule":"quality-first-v2","max_seconds":150,
      "points_revision":"abc","duration_s":0,"scored_only":true,"points":[]
    }
    """.data(using: .utf8)!
    let decodedManifest = try? JSONDecoder().decode(
        AutomaticHighlightManifest.self, from: manifestWithMarker
    )
    check(decodedManifest?.scoredOnly == true, "new scored-only manifests remain additive")

    do {
        let sheet = try String(
            contentsOfFile: "../PongLens/PongLens/Screens/HighlightsSheet.swift",
            encoding: .utf8
        )
        let tools = try String(
            contentsOfFile: "../PongLens/PongLens/Screens/MatchTools.swift",
            encoding: .utf8
        )
        check(sheet.contains("Button(submitting ? \"Starting…\" : actionLabel) {"),
              "the native highlight request uses the standard Form action row")
        check(!sheet.contains("buttonStyle(PLPrimaryButtonStyle())"),
              "the native highlight request does not use the glowing primary button")
        check(sheet.contains("DispatchQueue.main.async { onScore() }"),
              "the sheet dismisses into the existing scorekeeper")
        check(tools.contains("DispatchQueue.main.async { onOpenPlayer() }"),
              "the Tools card wires Highlights to its existing player action")
    } catch {
        check(false, "native Highlights UI source is readable: \(error)")
    }
}
