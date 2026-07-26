import Foundation

/// The single networking entry point for the app (PROJECT_SPEC.md §10). Typed Codable DTOs only —
/// no ad-hoc URLSession calls elsewhere. Handles bearer auth and one 401 → refresh → retry.
actor APIClient {
    static let shared = APIClient(baseURL: AppConfig.apiBaseURL)

    private let baseURL: URL
    private let session: URLSession
    private var accessToken: String?

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func setAccessToken(_ token: String?) {
        accessToken = token
    }

    func get<Response: Decodable>(_ path: String) async throws -> Response {
        try await send(path: path, method: "GET", body: Optional<Data>.none)
    }

    func post<Body: Encodable, Response: Decodable>(_ path: String, body: Body) async throws -> Response {
        let data = try JSONEncoder.api.encode(body)
        return try await send(path: path, method: "POST", body: data)
    }

    private func send<Response: Decodable>(
        path: String,
        method: String,
        body: Data?,
        isRetry: Bool = false
    ) async throws -> Response {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = body

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.transport(URLError(.badServerResponse))
        }

        if httpResponse.statusCode == 401, !isRetry {
            // TODO(M1): call /auth/refresh, update accessToken, retry once.
            throw APIError.unauthenticated
        }

        guard 200..<300 ~= httpResponse.statusCode else {
            let payload = try? JSONDecoder.api.decode(APIEnvelope<Response>.self, from: data).error
            throw APIError.server(status: httpResponse.statusCode, payload: payload)
        }

        do {
            return try JSONDecoder.api.decode(APIEnvelope<Response>.self, from: data).unwrap()
        } catch {
            throw APIError.decoding(error)
        }
    }
}

/// Mirrors the backend's `{ data }` / `{ error }` response envelope (docs/api.md).
private struct APIEnvelope<T: Decodable>: Decodable {
    let data: T?
    let error: APIErrorPayload?

    func unwrap() throws -> T {
        guard let data else {
            throw APIError.server(status: 0, payload: error)
        }
        return data
    }
}

extension JSONDecoder {
    static let api: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}

extension JSONEncoder {
    static let api: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()
}
