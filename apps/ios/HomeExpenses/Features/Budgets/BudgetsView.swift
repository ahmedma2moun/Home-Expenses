import SwiftUI

/// Set and review weekly + protein budgets for one month, reached from the Home screen's toolbar
/// (PROJECT_SPEC.md §10-style screen, added for the budgets feature — not in the original spec).
struct BudgetsView: View {
    @StateObject private var viewModel: BudgetsViewModel
    @Environment(\.dismiss) private var dismiss
    let currency: String

    /// Called after a successful save, so Home can refresh and show the new remaining figures.
    var onSaved: () -> Void

    init(month: Date, currency: String, onSaved: @escaping () -> Void) {
        _viewModel = StateObject(wrappedValue: BudgetsViewModel(month: month))
        self.currency = currency
        self.onSaved = onSaved
    }

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoaded {
                    form
                } else if let loadError = viewModel.loadError {
                    ContentUnavailableView {
                        Label("Couldn't load budgets", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(loadError)
                    } actions: {
                        Button("Retry") { Task { await viewModel.load() } }
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .disabled(viewModel.isSaving)
            .navigationTitle("Budgets — \(MonthLabel.displayName(viewModel.selectedMonth))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if viewModel.isSaving {
                        ProgressView()
                    } else {
                        Button("Save") {
                            Task {
                                await viewModel.save()
                                if viewModel.didSave {
                                    onSaved()
                                }
                            }
                        }
                        .disabled(!viewModel.isLoaded)
                    }
                }
            }
            .task {
                await viewModel.load()
            }
        }
    }

    private var form: some View {
        Form {
            Section {
                monthSummaryRow
            } header: {
                Text("This month")
            } footer: {
                Text(
                    "Set every period's budget to see a combined monthly figure here — a partial target can't be fairly compared against the whole month's spend."
                )
            }

            Section {
                Stepper(
                    "Periods: \(viewModel.weeks.count)",
                    value: Binding(
                        get: { viewModel.weeks.count },
                        set: { viewModel.setPeriodCount($0) }
                    ),
                    in: 1...31
                )
            } header: {
                Text("Periods this month")
            } footer: {
                Text("Reducing the count moves purchases from removed periods into the last period and removes their budgets. Review the last period's budget before saving. Spending totals refresh after saving.")
            }

            Section("By period") {
                ForEach(viewModel.weeks) { week in
                    weekRow(week)
                }
            }

            Section {
                proteinRow
            } header: {
                Text("Protein")
            } footer: {
                Text("Tracked separately — protein purchases count only here, not toward the period they fell in.")
            }

            if let errorMessage = viewModel.errorMessage {
                Section {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
        }
    }

    private var monthSummaryRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Spent")
                Spacer()
                Text(viewModel.monthSpent.formatted(currencyCode: currency))
                    .monospacedDigit()
            }
            if let monthBudget = viewModel.monthBudget {
                HStack {
                    Text("Budget")
                    Spacer()
                    Text(monthBudget.formatted(currencyCode: currency))
                        .monospacedDigit()
                }
                HStack {
                    Text("Remaining")
                        .fontWeight(.semibold)
                    Spacer()
                    Text((viewModel.monthRemaining ?? 0).formatted(currencyCode: currency))
                        .fontWeight(.semibold)
                        .monospacedDigit()
                        .foregroundStyle((viewModel.monthRemaining ?? 0) < 0 ? .red : .primary)
                }
            } else {
                Text("Set every period's budget to see a monthly total.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func weekRow(_ week: EditableWeekBudget) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle(
                "Period \(week.week)",
                isOn: Binding(
                    get: { week.hasBudget },
                    set: { viewModel.setWeek(week.week, hasBudget: $0) }
                )
            )

            if week.hasBudget {
                HStack {
                    Text("Budget")
                        .font(.subheadline)
                    Spacer()
                    TextField(
                        "Budget",
                        value: Binding(
                            get: { week.amount },
                            set: { viewModel.setWeekAmount(week.week, amount: $0) }
                        ),
                        format: .number
                    )
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .accessibilityLabel("Period \(week.week) budget")
                }
            }

            HStack {
                Text("Spent \(week.spentAmount.formatted(currencyCode: currency))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                if let remaining = week.remaining {
                    Text("\(remaining < 0 ? "Over by" : "Remaining") \(abs(remaining).formatted(currencyCode: currency))")
                        .font(.caption)
                        .foregroundStyle(remaining < 0 ? .red : .secondary)
                }
            }
            .accessibilityElement(children: .combine)
        }
        .padding(.vertical, 2)
    }

    private var proteinRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle("Protein budget", isOn: $viewModel.hasProteinBudget)

            if viewModel.hasProteinBudget {
                HStack {
                    Text("Budget")
                        .font(.subheadline)
                    Spacer()
                    TextField("Budget", value: $viewModel.proteinAmount, format: .number)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .accessibilityLabel("Protein budget")
                }
            }

            HStack {
                Text("Spent \(viewModel.proteinSpent.formatted(currencyCode: currency))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                if let remaining = viewModel.proteinRemaining {
                    Text("\(remaining < 0 ? "Over by" : "Remaining") \(abs(remaining).formatted(currencyCode: currency))")
                        .font(.caption)
                        .foregroundStyle(remaining < 0 ? .red : .secondary)
                }
            }
            .accessibilityElement(children: .combine)
        }
        .padding(.vertical, 2)
    }
}

#Preview {
    BudgetsView(month: MonthLabel.startOfMonth(Date()), currency: "EGP", onSaved: {})
}
