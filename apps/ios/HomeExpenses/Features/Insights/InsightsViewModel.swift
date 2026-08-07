import Foundation

/// One AI narrative's lifecycle. Starts `.idle` and only ever moves forward on an explicit user
/// action (`generateThisMonthInsight`/`generateComparison`) — nothing here calls the AI provider
/// automatically, since every call costs money (AI_PROVIDER.md, PROJECT_SPEC.md §7.4).
enum InsightState {
    case idle
    case loading
    case loaded(ComparisonDTO)
    case failed(String)
}

/// Backs the Insights tab (PROJECT_SPEC.md §7.3, BR-5): two independent, manually-triggered AI
/// narratives — this month vs. a trailing 3-month baseline, and an explicit two-month comparison —
/// both calling the same `POST /analytics/compare`.
@MainActor
final class InsightsViewModel: ObservableObject {
    @Published private(set) var thisMonthState: InsightState = .idle
    @Published private(set) var compareState: InsightState = .idle
    @Published private(set) var categories: [CategoryDTO] = []

    @Published var compareMonthA: Date
    @Published var compareMonthB: Date

    private let client = APIClient.shared
    private var thisMonthTask: Task<Void, Never>?
    private var compareTask: Task<Void, Never>?

    init() {
        let currentMonth = MonthLabel.startOfMonth(Date())
        compareMonthB = currentMonth
        compareMonthA = Calendar.current.date(byAdding: .month, value: -1, to: currentMonth) ?? currentMonth
    }

    var canCompare: Bool {
        MonthLabel.format(compareMonthA) != MonthLabel.format(compareMonthB)
    }

    /// Best-effort, loaded once — only used to show a category's name/emoji next to a driver row.
    /// A failure here just leaves drivers showing their raw category slug, never a blocking error
    /// — same do/catch + cancellation-guard shape as `AnalyticsViewModel.loadPriceWatch`, not a
    /// bare `try?` that would also swallow decode errors silently.
    func loadCategories() async {
        guard categories.isEmpty else { return }
        do {
            let response: [CategoryDTO] = try await client.get("/api/v1/categories")
            categories = response
        } catch {
            guard !error.isTaskCancellation else { return }
        }
    }

    func emoji(forCategory categoryId: String) -> String {
        categories.first(where: { $0.id == categoryId })?.emoji ?? "💼"
    }

    func categoryName(forCategory categoryId: String) -> String {
        categories.first(where: { $0.id == categoryId })?.name ?? categoryId
    }

    func generateThisMonthInsight(refresh: Bool = false) {
        thisMonthState = .loading
        thisMonthTask?.cancel()
        thisMonthTask = Task { [weak self] in
            await self?.runThisMonthInsight(refresh: refresh)
        }
    }

    func generateComparison(refresh: Bool = false) {
        guard canCompare else { return }
        compareState = .loading
        compareTask?.cancel()
        let monthA = compareMonthA
        let monthB = compareMonthB
        compareTask = Task { [weak self] in
            await self?.runComparison(monthA: monthA, monthB: monthB, refresh: refresh)
        }
    }

    private func runThisMonthInsight(refresh: Bool) async {
        let monthB = MonthLabel.format(MonthLabel.startOfMonth(Date()))
        do {
            let body = CompareRequestBody(monthA: nil, monthB: monthB, refresh: refresh)
            let result: ComparisonDTO = try await client.post("/api/v1/analytics/compare", body: body)
            thisMonthState = .loaded(result)
        } catch {
            guard !error.isTaskCancellation else { return }
            thisMonthState = .failed(
                (error as? LocalizedError)?.errorDescription ?? "Couldn't generate this insight."
            )
        }
    }

    private func runComparison(monthA: Date, monthB: Date, refresh: Bool) async {
        do {
            let body = CompareRequestBody(
                monthA: MonthLabel.format(monthA),
                monthB: MonthLabel.format(monthB),
                refresh: refresh
            )
            let result: ComparisonDTO = try await client.post("/api/v1/analytics/compare", body: body)
            compareState = .loaded(result)
        } catch {
            guard !error.isTaskCancellation else { return }
            compareState = .failed(
                (error as? LocalizedError)?.errorDescription ?? "Couldn't compare these months."
            )
        }
    }
}
