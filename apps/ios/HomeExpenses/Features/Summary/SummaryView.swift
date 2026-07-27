import SwiftUI

/// Home screen: month picker, grand total, and per-category totals for the selected month
/// (PROJECT_SPEC.md §10, screen 1), with the "Add receipt" flow reachable from the toolbar.
struct SummaryView: View {
    @StateObject private var viewModel = SummaryViewModel()
    @State private var showingCaptureFlow = false

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Home")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            showingCaptureFlow = true
                        } label: {
                            Image(systemName: "plus.circle.fill")
                        }
                    }
                }
                .sheet(isPresented: $showingCaptureFlow) {
                    ReceiptFlowView {
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
            Spacer()
            Text(MonthLabel.displayName(viewModel.selectedMonth))
                .font(.headline)
            Spacer()
            Button {
                viewModel.shiftMonth(by: 1)
            } label: {
                Image(systemName: "chevron.right")
            }
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
                    Text(summary.totalAmount.value.formatted(currencyCode: "EGP"))
                        .font(.title3.bold())
                }
                HStack {
                    Text("\(summary.orderCount) orders · \(summary.itemCount) items")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Spacer()
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
                            categoryRow(category)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func expansionBinding(for categoryId: String) -> Binding<Bool> {
        Binding(
            get: { viewModel.expandedCategoryId == categoryId },
            set: { _ in viewModel.toggleCategory(categoryId) }
        )
    }

    private func categoryRow(_ category: MonthCategoryTotalDTO) -> some View {
        HStack {
            Text(category.emoji)
            VStack(alignment: .leading) {
                Text(category.name)
                Text("\(category.itemCount) items")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(category.totalAmount.value.formatted(currencyCode: "EGP"))
                .monospacedDigit()
        }
    }

    /// The expanded body: items in this category for the selected month, grouped by the order
    /// they were bought in, newest purchase first — mirrors `GET /orders/by-category`.
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
}
