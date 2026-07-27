import Foundation

/// Backs the Home/Summary screen: per-category totals for the currently selected month, read
/// straight from `GET /analytics/month/:month` (PROJECT_SPEC.md §10, screen 1). Expanding a
/// category drills into its items for the same month, grouped by order, from
/// `GET /orders/by-category` — a separate, on-demand fetch since the month summary itself never
/// carries item-level detail (PROJECT_SPEC.md §12).
@MainActor
final class SummaryViewModel: ObservableObject {
    @Published private(set) var summary: MonthSummaryDTO?
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?
    @Published private(set) var selectedMonth: Date = MonthLabel.startOfMonth(Date())

    @Published private(set) var expandedCategoryId: String?
    @Published private(set) var categoryItems: [String: CategoryItemsPageDTO] = [:]
    @Published private(set) var loadingCategoryId: String?
    @Published private(set) var categoryItemsErrors: [String: String] = [:]

    private let client = APIClient.shared

    func shiftMonth(by months: Int) {
        selectedMonth = Calendar.current.date(byAdding: .month, value: months, to: selectedMonth) ?? selectedMonth
        resetCategoryDrilldown()
        Task { await load() }
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let label = MonthLabel.format(selectedMonth)
            summary = try await client.get("/api/v1/analytics/month/\(label)")
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't load the summary."
        }
    }

    /// Toggles a category's expansion; an accordion, not a multi-open list, so the screen stays
    /// scannable. The first expansion fetches its items — later ones just re-show the cache.
    func toggleCategory(_ categoryId: String) {
        if expandedCategoryId == categoryId {
            expandedCategoryId = nil
            return
        }
        expandedCategoryId = categoryId
        if categoryItems[categoryId] == nil {
            Task { await loadItems(for: categoryId) }
        }
    }

    func retryCategoryItems(_ categoryId: String) {
        Task { await loadItems(for: categoryId) }
    }

    private func loadItems(for categoryId: String) async {
        loadingCategoryId = categoryId
        categoryItemsErrors[categoryId] = nil
        defer { if loadingCategoryId == categoryId { loadingCategoryId = nil } }

        do {
            let page: CategoryItemsPageDTO = try await client.get(
                "/api/v1/orders/by-category",
                query: [
                    URLQueryItem(name: "month", value: MonthLabel.format(selectedMonth)),
                    URLQueryItem(name: "categoryId", value: categoryId),
                ]
            )
            categoryItems[categoryId] = page
        } catch {
            guard !error.isTaskCancellation else { return }
            categoryItemsErrors[categoryId] =
                (error as? LocalizedError)?.errorDescription ?? "Couldn't load these items."
        }
    }

    private func resetCategoryDrilldown() {
        expandedCategoryId = nil
        categoryItems = [:]
        categoryItemsErrors = [:]
    }
}
