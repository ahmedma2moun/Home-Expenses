import Foundation

/// The single networking entry point for the app (PROJECT_SPEC.md §10). Typed Codable DTOs only —
/// no ad-hoc URLSession calls elsewhere. No auth flow yet — the backend resolves every request to
/// a single dev user (see apps/web/lib/api/devUser.ts).
actor APIClient {
    static let shared = APIClient(baseURL: AppConfig.apiBaseURL)

    private let baseURL: URL
    private let session: URLSession

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func get<Response: Decodable>(_ path: String) async throws -> Response {
        try await send(path: path, method: "GET", body: Optional<Data>.none)
    }

    func post<Body: Encodable, Response: Decodable>(_ path: String, body: Body) async throws -> Response {
        let data = try JSONEncoder.api.encode(body)
        return try await send(path: path, method: "POST", body: data)
    }

    func post<Response: Decodable>(_ path: String) async throws -> Response {
        try await send(path: path, method: "POST", body: Optional<Data>.none)
    }

    /// Direct PUT to a Vercel Blob signed upload URL (PROJECT_SPEC.md §2) — not our API envelope.
    func uploadFile(to url: URL, data: Data, contentType: String) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")

        let response: URLResponse
        do {
            (_, response) = try await session.upload(for: request, from: data)
        } catch {
            throw APIError.transport(error)
        }

        guard let httpResponse = response as? HTTPURLResponse, 200..<300 ~= httpResponse.statusCode else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw APIError.server(status: status, payload: nil)
        }
    }

    private func send<Response: Decodable>(
        path: String,
        method: String,
        body: Data?
    ) async throws -> Response {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
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
