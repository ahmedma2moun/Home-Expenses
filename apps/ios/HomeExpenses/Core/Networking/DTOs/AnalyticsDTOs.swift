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

/// Mirrors `GET /api/v1/analytics/trends` (lib/services/analytics.ts).
struct TrendPointDTO: Decodable, Sendable {
    let month: String
    let totalAmount: MoneyString
}

struct TrendCategorySeriesDTO: Decodable, Identifiable, Sendable {
    var id: String { categoryId }
    let categoryId: String
    let name: String
    let emoji: String
    /// Sum across the whole window — the server sorts `categories` by this, descending, so the
    /// array order alone gives a stable rank to assign chart colors by (see `CategoryPalette`).
    let totalAmount: MoneyString
    let series: [TrendPointDTO]
}

struct TrendsResponseDTO: Decodable, Sendable {
    let months: [String]
    let totals: [TrendPointDTO]
    let categories: [TrendCategorySeriesDTO]
}
