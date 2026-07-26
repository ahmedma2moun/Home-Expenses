import Foundation

/// Mirrors the backend's `{ error: { code, message, details? } }` envelope (docs/api.md).
struct APIErrorPayload: Decodable {
    let code: String
    let message: String
}

enum APIError: Error {
    case transport(Error)
    case decoding(Error)
    case server(status: Int, payload: APIErrorPayload?)
    case unauthenticated
}
