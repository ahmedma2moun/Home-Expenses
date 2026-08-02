import Foundation

/// Backs `PriceWatchListView`'s standalone, full-screen presentation (pushed from the Home
/// teaser) — items bought this month whose price jumped at the same merchant, from
/// `GET /api/v1/analytics/price-watch` (lib/services/priceHistory.ts). `AnalyticsView`'s own inline
/// section reuses `PriceWatchRow` but loads through `AnalyticsViewModel` instead, since it already
/// fetches that month's data.
@MainActor
final class PriceWatchViewModel: ObservableObject {
    @Published private(set) var items: [PriceWatchItemDTO] = []
    @Published private(set) var isLoading = false
    /// Distinguishes "hasn't fetched yet" from "fetched, and it's empty" — without it, the empty
    /// state would flash for a frame before `.task` even starts.
    @Published private(set) var hasLoaded = false
    @Published var errorMessage: String?

    private let client = APIClient.shared
    private let month: Date

    init(month: Date) {
        self.month = month
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        defer {
            isLoading = false
            hasLoaded = true
        }
        do {
            items = try await client.get(
                "/api/v1/analytics/price-watch",
                query: [URLQueryItem(name: "month", value: MonthLabel.format(month))]
            )
        } catch {
            guard !error.isTaskCancellation else { return }
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't load price watch."
        }
    }
}
