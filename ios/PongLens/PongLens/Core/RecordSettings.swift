import Foundation

/// What the viewfinder draws over the picture while setting up.
///
/// There used to be a third choice: a live check that ran a corner-finding
/// model over the preview and said whether the angle was good. It was
/// withdrawn because it was too slow to be useful in a hall and stalled
/// often enough to be a distraction. The drawn ghost was doing the
/// teaching on its own, which is what it was built to do.
enum RecordOverlay: String, Codable {
    /// Nothing over the picture.
    case none
    /// The drawn table in true perspective from a proven-good camera
    /// position. Owes nothing to a model; works in any hall.
    case ghost
}

/// Recording defaults, remembered across sessions. 1080p HEVC is fixed —
/// the pipeline gains nothing from more pixels and the phone pays for them
/// in heat and upload time. Frame rate is the one quality knob.
struct RecordSettings: Codable, Equatable {
    var fps: Int = 30 // 30 or 60
    var wifiOnlyUploads = false
    var overlay: RecordOverlay = .ghost
    var processAfterUpload = true
    var placementMaps = false
    /// Listen for a game score called out at the phone. Off until it has
    /// been proven in a real hall — a feature that mishears is worse than
    /// one that is not there, and this one writes to the match.
    var callOutScore = false

    private static let key = "pl-record-settings"

    init() {}

    /// Decoded key by key, each falling back to its default. The
    /// synthesized decoder throws on a missing key even when the property
    /// has one, and `load()` catches that and hands back a fresh struct —
    /// so every setting added since launch has quietly reset whatever the
    /// user had chosen for the others.
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        fps = try values.decodeIfPresent(Int.self, forKey: .fps) ?? 30
        wifiOnlyUploads = try values.decodeIfPresent(
            Bool.self, forKey: .wifiOnlyUploads) ?? false
        processAfterUpload = try values.decodeIfPresent(
            Bool.self, forKey: .processAfterUpload) ?? true
        placementMaps = try values.decodeIfPresent(
            Bool.self, forKey: .placementMaps) ?? false
        callOutScore = try values.decodeIfPresent(
            Bool.self, forKey: .callOutScore) ?? false
        // Read as a raw string, never as the enum. Decoding straight to
        // RecordOverlay throws on a value the enum no longer has, and
        // `load()` turns any throw into a whole fresh struct — so the one
        // retired case would quietly reset the frame rate and every other
        // setting along with it. "check" is that retired case.
        if let stored = try values.decodeIfPresent(
            String.self, forKey: .overlay) {
            overlay = RecordOverlay(rawValue: stored) ?? .ghost
        } else if let legacy = try values.decodeIfPresent(
            Bool.self, forKey: .placementGuide) {
            // One switch used to drive both overlays. On meant the ghost.
            overlay = legacy ? .ghost : .none
        }
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(fps, forKey: .fps)
        try values.encode(wifiOnlyUploads, forKey: .wifiOnlyUploads)
        try values.encode(overlay, forKey: .overlay)
        try values.encode(processAfterUpload, forKey: .processAfterUpload)
        try values.encode(placementMaps, forKey: .placementMaps)
        try values.encode(callOutScore, forKey: .callOutScore)
    }

    private enum CodingKeys: String, CodingKey {
        case fps, wifiOnlyUploads, overlay, processAfterUpload, placementMaps
        case callOutScore
        /// Read on the way in only, to carry the old single switch over.
        case placementGuide
    }

    static func load() -> RecordSettings {
        guard let data = UserDefaults.standard.data(forKey: key),
              let settings = try? JSONDecoder().decode(RecordSettings.self, from: data) else {
            return RecordSettings()
        }
        return settings
    }

    func save() {
        if let data = try? JSONEncoder().encode(self) {
            UserDefaults.standard.set(data, forKey: Self.key)
        }
    }
}
