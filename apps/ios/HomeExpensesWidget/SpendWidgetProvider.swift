import WidgetKit
import Foundation

/// One month's spend, its trend vs. the previous month, and how many items are flagged by Price
/// Watch (lib/services/priceHistory.ts). `totalAmount`/`errorMessage` are mutually informative: a
/// `nil` total with a non-nil `errorMessage` is a failed fetch, not a genuinely empty month (a
/// month with real zero spend still resolves — see `getPriceWatchItems`'s "empty array, not an
/// error" contract on the backend).
struct SpendWidgetEntry: TimelineEntry {
    let date: Date
    let monthLabel: String
    let currency: String
    let totalAmount: Decimal?
    let changeRatio: Double?
    let topCategories: [MonthCategoryTotalDTO]
    /// Non-nil only when the month has at least one protein-flagged item — mirrors the Home
    /// screen's own threshold for showing this row at all. Already included in `totalAmount`/
    /// `topCategories` (protein counts normally there); this is the same spend shown separately.
    let proteinAmount: Decimal?
    let priceWatchCount: Int
    let errorMessage: String?

    static let placeholder = SpendWidgetEntry(
        date: Date(),
        monthLabel: "Aug",
        currency: "EGP",
        totalAmount: 9572.49,
        changeRatio: -0.229,
        topCategories: [],
        proteinAmount: 1455.30,
        priceWatchCount: 2,
        errorMessage: nil
    )
}

/// `TimelineProvider`'s completion handlers predate `Sendable` annotations — a plain
/// `(Entry) -> Void` closure captured into `Task { }` trips Swift 6's `sending`-parameter check
/// even though each completion here is only ever called once, from one place. Boxing it in a type
/// explicitly marked `@unchecked Sendable` is the standard way to cross that boundary for a
/// single-use, known-safe callback like this one, without relaxing checking for the whole target.
private struct CompletionBox<Value>: @unchecked Sendable {
    let call: (Value) -> Void
}

struct SpendWidgetProvider: TimelineProvider {
    private let client = APIClient.shared

    func placeholder(in context: Context) -> SpendWidgetEntry {
        .placeholder
    }

    func getSnapshot(in context: Context, completion: @escaping (SpendWidgetEntry) -> Void) {
        if context.isPreview {
            completion(.placeholder)
            return
        }
        let box = CompletionBox(call: completion)
        Task {
            box.call(await fetchEntry())
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SpendWidgetEntry>) -> Void) {
        let box = CompletionBox(call: completion)
        Task {
            let entry = await fetchEntry()
            let nextRefresh = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? entry.date.addingTimeInterval(3600)
            box.call(Timeline(entries: [entry], policy: .after(nextRefresh)))
        }
    }

    /// Fetches the latest month that actually has an order, the month before it (for the trend %),
    /// and that month's Price Watch count — the same reads `SummaryViewModel`/`AnalyticsViewModel`
    /// make, just without the `@Published` plumbing a widget has no use for.
    ///
    /// Deliberately not the calendar's current month: a widget checked mid-month before this
    /// month's first receipt is confirmed would otherwise show a misleading "$0" instead of the
    /// real, still-relevant total from whenever spending last happened.
    private func fetchEntry() async -> SpendWidgetEntry {
        let now = Date()

        do {
            let latestMonth = try await resolveLatestMonthWithOrders(fallback: now)
            let previousMonth = Calendar.current.date(byAdding: .month, value: -1, to: latestMonth) ?? latestMonth

            async let current: MonthSummaryDTO = client.get("/api/v1/analytics/month/\(MonthLabel.format(latestMonth))")
            async let previous: MonthSummaryDTO = client.get("/api/v1/analytics/month/\(MonthLabel.format(previousMonth))")
            async let priceWatch: [PriceWatchItemDTO] = client.get(
                "/api/v1/analytics/price-watch",
                query: [URLQueryItem(name: "month", value: MonthLabel.format(latestMonth))]
            )
            let (currentResult, previousResult, priceWatchResult) = try await (current, previous, priceWatch)

            return SpendWidgetEntry(
                date: now,
                monthLabel: MonthLabel.abbreviatedMonth(fromLabel: currentResult.month),
                currency: currentResult.currency,
                totalAmount: currentResult.totalAmount.value,
                changeRatio: changeRatio(current: currentResult.totalAmount.value, previous: previousResult.totalAmount.value),
                topCategories: Array(currentResult.categories.prefix(3)),
                proteinAmount: currentResult.protein.itemCount > 0 ? currentResult.protein.totalAmount.value : nil,
                priceWatchCount: priceWatchResult.count,
                errorMessage: nil
            )
        } catch {
            let currentMonth = MonthLabel.startOfMonth(now)
            return SpendWidgetEntry(
                date: now,
                monthLabel: MonthLabel.abbreviatedMonth(fromLabel: MonthLabel.format(currentMonth)),
                currency: "EGP",
                totalAmount: nil,
                changeRatio: nil,
                topCategories: [],
                proteinAmount: nil,
                priceWatchCount: 0,
                errorMessage: "Couldn't load"
            )
        }
    }

    /// The month of the most recently saved order (`GET /orders`, already sorted newest-first —
    /// `orderQueries.ts`'s `listOrders`), not necessarily the calendar's current month. Falls back
    /// to the current month when the account has no orders at all yet, so a fresh install still
    /// shows a sensible (zero) month rather than erroring.
    private func resolveLatestMonthWithOrders(fallback now: Date) async throws -> Date {
        let page: OrderListPageDTO = try await client.get(
            "/api/v1/orders",
            query: [URLQueryItem(name: "limit", value: "1")]
        )
        guard let latest = page.orders.first, let month = MonthLabel.parse(latest.periodMonth) else {
            return MonthLabel.startOfMonth(now)
        }
        return month
    }

    private func changeRatio(current: Decimal, previous: Decimal) -> Double? {
        guard previous != 0 else { return nil }
        return NSDecimalNumber(decimal: (current - previous) / previous).doubleValue
    }
}
