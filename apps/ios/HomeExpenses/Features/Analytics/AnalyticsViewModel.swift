import Foundation
import SwiftUI

/// Backs the Analytics screen: a category pie chart for one month, plus a per-category spend trend
/// over the last 6/12 months (PROJECT_SPEC.md §10, screen 6; BR-5). The pie's month picker and the
/// trend's window are independent — the trend always ends at the current month.
@MainActor
final class AnalyticsViewModel: ObservableObject {
    @Published private(set) var selectedMonth: Date = MonthLabel.startOfMonth(Date())
    @Published private(set) var monthSummary: MonthSummaryDTO?
    @Published private(set) var trends: TrendsResponseDTO?
    @Published private(set) var trendsWindowMonths = 6
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMonth = false
    @Published private(set) var isLoadingTrends = false
    @Published var errorMessage: String?

    private let client = APIClient.shared
    private var monthTask: Task<Void, Never>?
    private var trendsTask: Task<Void, Never>?

    var monthTotal: Decimal { monthSummary?.totalAmount.value ?? 0 }

    var categoryRank: [String: Int] {
        AnalyticsChartData.categoryRank(from: trends)
    }

    var pieSlices: [CategorySlice] {
        AnalyticsChartData.pieSlices(monthSummary: monthSummary, rank: categoryRank)
    }

    var trendPoints: [CategoryTrendPoint] {
        AnalyticsChartData.trendPoints(trends: trends, rank: categoryRank)
    }

    var trendColorScale: (domain: [String], range: [Color]) {
        let includesOther = trendPoints.contains { $0.categoryId == AnalyticsChartData.foldedCategoryId }
        return AnalyticsChartData.colorScale(trends: trends, rank: categoryRank, includesOther: includesOther)
    }

    func shiftMonth(by months: Int) {
        selectedMonth = Calendar.current.date(byAdding: .month, value: months, to: selectedMonth) ?? selectedMonth
        monthTask?.cancel()
        monthTask = Task { await loadMonthSummary() }
    }

    func setTrendsWindow(months: Int) {
        guard months != trendsWindowMonths else { return }
        trendsWindowMonths = months
        trendsTask?.cancel()
        trendsTask = Task { await loadTrends() }
    }

    func load() async {
        errorMessage = nil
        isLoading = true
        defer { isLoading = false }
        monthTask?.cancel()
        trendsTask?.cancel()
        async let summary: Void = loadMonthSummary()
        async let trend: Void = loadTrends()
        _ = await (summary, trend)
    }

    /// Guards against a stale response landing after the user has already moved to another month —
    /// tapping the chevron rapidly fires one request per tap with nothing to cancel it in flight.
    private func loadMonthSummary() async {
        let month = selectedMonth
        isLoadingMonth = true
        defer { isLoadingMonth = false }
        do {
            let label = MonthLabel.format(month)
            let result: MonthSummaryDTO = try await client.get("/api/v1/analytics/month/\(label)")
            guard month == selectedMonth else { return }
            monthSummary = result
        } catch {
            guard !error.isTaskCancellation, month == selectedMonth else { return }
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't load the month summary."
        }
    }

    private func loadTrends() async {
        let window = trendsWindowMonths
        isLoadingTrends = true
        defer { isLoadingTrends = false }
        do {
            let result: TrendsResponseDTO = try await client.get(
                "/api/v1/analytics/trends",
                query: [URLQueryItem(name: "months", value: String(window))]
            )
            guard window == trendsWindowMonths else { return }
            trends = result
        } catch {
            guard !error.isTaskCancellation, window == trendsWindowMonths else { return }
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't load spending trends."
        }
    }
}
