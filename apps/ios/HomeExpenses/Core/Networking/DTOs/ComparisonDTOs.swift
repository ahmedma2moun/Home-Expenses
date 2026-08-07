import Foundation

/// Body for `POST /api/v1/analytics/compare` (docs/api.md). Omitting `monthA` asks the backend for
/// a trailing 3-month baseline instead of a second real month.
struct CompareRequestBody: Encodable {
    let monthA: String?
    let monthB: String
    let refresh: Bool
}

/// Mirrors `POST /api/v1/analytics/compare`'s response (`CompareResult` in
/// lib/services/monthComparison.ts).
struct ComparisonDTO: Decodable, Sendable {
    let payload: ComparisonPayloadDTO
    let model: String
    let cached: Bool
    /// The account's one configured currency — every amount in `payload` is in it.
    let currency: String
}

struct ComparisonPayloadDTO: Decodable, Sendable {
    let headline: String
    let drivers: [ComparisonDriverDTO]
    let anomalies: [String]
    let suggestions: [String]
    let confidence: Double
}

struct ComparisonDriverDTO: Decodable, Identifiable, Sendable {
    var id: String { category + direction + amount.value.wireString }
    let category: String
    let direction: String
    let amount: MoneyString
    let explanation: String
}
