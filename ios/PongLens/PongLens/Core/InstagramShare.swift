import Foundation
import UIKit

/// Handing a finished video to Instagram.
///
/// This is not an API. There is no OAuth, no token, no App Review and no
/// Instagram Professional account: the video goes on the system pasteboard
/// under keys Meta defines, and opening Instagram's URL scheme makes it
/// look there. Instagram then opens its own composer with the video loaded
/// and the player posts it themselves. That is the whole mechanism, and it
/// works for any Instagram account.
///
/// Reference: https://developers.facebook.com/docs/instagram-platform/sharing-to-stories/
/// and https://developers.facebook.com/docs/ios/sharing-to-reels-instagram/
///
/// One documented gap, worth knowing before debugging this: Instagram's
/// Stories page lists a background VIDEO asset as supported but never names
/// its pasteboard key. The Reels page and Facebook's own equivalent both
/// use `...backgroundVideo`, so that is what this uses for both. If a
/// Story ever opens empty while a Reel works, that gap is the first place
/// to look.
enum InstagramShare {
    /// Where the video goes, and what Instagram opens with it.
    enum Destination {
        case story
        case reel

        var url: URL {
            switch self {
            // The app id is required on the Story scheme since January
            // 2023; without it Instagram opens but discards the asset.
            case .story:
                URL(string: "instagram-stories://share?source_application="
                    + AppConfig.metaAppID)!
            case .reel:
                URL(string: "instagram-reels://share")!
            }
        }

        /// Meta's limit for this surface, in seconds. The Story cap is the
        /// documented pasteboard limit, which is lower than the 60 seconds
        /// Instagram itself allows in a Story — unexplained by Meta, so the
        /// stricter number is the one we honour.
        var maxSeconds: Double {
            switch self {
            case .story: 20
            case .reel: 60
            }
        }

        var label: String {
            switch self {
            case .story: "Instagram Story"
            case .reel: "Instagram Reel"
            }
        }
    }

    enum ShareError: LocalizedError {
        case notInstalled
        case tooLarge(Int)
        case unreadable
        case refused

        var errorDescription: String? {
            switch self {
            case .notInstalled:
                "Instagram isn't installed on this phone."
            case .tooLarge(let mb):
                "That clip is \(mb) MB. Instagram won't take it."
            case .unreadable:
                "Couldn't read the clip. Try again."
            case .refused:
                "Instagram wouldn't open. Try again."
            }
        }
    }

    /// Meta asks for under 50 MB. A rally at the bitrate the worker uses is
    /// nowhere near this, so hitting it means something upstream is wrong
    /// and handing the file over anyway would fail silently inside
    /// Instagram, which is a far worse place to discover it.
    private static let maxBytes = 50 * 1024 * 1024

    /// Is Instagram there to receive this?
    ///
    /// `canOpenURL` only answers for schemes declared in
    /// LSApplicationQueriesSchemes, so a missing Info.plist entry looks
    /// exactly like a missing Instagram. If this returns false on a phone
    /// that plainly has Instagram, check the built app's Info.plist before
    /// suspecting anything else.
    static func isAvailable(_ destination: Destination = .story) -> Bool {
        UIApplication.shared.canOpenURL(destination.url)
    }

    /// Put the video on the pasteboard and open Instagram.
    ///
    /// Returns when Instagram has been asked to open. Whether the player
    /// then posts, edits or backs out is theirs and we never hear about it,
    /// which is also why there is nothing to clean up afterwards: the
    /// pasteboard entry expires on its own.
    @MainActor
    static func share(_ fileURL: URL, to destination: Destination = .story) throws {
        guard isAvailable(destination) else { throw ShareError.notInstalled }

        let data: Data
        do {
            data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
        } catch {
            throw ShareError.unreadable
        }
        guard !data.isEmpty else { throw ShareError.unreadable }
        guard data.count <= maxBytes else {
            throw ShareError.tooLarge(data.count / 1_048_576)
        }

        // Written immediately before opening Instagram, never earlier. The
        // entry expires in five minutes (Meta's own sample), so a share
        // prepared and left sitting would hand over nothing.
        UIPasteboard.general.setItems(
            [[
                "com.instagram.sharedSticker.backgroundVideo": data,
                "com.instagram.sharedSticker.appID": AppConfig.metaAppID,
            ]],
            options: [.expirationDate: Date().addingTimeInterval(5 * 60)]
        )

        UIApplication.shared.open(destination.url, options: [:]) { opened in
            if !opened {
                // Clear the pasteboard rather than leave a video sitting on
                // it that nothing is going to collect.
                UIPasteboard.general.items = []
            }
        }
    }
}
