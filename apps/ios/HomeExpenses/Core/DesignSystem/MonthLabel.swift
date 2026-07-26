import Foundation

/// Wire format "YYYY-MM" (BR-4) ↔ `Date` at the first of the month, local calendar.
enum MonthLabel {
    static func format(_ date: Date) -> String {
        let components = Calendar.current.dateComponents([.year, .month], from: date)
        return String(format: "%04d-%02d", components.year ?? 1970, components.month ?? 1)
    }

    static func startOfMonth(_ date: Date) -> Date {
        let components = Calendar.current.dateComponents([.year, .month], from: date)
        return Calendar.current.date(from: components) ?? date
    }

    static func displayName(_ date: Date) -> String {
        date.formatted(.dateTime.month(.wide).year())
    }
}
