import Foundation

/// Backs the item-history sheet: every past purchase of one item, from
/// `GET /api/v1/items/price-history` (lib/services/priceHistory.ts).
@MainActor
final class ItemHistoryViewModel: ObservableObject {
    @Published private(set) var history: ItemPriceHistoryDTO?
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    private let client = APIClient.shared
    private let normalizedName: String

    init(normalizedName: String) {
        self.normalizedName = normalizedName
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            history = try await client.get(
                "/api/v1/items/price-history",
                query: [URLQueryItem(name: "name", value: normalizedName)]
            )
        } catch {
            guard !error.isTaskCancellation else { return }
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't load price history."
        }
    }
}
