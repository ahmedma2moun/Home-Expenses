import Foundation

/// Mirrors `GET /api/v1/health` (docs/api.md) — the one live endpoint as of M0.
struct HealthDTO: Decodable {
    struct Check: Decodable {
        let ok: Bool
        let error: String?
    }

    let status: String
    let db: Check
    let ai: Check
}
