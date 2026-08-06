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
    let priceWatchCount: Int
    let errorMessage: String?

    static let placeholder = SpendWidgetEntry(
        date: Date(),
        monthLabel: "Aug",
        currency: "EGP",
        totalAmount: 9572.49,
        changeRatio: -0.229,
        topCategories: [],
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

    /// Fetches the current month, the previous month (for the trend %), and this month's Price
    /// Watch count — the same three reads `SummaryViewModel`/`AnalyticsViewModel` make, just without
    /// the `@Published` plumbing a widget has no use for.
    private func fetchEntry() async -> SpendWidgetEntry {
        let now = Date()
        let currentMonth = MonthLabel.startOfMonth(now)
        let previousMonth = Calendar.current.date(byAdding: .month, value: -1, to: currentMonth) ?? currentMonth

        do {
            async let current: MonthSummaryDTO = client.get("/api/v1/analytics/month/\(MonthLabel.format(currentMonth))")
            async let previous: MonthSummaryDTO = client.get("/api/v1/analytics/month/\(MonthLabel.format(previousMonth))")
            async let priceWatch: [PriceWatchItemDTO] = client.get(
                "/api/v1/analytics/price-watch",
                query: [URLQueryItem(name: "month", value: MonthLabel.format(currentMonth))]
            )
            let (currentResult, previousResult, priceWatchResult) = try await (current, previous, priceWatch)

            return SpendWidgetEntry(
                date: now,
                monthLabel: MonthLabel.abbreviatedMonth(fromLabel: currentResult.month),
                currency: currentResult.currency,
                totalAmount: currentResult.totalAmount.value,
                changeRatio: changeRatio(current: currentResult.totalAmount.value, previous: previousResult.totalAmount.value),
                topCategories: Array(currentResult.categories.prefix(3)),
                priceWatchCount: priceWatchResult.count,
                errorMessage: nil
            )
        } catch {
            return SpendWidgetEntry(
                date: now,
                monthLabel: MonthLabel.abbreviatedMonth(fromLabel: MonthLabel.format(currentMonth)),
                currency: "EGP",
                totalAmount: nil,
                changeRatio: nil,
                topCategories: [],
                priceWatchCount: 0,
                errorMessage: "Couldn't load"
            )
        }
    }

    private func changeRatio(current: Decimal, previous: Decimal) -> Double? {
        guard previous != 0 else { return nil }
        return NSDecimalNumber(decimal: (current - previous) / previous).doubleValue
    }
}
