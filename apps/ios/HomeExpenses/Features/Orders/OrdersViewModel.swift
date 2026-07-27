import Foundation

/// Backs the Orders screen: the saved orders of one accounting month, newest purchase first,
/// with delete (PROJECT_SPEC.md §10, screen 5). Editing an order lives in `OrderEditViewModel`.
@MainActor
final class OrdersViewModel: ObservableObject {
    @Published private(set) var orders: [OrderSummaryDTO] = []
    @Published private(set) var isLoading = false
    @Published private(set) var selectedMonth: Date = MonthLabel.startOfMonth(Date())
    @Published var errorMessage: String?

    private let client = APIClient.shared
    private var nextCursor: String?
    private var isLoadingMore = false

    var monthTotal: Decimal {
        orders.reduce(Decimal(0)) { $0 + $1.total.value }
    }

    /// Every order in a month shares the month's currency in practice; the first one is a better
    /// guess for the header than a hardcoded default.
    var currencyCode: String {
        orders.first?.currency ?? "EGP"
    }

    func shiftMonth(by months: Int) {
        selectedMonth = Calendar.current.date(byAdding: .month, value: months, to: selectedMonth) ?? selectedMonth
        Task { await load() }
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let page: OrderListPageDTO = try await client.get("/api/v1/orders", query: monthQuery())
            orders = page.orders
            nextCursor = page.nextCursor
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't load your orders."
        }
    }

    /// Called as the last row appears. A failed page is silent: the list the user already has is
    /// still correct, and an error banner over a working screen would be worse than a short list.
    func loadNextPageIfNeeded(after order: OrderSummaryDTO) async {
        guard let cursor = nextCursor, !isLoadingMore, order.id == orders.last?.id else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }

        var query = monthQuery()
        query.append(URLQueryItem(name: "cursor", value: cursor))
        guard let page: OrderListPageDTO = try? await client.get("/api/v1/orders", query: query) else {
            return
        }
        orders.append(contentsOf: page.orders)
        nextCursor = page.nextCursor
    }

    func delete(_ order: OrderSummaryDTO) async {
        errorMessage = nil
        do {
            let _: OrderDeleteResponse = try await client.delete("/api/v1/orders/\(order.id)")
            orders.removeAll { $0.id == order.id }
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't delete this order."
        }
    }

    func delete(at offsets: IndexSet) async {
        for order in offsets.map({ orders[$0] }) {
            await delete(order)
        }
    }

    private func monthQuery() -> [URLQueryItem] {
        [URLQueryItem(name: "month", value: MonthLabel.format(selectedMonth))]
    }
}
