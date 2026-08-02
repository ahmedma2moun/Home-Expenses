import Foundation

/// Backs the Orders screen: the saved orders of one accounting month, newest purchase first,
/// with delete (PROJECT_SPEC.md §10, screen 5). Editing an order lives in `OrderEditViewModel`.
@MainActor
final class OrdersViewModel: ObservableObject {
    @Published private(set) var orders: [OrderSummaryDTO] = []
    @Published private(set) var isLoading = false
    @Published private(set) var selectedMonth: Date = MonthLabel.startOfMonth(Date())
    /// Replaces the list — the month couldn't be read at all.
    @Published var loadError: String?
    /// Shown over the list instead: a failed delete must not throw away rows we still have.
    @Published var actionError: String?

    private let client = APIClient.shared
    private var nextCursor: String?
    private var loadedMonth: Date?
    private var isLoadingMore = false
    private var loadTask: Task<Void, Never>?

    /// Honest about a partial list: the count is what's loaded, not what the month holds.
    var countLabel: String {
        let noun = orders.count == 1 ? "order" : "orders"
        return nextCursor == nil ? "\(orders.count) \(noun)" : "\(orders.count)+ \(noun)"
    }

    func shiftMonth(by months: Int) {
        selectedMonth = Calendar.current.date(byAdding: .month, value: months, to: selectedMonth) ?? selectedMonth
        reload()
    }

    /// Cancels any load still in flight, so tapping through months can't let a slow earlier
    /// response land on top of a later one.
    func reload() {
        loadTask?.cancel()
        loadTask = Task { [weak self] in
            guard let self else { return }
            await self.load()
        }
    }

    func load() async {
        let month = selectedMonth
        if loadedMonth != month {
            orders = []
            nextCursor = nil
        }
        isLoading = true
        loadError = nil
        defer { isLoading = false }

        do {
            let page: OrderListPageDTO = try await client.get("/api/v1/orders", query: query(for: month))
            guard month == selectedMonth else { return }
            orders = page.orders
            nextCursor = page.nextCursor
            loadedMonth = month
        } catch {
            // Switching tabs or months cancels the request; that's the user's own doing, not a
            // failure to put on screen.
            guard month == selectedMonth, !error.isTaskCancellation else { return }
            loadError = (error as? LocalizedError)?.errorDescription ?? "Couldn't load your orders."
        }
    }

    /// Called as the last row appears. A failed page stays quiet: the rows already on screen are
    /// still correct, and scrolling back to the end retries.
    func loadNextPageIfNeeded(after order: OrderSummaryDTO) async {
        guard let cursor = nextCursor, !isLoadingMore, order.id == orders.last?.id else { return }
        let month = selectedMonth
        isLoadingMore = true
        defer { isLoadingMore = false }

        var pageQuery = query(for: month)
        pageQuery.append(URLQueryItem(name: "cursor", value: cursor))
        guard
            let page: OrderListPageDTO = try? await client.get("/api/v1/orders", query: pageQuery),
            month == selectedMonth
        else {
            return
        }
        orders.append(contentsOf: page.orders)
        nextCursor = page.nextCursor
    }

    func delete(_ order: OrderSummaryDTO) async {
        actionError = nil
        do {
            let _: OrderDeleteResponse = try await client.delete("/api/v1/orders/\(order.id)")
            orders.removeAll { $0.id == order.id }
        } catch {
            guard !error.isTaskCancellation else { return }
            actionError = (error as? LocalizedError)?.errorDescription ?? "Couldn't delete this order."
        }
    }

    private func query(for month: Date) -> [URLQueryItem] {
        [URLQueryItem(name: "month", value: MonthLabel.format(month))]
    }
}
