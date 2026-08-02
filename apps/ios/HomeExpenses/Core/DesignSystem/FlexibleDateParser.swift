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

extension ISO8601DateFormatter {
    /// One shared instance for encoding `purchasedAt` onto the wire with the default format
    /// options — every call site wants the same fixed configuration, so there's nothing to
    /// re-allocate per call the way `FlexibleDateParser` legitimately does (it mutates
    /// `formatOptions` between two parsing attempts, which a shared instance couldn't do safely).
    /// `@MainActor` because every call site is a `@MainActor` view model and `ISO8601DateFormatter`
    /// itself isn't `Sendable` — confining it to one actor is what makes sharing it safe.
    @MainActor static let wire = ISO8601DateFormatter()
}
