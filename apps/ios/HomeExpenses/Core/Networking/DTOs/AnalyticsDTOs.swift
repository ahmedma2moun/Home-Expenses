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

struct MonthSummaryDTO: Decodable, Sendable {
    let month: String
    let totalAmount: MoneyString
    let orderCount: Int
    let itemCount: Int
    let categories: [MonthCategoryTotalDTO]
}
