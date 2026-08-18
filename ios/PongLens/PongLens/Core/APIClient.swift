import Foundation
import Supabase

enum APIError: LocalizedError {
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case .http(_, let message): message.isEmpty ? "Something went wrong. Try again." : message
        }
    }
}

/// The Next.js API routes, authenticated with the Supabase session's bearer
/// token. `supa.auth.session` refreshes the token when it is near expiry.
enum API {
    static func post<Body: Encodable, Response: Decodable>(
        _ path: String, _ body: Body
    ) async throws -> Response {
        let session = try await supa.auth.session
        var request = URLRequest(url: AppConfig.apiBase.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard (200..<300).contains(http.statusCode) else {
            // Two error dialects: older routes {error: "sentence"}, newer
            // commerce/review routes {code: "stable_code"}.
            let fields = (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
            throw APIError.http(http.statusCode, fields["error"] ?? fields["code"] ?? "")
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}
