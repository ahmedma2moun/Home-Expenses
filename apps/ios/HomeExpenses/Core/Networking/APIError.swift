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
}

extension APIError: LocalizedError {
    var errorDescription: String? {
        switch self {
        case .transport(let error):
            return "Network error: \(error.localizedDescription)"
        case .decoding:
            return "The server sent an unexpected response."
        case .server(_, let payload):
            return payload?.message ?? "Something went wrong."
        }
    }
}
