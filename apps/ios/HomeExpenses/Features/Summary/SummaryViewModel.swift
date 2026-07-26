import Foundation

/// Backs the Home/Summary screen: per-category totals for the currently selected month, read
/// straight from `GET /analytics/month/:month` (PROJECT_SPEC.md §10, screen 1).
@MainActor
final class SummaryViewModel: ObservableObject {
    @Published private(set) var summary: MonthSummaryDTO?
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?
    @Published private(set) var selectedMonth: Date = MonthLabel.startOfMonth(Date())

    private let client = APIClient.shared

    func shiftMonth(by months: Int) {
        selectedMonth = Calendar.current.date(byAdding: .month, value: months, to: selectedMonth) ?? selectedMonth
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
}
