import Foundation

/// Editable state for one week's budget — `hasBudget` is separate from `amount` so the form can
/// tell "no budget set" from "budget of zero," and so turning it off sends an explicit clear
/// (`ClearableMoney.cleared`) rather than silently leaving the old value in place. Same pattern as
/// `OrderEditViewModel.hasActualPaid`.
struct EditableWeekBudget: Identifiable {
    let week: Int
    var hasBudget: Bool
    var amount: Decimal
    /// Read-only, from the server — the form never edits these, only displays them alongside the
    /// field being edited.
    let spentAmount: Decimal
    let remaining: Decimal?

    var id: Int { week }
}

/// Backs the Budgets screen: view and edit one month's weekly + protein budgets
/// (`GET`/`PUT /api/v1/budgets/:month`). A separate screen from Home/Summary rather than inline
/// editing there, since setting five week targets plus a protein target is enough fields to want
/// its own form and an explicit Save, not live-as-you-type.
@MainActor
final class BudgetsViewModel: ObservableObject {
    @Published var selectedMonth: Date
    @Published private(set) var weeks: [EditableWeekBudget] = []
    @Published var hasProteinBudget = false
    @Published var proteinAmount: Decimal = 0
    @Published private(set) var proteinSpent: Decimal = 0
    @Published private(set) var proteinRemaining: Decimal?
    @Published private(set) var monthBudget: Decimal?
    @Published private(set) var monthSpent: Decimal = 0
    @Published private(set) var monthRemaining: Decimal?
    @Published private(set) var isLoading = false
    @Published private(set) var isSaving = false
    /// Set only when the initial load fails — the form stays hidden until it clears, same as
    /// `OrderEditViewModel.loadError`, since editing defaults over budgets we never actually read
    /// would risk saving `weeks: []` over real data (see the guard in `save()`).
    @Published private(set) var loadError: String?
    @Published private(set) var isLoaded = false
    /// A save that failed, shown alongside the form the user is still editing — distinct from
    /// `loadError`, which hides the form entirely.
    @Published var errorMessage: String?
    @Published private(set) var didSave = false

    private let client = APIClient.shared

    init(month: Date) {
        selectedMonth = month
    }

    func load() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }

        do {
            let label = MonthLabel.format(selectedMonth)
            let summary: BudgetSummaryDTO = try await client.get("/api/v1/budgets/\(label)")
            apply(summary)
            isLoaded = true
        } catch {
            guard !error.isTaskCancellation else { return }
            loadError = (error as? LocalizedError)?.errorDescription ?? "Couldn't load budgets."
        }
    }

    func setWeek(_ week: Int, hasBudget: Bool) {
        guard let index = weeks.firstIndex(where: { $0.week == week }) else { return }
        weeks[index].hasBudget = hasBudget
    }

    func setWeekAmount(_ week: Int, amount: Decimal) {
        guard let index = weeks.firstIndex(where: { $0.week == week }) else { return }
        weeks[index].amount = amount
    }

    func save() async {
        // `weeks` is only populated once `load()` succeeds — saving before that would send
        // `BudgetUpdateRequest(weeks: [])`, which `BudgetUpdateRequestSchema`'s `.min(1)` rejects.
        // The UI disables Save until `isLoaded`, so this is a defensive backstop, not the primary
        // guard.
        guard isLoaded else {
            errorMessage = "Couldn't save budgets — try reloading first."
            return
        }
        isSaving = true
        errorMessage = nil
        // Cleared up front, not just left over from a previous successful save: a save that goes
        // on to fail below must not leave the caller thinking the *new* save succeeded.
        didSave = false
        defer { isSaving = false }

        let request = BudgetUpdateRequest(
            weeks: weeks.map { week in
                WeekBudgetInput(
                    week: week.week,
                    amount: week.hasBudget ? .value(week.amount.wireString) : .cleared
                )
            },
            protein: hasProteinBudget ? .value(proteinAmount.wireString) : .cleared
        )

        do {
            let label = MonthLabel.format(selectedMonth)
            let summary: BudgetSummaryDTO = try await client.put("/api/v1/budgets/\(label)", body: request)
            apply(summary)
            didSave = true
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't save budgets."
        }
    }

    private func apply(_ summary: BudgetSummaryDTO) {
        weeks = summary.weeks.map { week in
            EditableWeekBudget(
                week: week.week,
                hasBudget: week.budgetAmount != nil,
                amount: week.budgetAmount?.value ?? 0,
                spentAmount: week.spentAmount.value,
                remaining: week.remaining?.value
            )
        }
        hasProteinBudget = summary.protein.budgetAmount != nil
        proteinAmount = summary.protein.budgetAmount?.value ?? 0
        proteinSpent = summary.protein.spentAmount.value
        proteinRemaining = summary.protein.remaining?.value
        monthBudget = summary.month.budgetAmount?.value
        monthSpent = summary.month.spentAmount.value
        monthRemaining = summary.month.remaining?.value
    }
}
