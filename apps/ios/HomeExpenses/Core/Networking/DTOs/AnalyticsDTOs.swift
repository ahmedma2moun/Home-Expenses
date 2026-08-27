import Foundation

/// Mirrors `GET /api/v1/analytics/month/:month` (lib/services/analytics.ts).
struct MonthCategoryTotalDTO: Decodable, Identifiable, Sendable {
    var id: String { categoryId }
    let categoryId: String
    let name: String
    let emoji: String
    let totalAmount: MoneyString
    let itemCount: Int
    let orderCount: Int
}

/// One week (1-5) within the selected month — total-only, no per-category split. Always 5 entries
/// on the wire, zero-filled for a week with no spending.
struct WeekTotalDTO: Decodable, Identifiable, Sendable {
    var id: Int { week }
    let week: Int
    let totalAmount: MoneyString
    let itemCount: Int
    let orderCount: Int
}

/// Items flagged `OrderItem.isProtein`, rolled up at month granularity — cuts across categories and
/// weeks by design, so this never splits further than the whole month.
struct ProteinTotalDTO: Decodable, Sendable {
    let totalAmount: MoneyString
    let itemCount: Int
    let orderCount: Int
}

struct MonthSummaryDTO: Decodable, Sendable {
    let month: String
    /// The account's one configured currency — every amount in this response is in it (no
    /// multi-currency support; see docs/api.md's `GET /analytics/month/:month`).
    let currency: String
    let totalAmount: MoneyString
    let orderCount: Int
    let itemCount: Int
    let categories: [MonthCategoryTotalDTO]
    let weeks: [WeekTotalDTO]
    let protein: ProteinTotalDTO
}
