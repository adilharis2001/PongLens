import Foundation

/// Recording defaults, remembered across sessions. 1080p HEVC is fixed —
/// the pipeline gains nothing from more pixels and the phone pays for them
/// in heat and upload time. Frame rate is the one quality knob.
struct RecordSettings: Codable, Equatable {
    var fps: Int = 30 // 30 or 60
    var wifiOnlyUploads = false
    var placementGuide = true
    var processAfterUpload = true
    var placementMaps = false

    private static let key = "pl-record-settings"

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
