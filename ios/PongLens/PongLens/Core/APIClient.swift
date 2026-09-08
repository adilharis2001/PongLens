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
///
/// Every call goes through `send`, which handles the one answer the session
/// layer cannot see coming: a 401. The routes stand a session up from our
/// bearer token on their side, and that can fail while the app's own
/// database reads still work — see `recoverUnauthorized`.
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
        var components = URLComponents(
            url: AppConfig.apiBase.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )!
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        let url = components.url!
        let data = try await send { token in
            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            return request
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }

    static func request<Body: Encodable, Response: Decodable>(
        _ path: String, method: String, body: Body
    ) async throws -> Response {
        let encoded = try JSONEncoder().encode(body)
        let data = try await send { token in
            var request = URLRequest(url: AppConfig.apiBase.appendingPathComponent(path))
            request.httpMethod = method
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.httpBody = encoded
            return request
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
        let boundary = "pl-\(UUID().uuidString)"
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

        let data = try await send { token in
            var request = URLRequest(url: AppConfig.apiBase.appendingPathComponent(path))
            request.httpMethod = "POST"
            request.setValue(
                "multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type"
            )
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.httpBody = body
            return request
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }

    // MARK: - Sending

    /// Builds the request around the current access token and sends it. A
    /// 401 is not handed back on first sight: the session is refreshed
    /// through `recoverUnauthorized` and the request goes once more with
    /// the new token. A second 401, or any other failure, throws as before.
    private static func send(
        _ build: (_ accessToken: String) -> URLRequest
    ) async throws -> Data {
        var recovered = false
        while true {
            let session = try await supa.auth.session
            let (data, response) = try await URLSession.shared.data(for: build(session.accessToken))
            guard let http = response as? HTTPURLResponse else {
                throw URLError(.badServerResponse)
            }
            if http.statusCode == 401, !recovered {
                recovered = true
                if await recoverUnauthorized() { continue }
            }
            guard (200..<300).contains(http.statusCode) else {
                // Two error dialects: older routes {error: "sentence"}, newer
                // commerce/review routes {code: "stable_code"}.
                let fields = (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
                throw APIError.http(http.statusCode, fields["error"] ?? fields["code"] ?? "")
            }
            return data
        }
    }

    /// A route answered 401 to a token this app still holds. Two causes,
    /// told apart by one refresh:
    ///
    /// - the access token expired between our check and theirs. The refresh
    ///   succeeds and the caller retries with the new token;
    /// - the session behind the token is gone — signed out from another
    ///   device, most often. The refresh is refused, and the app signs
    ///   itself out so the person lands on the sign-in screen.
    ///
    /// The second case is the one that hurt. A JWT stays valid for an hour
    /// after its session is deleted, so the app's own database reads keep
    /// working while every route — video links, posters, share links — says
    /// "not signed in". On 2026-09-07 a coach's phone spent that hour
    /// showing a match whose video would not play and whose Original was
    /// reported as no longer available, because his account had been
    /// signed out of a laptop with the global scope. Both sign-out buttons
    /// are local now; this is the half that catches whatever still gets
    /// through. Returns true when the caller should retry.
    ///
    /// Concurrent 401s (a grid of thumbnails) share one refresh: the auth
    /// client coalesces in-flight refreshes, so this is safe to call from
    /// many tasks at once.
    static func recoverUnauthorized() async -> Bool {
        do {
            _ = try await supa.auth.refreshSession()
            return true
        } catch let error as AuthError {
            switch error.errorCode {
            case .sessionNotFound, .sessionExpired, .refreshTokenNotFound,
                 .refreshTokenAlreadyUsed, .userNotFound, .userBanned:
                // Clears the stored session and emits signedOut, which
                // AppState turns into the sign-in screen. Local scope: the
                // server already has no session to revoke, and a global
                // sign-out here is exactly the thing that started this.
                try? await supa.auth.signOut(scope: .local)
            default:
                // A refresh that failed for any other reason (offline, a
                // server having a bad minute) is not a verdict on the
                // session. Leave it, and let the caller report the 401.
                break
            }
            return false
        } catch {
            return false
        }
    }
}
