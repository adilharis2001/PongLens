import Foundation
import UIKit

/// One photo attached to a journal or coach entry.
///
/// The app had no entry photos at all until now, in either direction: a
/// player who attached one on the web could not see it here, and neither
/// side could add one. Both halves live in this file so the two composers
/// and every card that draws an entry run the same thing.
///
/// The picture is uploaded while the composer is still open rather than on
/// save, because the route checks it with a vision call before storing
/// anything and a refusal should arrive while there is still something to
/// do about it. A photo attached and then abandoned is deleted on the way
/// out; the entry owns it from the moment the entry saves.
enum EntryPhoto {

    /// Down to 1600px on the long side and re-encoded as JPEG, the same as
    /// the web. Both halves matter on a phone: a photo straight out of a
    /// modern iPhone runs past the route's 8 MB limit, and HEIC is a
    /// format browsers will not draw, so a coach's photo would upload and
    /// then be invisible on the website.
    static func jpeg(_ image: UIImage) -> Data? {
        PageScan.jpeg(image)
    }

    private struct Uploaded: Decodable { let image_path: String }

    /// Upload and moderate. Throws with the route's own sentence, which
    /// says which of "not a journal photo", "too big" and "that is today's
    /// allowance" happened.
    static func upload(_ jpeg: Data) async throws -> String {
        let res: Uploaded = try await API.postMultipart(
            "api/entry-image", field: "image", filename: "photo.jpg",
            mime: "image/jpeg", data: jpeg
        )
        return res.image_path
    }

    /// Abandon an uploaded photo. Best effort: an orphaned object costs
    /// nothing anybody sees, and failing to say so must not block a
    /// composer somebody is trying to close.
    static func discard(path: String) async {
        struct Req: Encodable { let imagePath: String }
        struct Res: Decodable {}
        _ = try? await API.request(
            "api/entry-image", method: "DELETE", body: Req(imagePath: path)
        ) as Res
    }

    /// Signed URL for the photo on an entry. The route decides who may see
    /// it (163): the author always, and a student the entry was shared
    /// with. Anything else comes back nil and the card simply has no
    /// photo, which reads better than a broken frame beside the words.
    static func url(lessonId: UUID) async -> URL? {
        struct Req: Encodable {
            let lessonId: String
            let image = true
        }
        struct Res: Decodable { let url: String? }
        let res: Res? = try? await API.post(
            "api/media-url", Req(lessonId: lessonId.uuidString.lowercased())
        )
        return res?.url.flatMap(URL.init)
    }
}
