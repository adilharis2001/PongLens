import Foundation

enum AllowanceLimit {
    static func isStorage(_ message: String?) -> Bool {
        message?.hasPrefix("Storage is full.") == true
    }
}

enum UploadProcessingStatus {
    case notRequested, started, needsMinutes, notStarted
    init(requested: Bool, jobID: String?, errorCode: String?) {
        if !requested { self = .notRequested }
        else if errorCode == "insufficient_minutes" { self = .needsMinutes }
        else if let jobID, !jobID.isEmpty { self = .started }
        else { self = .notStarted }
    }

    var message: String {
        switch self {
        case .notRequested: "It's in your library, unprocessed."
        case .started: "Processing has started. You'll get an email when it's ready."
        case .needsMinutes: "Your video is saved. Open it to request more processing minutes."
        case .notStarted: "Your video is saved, but processing hasn't started. Open it to try again."
        }
    }
}
