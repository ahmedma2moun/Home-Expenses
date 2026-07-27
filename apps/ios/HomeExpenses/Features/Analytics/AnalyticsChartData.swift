import Foundation
import SwiftUI

/// One wedge of the category pie chart, for a single month.
struct CategorySlice: Identifiable {
    let id: String
    let name: String
    let emoji: String
    let amount: Decimal
    let color: Color

    var plotValue: Double { Double(truncating: amount as NSDecimalNumber) }
}

/// One (category, month) sample of the multi-month trend chart.
struct CategoryTrendPoint: Identifiable {
    let id: String
    let categoryId: String
    let categoryName: String
    let month: String
    let amount: Decimal

    var plotValue: Double { Double(truncating: amount as NSDecimalNumber) }

    /// Short axis label, e.g. "Jul" for "2026-07".
    var displayMonth: String { MonthLabel.abbreviatedMonth(fromLabel: month) }
}

private struct RawCategoryAmount {
    let id: String
    let name: String
    let emoji: String
    let amount: Decimal
}

/// The colour each category is drawn with is decided once, from the trends window's ranking, and
/// reused by both the pie chart (one month) and the trend lines (every month) — so a category never
/// changes colour depending on which chart or which month is on screen. Categories past the
/// palette's slot count fold into a single "Other" bucket rather than generating a new hue.
///
/// The fold bucket uses `foldedCategoryId` rather than the taxonomy's own `"other"` slug — the
/// server's `other` category (PROJECT_SPEC.md §6, "Other / Miscellaneous") is a real, routinely
/// assigned category that can itself land in the top-8 ranked slots, so reusing its id for the
/// synthetic bucket would collide: two `Identifiable` rows with the same id in the same chart.
enum AnalyticsChartData {
    static let foldedCategoryId = "__folded_other__"
    private static let foldedCategoryName = "Other"

    static func categoryRank(from trends: TrendsResponseDTO?) -> [String: Int] {
        guard let trends else { return [:] }
        let ranked = trends.categories.prefix(CategoryPalette.maxSeries)
        return Dictionary(ranked.enumerated().map { index, category in (category.categoryId, index) }) { first, _ in first }
    }

    static func pieSlices(monthSummary: MonthSummaryDTO?, rank: [String: Int]) -> [CategorySlice] {
        guard let monthSummary else { return [] }
        let raw = monthSummary.categories.map {
            RawCategoryAmount(id: $0.categoryId, name: $0.name, emoji: $0.emoji, amount: $0.totalAmount.value)
        }
        // The trends window's rank only covers the last 6/12 months; a month picked from outside
        // that window would otherwise fold entirely into "Other" (nothing in `raw` matches `rank`).
        // Rank locally by this month's own totals instead, so the pie stays informative — it just
        // won't share colours with the trend chart for that one out-of-window month.
        let effectiveRank = raw.contains { rank[$0.id] != nil } ? rank : localRank(for: raw)
        return fold(raw, rank: effectiveRank).sorted { $0.amount > $1.amount }
    }

    private static func localRank(for items: [RawCategoryAmount]) -> [String: Int] {
        let ranked = items.sorted { $0.amount > $1.amount }.prefix(CategoryPalette.maxSeries)
        return Dictionary(ranked.enumerated().map { index, item in (item.id, index) }) { first, _ in first }
    }

    static func trendPoints(trends: TrendsResponseDTO?, rank: [String: Int]) -> [CategoryTrendPoint] {
        guard let trends else { return [] }
        var points: [CategoryTrendPoint] = []
        var otherByMonth = Dictionary(trends.months.map { ($0, Decimal(0)) }) { first, _ in first }

        for category in trends.categories {
            guard rank[category.categoryId] != nil else {
                for point in category.series {
                    otherByMonth[point.month, default: 0] += point.totalAmount.value
                }
                continue
            }
            points += category.series.map { point in
                CategoryTrendPoint(
                    id: "\(category.categoryId)-\(point.month)",
                    categoryId: category.categoryId,
                    categoryName: "\(category.emoji) \(category.name)",
                    month: point.month,
                    amount: point.totalAmount.value
                )
            }
        }

        if otherByMonth.values.contains(where: { $0 > 0 }) {
            points += trends.months.map { month in
                CategoryTrendPoint(
                    id: "\(foldedCategoryId)-\(month)",
                    categoryId: foldedCategoryId,
                    categoryName: foldedCategoryName,
                    month: month,
                    amount: otherByMonth[month] ?? 0
                )
            }
        }
        return points
    }

    /// Domain/range pair for `.chartForegroundStyleScale`, in the same rank order used above, so
    /// Swift Charts' legend and line colours match the pie chart's slice colours category-for-category.
    static func colorScale(trends: TrendsResponseDTO?, rank: [String: Int], includesOther: Bool) -> (domain: [String], range: [Color]) {
        guard let trends else { return ([], []) }
        let names = trends.categories.prefix(CategoryPalette.maxSeries).map { "\($0.emoji) \($0.name)" }
        var domain = Array(names)
        var range = domain.indices.map(CategoryPalette.color(atRank:))
        if includesOther {
            domain.append(foldedCategoryName)
            range.append(CategoryPalette.other)
        }
        return (domain, range)
    }

    private static func fold(_ items: [RawCategoryAmount], rank: [String: Int]) -> [CategorySlice] {
        var slices: [CategorySlice] = []
        var otherTotal: Decimal = 0
        for item in items {
            if let itemRank = rank[item.id] {
                slices.append(CategorySlice(
                    id: item.id,
                    name: item.name,
                    emoji: item.emoji,
                    amount: item.amount,
                    color: CategoryPalette.color(atRank: itemRank)
                ))
            } else {
                otherTotal += item.amount
            }
        }
        if otherTotal > 0 {
            slices.append(CategorySlice(
                id: foldedCategoryId,
                name: foldedCategoryName,
                emoji: "💼",
                amount: otherTotal,
                color: CategoryPalette.other
            ))
        }
        return slices
    }
}
