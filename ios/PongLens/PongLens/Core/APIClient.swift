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

    /// GET with a query string — the offering-image signer is the one
    /// route read this way.
    static func get<Response: Decodable>(
        _ path: String, query: [String: String] = [:]
    ) async throws -> Response {
        let session = try await supa.auth.session
        var components = URLComponents(
            url: AppConfig.apiBase.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )!
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
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
    /// not JSON. One file field, plus optional plain fields (the review
    /// workspace sends tier=review alongside the audio).
    static func postMultipart<Response: Decodable>(
        _ path: String, field: String, filename: String, mime: String, data fileData: Data,
        fields: [String: String] = [:]
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
        for (name, value) in fields {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append(
                "Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!
            )
            body.append("\(value)\r\n".data(using: .utf8)!)
        }
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
