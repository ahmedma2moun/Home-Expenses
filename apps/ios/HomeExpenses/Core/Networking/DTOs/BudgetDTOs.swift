import Foundation

/// Mirrors the `budget` object embedded in `GET /api/v1/analytics/month/:month` and returned
/// verbatim by `GET`/`PUT /api/v1/budgets/:month` (lib/services/budgets.ts).

struct WeekBudgetDTO: Decodable, Identifiable, Sendable {
    var id: Int { week }
    let week: Int
    /// `nil` when no budget is set for this week — nothing to compare `spentAmount` against.
    let budgetAmount: MoneyString?
    /// Actual cash out for the week: `Σ(order.actualPaid ?? order.total)` — not the item-based
    /// `WeekTotalDTO.totalAmount` shown in the by-week breakdown, which excludes tax/discount/tips.
    let spentAmount: MoneyString
    /// `nil` when `budgetAmount` is `nil`; otherwise `budgetAmount - spentAmount` (can be negative).
    let remaining: MoneyString?
}

struct ProteinBudgetDTO: Decodable, Sendable {
    let budgetAmount: MoneyString?
    /// Reuses the item-based protein total (`ProteinTotalDTO.totalAmount`) — protein items don't
    /// carry their own `actualPaid`, so there's no order-level override to apply here.
    let spentAmount: MoneyString
    let remaining: MoneyString?
}

struct MonthBudgetDTO: Decodable, Sendable {
    /// Σ(week budgetAmount) — and only that. `protein.budgetAmount` is deliberately **not** folded
    /// in here: every protein purchase already sits inside whichever week's `spentAmount` it was
    /// bought in, so adding the protein target on top of the week targets would size this figure
    /// for cash that isn't actually free to spend a second time. Also `nil` unless every week
    /// (1-5) has a budget set — a partial target compared against the whole month's spend would be
    /// misleading. Derived server-side on every read, never stored.
    let budgetAmount: MoneyString?
    /// Σ(weeks[].spentAmount) — actual cash out for the whole month, protein spend included (it's
    /// already inside whichever week it fell in).
    let spentAmount: MoneyString
    let remaining: MoneyString?
}

struct BudgetSummaryDTO: Decodable, Sendable {
    /// Always 5 entries (weeks 1-5) — same convention as `MonthSummaryDTO.weeks`.
    let weeks: [WeekBudgetDTO]
    let protein: ProteinBudgetDTO
    let month: MonthBudgetDTO
}

/// Body of `PUT /api/v1/budgets/:month`. A partial update: an omitted `weeks`/`protein` leaves that
/// budget untouched server-side. The Budgets screen always sends both, since it loads the full
/// current state first — see `BudgetsViewModel`.
struct BudgetUpdateRequest: Encodable, Sendable {
    var weeks: [WeekBudgetInput]?
    /// `nil` omits the key (leave untouched); `.cleared` sends `null` (unset the protein budget);
    /// `.value` sets it. See `ClearableMoney`.
    var protein: ClearableMoney?
}

/// One week's target. `amount` is always sent, never omitted — `BudgetUpdateRequestSchema` requires
/// the key present for every entry in `weeks`, unlike `protein` at the request's top level; only
/// its *value* is clearable (`.cleared` sends `null`, deleting that week's budget).
struct WeekBudgetInput: Encodable, Sendable {
    let week: Int
    let amount: ClearableMoney
}
