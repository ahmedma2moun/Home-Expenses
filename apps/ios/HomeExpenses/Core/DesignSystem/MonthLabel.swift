import Foundation

/// Wire format "YYYY-MM" (BR-4) ↔ `Date` at the first of the month, local calendar.
enum MonthLabel {
    static func format(_ date: Date) -> String {
        let components = Calendar.current.dateComponents([.year, .month], from: date)
        return String(format: "%04d-%02d", components.year ?? 1970, components.month ?? 1)
    }

    /// Inverse of `format`. Parsing the label directly — rather than going through a timestamp —
    /// keeps "2026-07" on the first of July for every user: a UTC midnight would already be June
    /// for anyone west of Greenwich.
    static func parse(_ label: String) -> Date? {
        let parts = label.split(separator: "-")
        guard parts.count == 2, let year = Int(parts[0]), let month = Int(parts[1]) else {
            return nil
        }
        return Calendar.current.date(from: DateComponents(year: year, month: month, day: 1))
    }

    static func startOfMonth(_ date: Date) -> Date {
        let components = Calendar.current.dateComponents([.year, .month], from: date)
        return Calendar.current.date(from: components) ?? date
    }

    static func displayName(_ date: Date) -> String {
        date.formatted(.dateTime.month(.wide).year())
    }
}
