import Foundation

/// One category's spend in two consecutive months, for the "Spending trend" comparison list.
struct CategoryComparisonRow: Identifiable {
    let id: String
    let name: String
    let emoji: String
    let previousAmount: Decimal
    let currentAmount: Decimal

    /// `nil` when there's no previous-month baseline to compare against — a category that's brand
    /// new this month has no meaningful percentage change, only a raw amount. A ratio, not money,
    /// but kept as `Decimal` throughout so formatting can go through `.formatted(.percent)` rather
    /// than a hand-rolled, non-locale-aware `%.1f`.
    var changeRatio: Decimal? {
        guard previousAmount != 0 else { return nil }
        return (currentAmount - previousAmount) / previousAmount
    }
}

enum AnalyticsComparisonData {
    /// Every category present in either month, matched by id. Sorted by the current month's spend
    /// descending — a category that dropped to zero this month sorts to the bottom rather than
    /// disappearing, since surfacing that drop is the point of the comparison.
    static func comparisonRows(current: MonthSummaryDTO?, previous: MonthSummaryDTO?) -> [CategoryComparisonRow] {
        var rowsById: [String: CategoryComparisonRow] = [:]

        for category in current?.categories ?? [] {
            rowsById[category.categoryId] = CategoryComparisonRow(
                id: category.categoryId,
                name: category.name,
                emoji: category.emoji,
                previousAmount: 0,
                currentAmount: category.totalAmount.value
            )
        }
        for category in previous?.categories ?? [] {
            let existing = rowsById[category.categoryId]
            rowsById[category.categoryId] = CategoryComparisonRow(
                id: category.categoryId,
                name: existing?.name ?? category.name,
                emoji: existing?.emoji ?? category.emoji,
                previousAmount: category.totalAmount.value,
                currentAmount: existing?.currentAmount ?? 0
            )
        }

        return rowsById.values.sorted {
            if $0.currentAmount != $1.currentAmount { return $0.currentAmount > $1.currentAmount }
            if $0.previousAmount != $1.previousAmount { return $0.previousAmount > $1.previousAmount }
            return $0.id < $1.id
        }
    }
}
