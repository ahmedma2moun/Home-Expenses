import Foundation
import SwiftUI

/// Backs the Analytics screen: a month-over-month comparison of every category's spend between two
/// consecutive months (PROJECT_SPEC.md §10, screen 6; BR-5). Expanding a category drills into its
/// items for both months, grouped by order, from `GET /orders/by-category` — a separate, on-demand
/// fetch since the comparison itself never carries item-level detail (PROJECT_SPEC.md §12), mirroring
/// how `SummaryViewModel` drills into a single month's category items on the Home tab.
@MainActor
final class AnalyticsViewModel: ObservableObject {
    @Published private(set) var trendCurrentMonth: Date = MonthLabel.startOfMonth(Date())
    @Published private(set) var trendCurrentSummary: MonthSummaryDTO?
    @Published private(set) var trendPreviousSummary: MonthSummaryDTO?
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingTrend = false
    @Published var errorMessage: String?

    @Published private(set) var expandedCategoryId: String?
    @Published private(set) var previousMonthItems: [String: CategoryItemsPageDTO] = [:]
    @Published private(set) var currentMonthItems: [String: CategoryItemsPageDTO] = [:]
    @Published private(set) var loadingItemsCategoryId: String?
    @Published private(set) var itemsErrorsByCategoryId: [String: String] = [:]

    private let client = APIClient.shared
    private var trendTask: Task<Void, Never>?
    private var itemsTask: Task<Void, Never>?

    // Monotonic counters rather than "does the request's target month still match the current
    // one" — paging forward then immediately back makes that equality true again while an older,
    // superseded request is still in flight, which would let it win the race and clear the
    // spinner (or the cache) out from under a newer request that's still loading.
    private var trendRequestID = 0
    private var itemsRequestID = 0

    var trendPreviousMonth: Date {
        Calendar.current.date(byAdding: .month, value: -1, to: trendCurrentMonth) ?? trendCurrentMonth
    }

    var comparisonRows: [CategoryComparisonRow] {
        AnalyticsComparisonData.comparisonRows(current: trendCurrentSummary, previous: trendPreviousSummary)
    }

    /// Derived from the loaded summaries' own `month` field when available, falling back to the
    /// target month only before the first load — this way the label can never show a different
    /// pair than the amounts underneath it while a fetch is in flight or has failed; it just keeps
    /// showing the last fully-loaded pair together until the next one lands atomically.
    var trendPreviousMonthLabel: String {
        MonthLabel.abbreviatedMonth(fromLabel: trendPreviousSummary?.month ?? MonthLabel.format(trendPreviousMonth))
    }

    var trendCurrentMonthLabel: String {
        MonthLabel.abbreviatedMonth(fromLabel: trendCurrentSummary?.month ?? MonthLabel.format(trendCurrentMonth))
    }

    /// e.g. "July – August 2026", or "December 2026 – January 2027" across a year boundary.
    var trendRangeLabel: String {
        let previousLabel = trendPreviousSummary?.month ?? MonthLabel.format(trendPreviousMonth)
        let currentLabel = trendCurrentSummary?.month ?? MonthLabel.format(trendCurrentMonth)
        guard let previousDate = MonthLabel.parse(previousLabel), let currentDate = MonthLabel.parse(currentLabel) else {
            return ""
        }
        let calendar = Calendar.current
        guard calendar.component(.year, from: previousDate) == calendar.component(.year, from: currentDate) else {
            return "\(MonthLabel.displayName(previousDate)) – \(MonthLabel.displayName(currentDate))"
        }
        return "\(previousDate.formatted(.dateTime.month(.wide))) – \(MonthLabel.displayName(currentDate))"
    }

    func shiftTrendMonth(by months: Int) {
        trendCurrentMonth = Calendar.current.date(byAdding: .month, value: months, to: trendCurrentMonth) ?? trendCurrentMonth
        resetItemsDrilldown()
        trendTask?.cancel()
        trendTask = Task { await loadTrendComparison() }
    }

