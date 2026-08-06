import Foundation

/// The backend's `toISOString()` timestamps (`createdAt`, `updatedAt`) carry fractional seconds,
/// which `JSONDecoder`'s stock `.iso8601` strategy rejects outright — try strict ISO-8601 first,
/// then the fractional-seconds variant.
enum FlexibleDateParser {
    static func parse(_ raw: String) -> Date? {
        let iso = ISO8601DateFormatter()
        if let date = iso.date(from: raw) {
            return date
        }
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return iso.date(from: raw)
    }
}

