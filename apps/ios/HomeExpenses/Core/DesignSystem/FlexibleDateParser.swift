import Foundation

/// The extraction model's `purchasedAt` isn't always a strict, offset-qualified ISO-8601 string
/// (PROJECT_SPEC.md §7.2 example has none) — try strict ISO-8601 first, then a bare local format.
enum FlexibleDateParser {
    static func parse(_ raw: String) -> Date? {
        let iso = ISO8601DateFormatter()
        if let date = iso.date(from: raw) {
            return date
        }
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: raw) {
            return date
        }

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.date(from: raw)
    }
}