    func load() async {
        errorMessage = nil
        isLoading = true
        defer { isLoading = false }
        resetItemsDrilldown()
        trendTask?.cancel()
        let task = Task { await loadTrendComparison() }
        trendTask = task
        await task.value
    }

    /// Toggles a category's expansion; an accordion, not a multi-open list, so the screen stays
    /// scannable. The first expansion fetches both months' items — later ones just re-show the
    /// cache, which `shiftTrendMonth` invalidates since it belongs to the old month pair. The
    /// loading flag is set synchronously, before the fetch `Task` is even spawned, so the very
    /// first render after tapping shows the spinner rather than a flash of "No items."
    func toggleCategoryItems(_ categoryId: String) {
        if expandedCategoryId == categoryId {
            expandedCategoryId = nil
            return
        }
        expandedCategoryId = categoryId
        guard previousMonthItems[categoryId] == nil || currentMonthItems[categoryId] == nil else { return }
        loadingItemsCategoryId = categoryId
        itemsTask?.cancel()
        itemsTask = Task { await loadItems(for: categoryId) }
    }

    func retryCategoryItems(_ categoryId: String) {
        loadingItemsCategoryId = categoryId
        itemsTask?.cancel()
        itemsTask = Task { await loadItems(for: categoryId) }
    }

    /// Fetches both months of the comparison pair concurrently.
    private func loadTrendComparison() async {
        trendRequestID += 1
        let requestID = trendRequestID
        let currentMonth = trendCurrentMonth
        let previousMonth = trendPreviousMonth
        isLoadingTrend = true
        defer {
            if requestID == trendRequestID { isLoadingTrend = false }
        }
        do {
            async let current: MonthSummaryDTO = client.get("/api/v1/analytics/month/\(MonthLabel.format(currentMonth))")
            async let previous: MonthSummaryDTO = client.get("/api/v1/analytics/month/\(MonthLabel.format(previousMonth))")
            let (currentResult, previousResult) = try await (current, previous)
            guard requestID == trendRequestID else { return }
            errorMessage = nil
            trendCurrentSummary = currentResult
            trendPreviousSummary = previousResult
        } catch {
            guard !error.isTaskCancellation, requestID == trendRequestID else { return }
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't load spending trends."
        }
    }

    private func loadItems(for categoryId: String) async {
        itemsRequestID += 1
        let requestID = itemsRequestID
        let previousMonth = trendPreviousMonth
        let currentMonth = trendCurrentMonth
        loadingItemsCategoryId = categoryId
        itemsErrorsByCategoryId[categoryId] = nil
        defer {
            if requestID == itemsRequestID { loadingItemsCategoryId = nil }
        }
        do {
            async let previous: CategoryItemsPageDTO = client.get(
                "/api/v1/orders/by-category",
                query: [
                    URLQueryItem(name: "month", value: MonthLabel.format(previousMonth)),
                    URLQueryItem(name: "categoryId", value: categoryId),
                ]
            )
            async let current: CategoryItemsPageDTO = client.get(
                "/api/v1/orders/by-category",
                query: [
                    URLQueryItem(name: "month", value: MonthLabel.format(currentMonth)),
                    URLQueryItem(name: "categoryId", value: categoryId),
                ]
            )
            let (previousResult, currentResult) = try await (previous, current)
            guard requestID == itemsRequestID else { return }
            previousMonthItems[categoryId] = previousResult
            currentMonthItems[categoryId] = currentResult
        } catch {
            guard !error.isTaskCancellation, requestID == itemsRequestID else { return }
            itemsErrorsByCategoryId[categoryId] = (error as? LocalizedError)?.errorDescription ?? "Couldn't load these items."
        }
    }

    /// Paging to a new month pair invalidates any cached item drilldown — it belongs to the old pair.
    private func resetItemsDrilldown() {
        itemsTask?.cancel()
        expandedCategoryId = nil
        previousMonthItems = [:]
        currentMonthItems = [:]
        loadingItemsCategoryId = nil
        itemsErrorsByCategoryId = [:]
    }
}
