import SwiftUI

/// Home screen: month picker, grand total, and per-category totals for the selected month
/// (PROJECT_SPEC.md §10, screen 1), with the "Add receipt" flow reachable from the toolbar.
struct SummaryView: View {
    @StateObject private var viewModel = SummaryViewModel()
    // Shared with the Quick Add widget's deep link (`AppRouter`, `HomeExpensesApp.onOpenURL`) — the
    // toolbar button and the widget both drive the same sheet through this one piece of state.
    @EnvironmentObject private var router: AppRouter
    @State private var showingBudgets = false

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Home")
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            showingBudgets = true
                        } label: {
                            Image(systemName: "target")
                        }
                        .accessibilityLabel("Budgets")
                        // `BudgetsView` needs the account's real currency, not the "EGP" fallback —
                        // there's nowhere else to read it from until the month summary has loaded.
                        .disabled(viewModel.summary == nil)
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            router.showingCaptureFlow = true
                        } label: {
                            Image(systemName: "plus.circle.fill")
                        }
                    }
                }
                .sheet(isPresented: $router.showingCaptureFlow) {
                    ReceiptFlowView {
                        Task { await viewModel.load() }
                    }
                }
                .sheet(isPresented: $showingBudgets) {
                    BudgetsView(
                        month: viewModel.selectedMonth,
                        currency: viewModel.summary?.currency ?? "EGP"
                    ) {
                        Task { await viewModel.load() }
                    }
                }
                .task {
                    await viewModel.load()
                }
                .refreshable {
                    await viewModel.load()
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        VStack(spacing: 0) {
            monthPicker

            if let errorMessage = viewModel.errorMessage {
                ContentUnavailableView {
                    Label("Couldn't load your summary", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Retry") { Task { await viewModel.load() } }
                }
            } else if viewModel.isLoading && viewModel.summary == nil {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let summary = viewModel.summary {
                summaryList(summary)
            }
        }
    }

    private var monthPicker: some View {
        HStack {
            Button {
                viewModel.shiftMonth(by: -1)
            } label: {
                Image(systemName: "chevron.left")
            }
            .accessibilityLabel("Previous month")
            Spacer()
            Text(MonthLabel.displayName(viewModel.selectedMonth))
                .font(.headline)
            Spacer()
            Button {
                viewModel.shiftMonth(by: 1)
            } label: {
                Image(systemName: "chevron.right")
            }
            .accessibilityLabel("Next month")
        }
        .padding()
    }

    private func summaryList(_ summary: MonthSummaryDTO) -> some View {
        List {
            Section {
                HStack {
                    Text("Total spend")
                        .font(.title3.bold())
                    Spacer()
                    Text(summary.totalAmount.value.formatted(currencyCode: summary.currency))
                        .font(.title3.bold())
                }
                HStack {
                    Text("\(summary.orderCount) orders · \(summary.itemCount) items")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                if let budget = summary.budget,
                    let monthBudget = budget.month.budgetAmount?.value,
                    let monthRemaining = budget.month.remaining?.value
                {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text("Budget remaining")
                                .font(.footnote)
                            Spacer()
                            Text(monthRemaining.formatted(currencyCode: summary.currency))
                                .font(.footnote)
                                .monospacedDigit()
                                .foregroundStyle(monthRemaining < 0 ? .red : .secondary)
                        }
                        // "Total spend" above is item-based (excludes tax/discount/`actualPaid`);
                        // this line is the order-cash figure the remaining above is actually
                        // measured against, so the two numbers aren't left to silently disagree.
                        Text(
                            "\(budget.month.spentAmount.value.formatted(currencyCode: summary.currency)) of \(monthBudget.formatted(currencyCode: summary.currency)) budget spent"
                        )
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }

            if !summary.weeks.isEmpty {
                Section("By week") {
                    ForEach(summary.weeks) { week in
                        weekRow(
                            week,
                            budget: budgetForWeek(week.week, in: summary),
                            currency: summary.currency
                        )
                    }
                }
            }

            if summary.protein.itemCount > 0 {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Label("Protein spend", systemImage: "fish.fill")
                            Spacer()
                            Text(summary.protein.totalAmount.value.formatted(currencyCode: summary.currency))
                                .monospacedDigit()
                        }
                        Text("\(summary.protein.itemCount) items · included in the total, not split by week")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let remaining = summary.budget?.protein.remaining?.value {
                            Text("\(remaining < 0 ? "Over protein budget by" : "Protein budget remaining") \(abs(remaining).formatted(currencyCode: summary.currency))")
                                .font(.caption)
                                .foregroundStyle(remaining < 0 ? .red : .secondary)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }

            if let priceWatchCount = viewModel.priceWatchCount, priceWatchCount > 0 {
                Section {
                    NavigationLink {
                        PriceWatchListView(month: viewModel.selectedMonth, currency: summary.currency)
                    } label: {
                        Label(
                            priceWatchCount == 1
                                ? "1 item up in price"
                                : "\(priceWatchCount) items up in price",
                            systemImage: "arrow.up.circle.fill"
                        )
                        .foregroundStyle(.orange)
                    }
                }
            }

            if summary.categories.isEmpty {
                Section {
                    ContentUnavailableView(
                        "No spending yet",
                        systemImage: "tray",
                        description: Text("Add a receipt to see this month's breakdown.")
                    )
                }
            } else {
                Section("By category") {
                    ForEach(summary.categories) { category in
                        DisclosureGroup(
                            isExpanded: expansionBinding(for: category.categoryId)
                        ) {
                            categoryDetail(category.categoryId)
                        } label: {
                            categoryRow(category, currency: summary.currency)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func weekRow(_ week: WeekTotalDTO, budget: WeekBudgetDTO?, currency: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Week \(week.week)")
                Spacer()
                Text(week.totalAmount.value.formatted(currencyCode: currency))
                    .monospacedDigit()
                    .foregroundStyle(week.itemCount > 0 ? .primary : .secondary)
            }
            if let budget, let budgetAmount = budget.budgetAmount?.value, let remaining = budget.remaining?.value {
                // The number above is item-based (no tax/discount/`actualPaid`) — "Remaining" is
                // computed from the cash figure here instead, which is why the two can disagree
                // (e.g. a register discount lowers cash spend but not the item total above).
                Text(
                    "\(budget.spentAmount.value.formatted(currencyCode: currency)) of \(budgetAmount.formatted(currencyCode: currency)) budget spent"
                )
                .font(.caption2)
                .foregroundStyle(.secondary)
                Text("\(remaining < 0 ? "Over by" : "Remaining") \(abs(remaining).formatted(currencyCode: currency))")
                    .font(.caption)
                    .foregroundStyle(remaining < 0 ? .red : .secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// `MonthSummaryDTO.budget.weeks` is always 5 entries, week 1-5 — same convention as
    /// `MonthSummaryDTO.weeks` itself, just never guaranteed to be in the same array order as the
    /// caller's `week`, so this matches on the week number rather than assuming index parity.
    private func budgetForWeek(_ week: Int, in summary: MonthSummaryDTO) -> WeekBudgetDTO? {
        summary.budget?.weeks.first { $0.week == week }
    }

    private func expansionBinding(for categoryId: String) -> Binding<Bool> {
        Binding(
            get: { viewModel.expandedCategoryId == categoryId },
            set: { _ in viewModel.toggleCategory(categoryId) }
        )
    }

    private func categoryRow(_ category: MonthCategoryTotalDTO, currency: String) -> some View {
        HStack {
            // Hidden from VoiceOver, not just decorative-by-convention: without this, an emoji
            // reads out as its raw Unicode name ("broccoli") ahead of the category name that
            // follows it, rather than being skipped the way a sighted glance would skip it.
            Text(category.emoji)
                .accessibilityHidden(true)
            VStack(alignment: .leading) {
                Text(category.name)
                Text("\(category.itemCount) items")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(category.totalAmount.value.formatted(currencyCode: currency))
                .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }

    /// The expanded body: items in this category for the selected month, grouped by the order
    /// they were bought in, newest-created first — mirrors `GET /orders/by-category`.
    @ViewBuilder
    private func categoryDetail(_ categoryId: String) -> some View {
        if viewModel.loadingCategoryId == categoryId {
            ProgressView()
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, 8)
        } else if let error = viewModel.categoryItemsErrors[categoryId] {
            VStack(alignment: .leading, spacing: 4) {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Retry") { viewModel.retryCategoryItems(categoryId) }
                    .font(.footnote)
            }
        } else if let page = viewModel.categoryItems[categoryId] {
            if page.orders.isEmpty {
                Text("No items found.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(page.orders) { group in
                    OrderGroupView(group: group)
                }
            }
        }
    }
}

#Preview {
    SummaryView()
        .environmentObject(AppRouter())
}
