import Foundation

/// What the viewfinder draws over the picture while setting up. Exactly
/// one at a time, by design: the drawn target and the live check both want
/// the middle of the screen, and both at once is a thicket. The check is
/// still being proven at real venues, so the plain ghost has to stay
/// usable on its own.
enum RecordOverlay: String, Codable {
    /// Nothing over the picture.
    case none
    /// The drawn table in true perspective from a proven-good camera
    /// position. Owes nothing to the model; works in any hall.
    case ghost
    /// The live table check: the model's own outline, plus a caption that
    /// says which way to move.
    case check
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
        if let stored = try values.decodeIfPresent(
            RecordOverlay.self, forKey: .overlay) {
            overlay = stored
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
    }

    private enum CodingKeys: String, CodingKey {
        case fps, wifiOnlyUploads, overlay, processAfterUpload, placementMaps
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
