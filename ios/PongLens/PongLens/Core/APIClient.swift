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
        try await request(path, method: "POST", body: body)
    }

    static func request<Body: Encodable, Response: Decodable>(
        _ path: String, method: String, body: Body
    ) async throws -> Response {
        let session = try await supa.auth.session
        var request = URLRequest(url: AppConfig.apiBase.appendingPathComponent(path))
        request.httpMethod = method
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

    /// Multipart POST — the transcribe and note-image routes take form data,
    /// not JSON. One file field plus nothing else, matching the web's forms.
    static func postMultipart<Response: Decodable>(
        _ path: String, field: String, filename: String, mime: String, data fileData: Data
    ) async throws -> Response {
        let session = try await supa.auth.session
        var request = URLRequest(url: AppConfig.apiBase.appendingPathComponent(path))
        request.httpMethod = "POST"
        let boundary = "pl-\(UUID().uuidString)"
        request.setValue(
            "multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type"
        )
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append(
            "Content-Disposition: form-data; name=\"\(field)\"; filename=\"\(filename)\"\r\n"
                .data(using: .utf8)!
        )
        body.append("Content-Type: \(mime)\r\n\r\n".data(using: .utf8)!)
        body.append(fileData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard (200..<300).contains(http.statusCode) else {
            let fields = (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
            throw APIError.http(http.statusCode, fields["error"] ?? fields["code"] ?? "")
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}
