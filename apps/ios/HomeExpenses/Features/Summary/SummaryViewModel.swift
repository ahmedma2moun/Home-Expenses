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
    /// `nil` until the price-watch fetch resolves; the teaser row stays hidden until then rather
    /// than flashing a "0 items" state ahead of the real count.
    @Published private(set) var priceWatchCount: Int?

    @Published private(set) var expandedCategoryId: String?
    @Published private(set) var categoryItems: [String: CategoryItemsPageDTO] = [:]
    @Published private(set) var loadingCategoryId: String?
    @Published private(set) var categoryItemsErrors: [String: String] = [:]

    private let client = APIClient.shared
    private var loadTask: Task<Void, Never>?
    private var priceWatchTask: Task<Void, Never>?

    func shiftMonth(by months: Int) {
        selectedMonth = Calendar.current.date(byAdding: .month, value: months, to: selectedMonth) ?? selectedMonth
        resetCategoryDrilldown()
        reload()
    }

    /// Cancels any load still in flight, so tapping through months quickly can't let a slow
    /// earlier response land — and its own cancellation error — on top of a later one.
    func reload() {
        loadTask?.cancel()
        loadTask = Task { [weak self] in
            guard let self else { return }
            await self.load()
        }
    }

    func load() async {
        let month = selectedMonth
        isLoading = true
        errorMessage = nil
        priceWatchCount = nil
        defer { isLoading = false }

        // Runs concurrently, not awaited here — the teaser is a best-effort extra, and chaining it
        // after the summary would keep the full-screen spinner (and pull-to-refresh) up long after
        // the actual month total has already landed.
        priceWatchTask?.cancel()
        priceWatchTask = Task { [weak self] in
            await self?.loadPriceWatchCount(for: month)
        }

        do {
            let label = MonthLabel.format(month)
            let result: MonthSummaryDTO = try await client.get("/api/v1/analytics/month/\(label)")
            guard month == selectedMonth else { return }
            summary = result
        } catch {
            // Switching tabs or months cancels the request; that's the user's own doing, not a
            // failure to put on screen.
            guard month == selectedMonth, !error.isTaskCancellation else { return }
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't load the summary."
        }
    }

    /// Best-effort: the teaser is a nice-to-have, not core to the Home screen, so a failure here
    /// just leaves the teaser hidden rather than surfacing a second error banner.
    private func loadPriceWatchCount(for month: Date) async {
        do {
            let items: [PriceWatchItemDTO] = try await client.get(
                "/api/v1/analytics/price-watch",
                query: [URLQueryItem(name: "month", value: MonthLabel.format(month))]
            )
            guard month == selectedMonth else { return }
            priceWatchCount = items.count
        } catch {
            guard month == selectedMonth, !error.isTaskCancellation else { return }
            priceWatchCount = nil
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
