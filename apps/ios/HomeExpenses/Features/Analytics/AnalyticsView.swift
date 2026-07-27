import SwiftUI

/// Analytics tab: a month-over-month comparison of every category's spend between two consecutive
/// months, each expandable into the items bought that month (PROJECT_SPEC.md §10, screen 6; BR-5).
struct AnalyticsView: View {
    @StateObject private var viewModel = AnalyticsViewModel()

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Analytics")
                .task { await viewModel.load() }
                .refreshable { await viewModel.load() }
        }
    }

    @ViewBuilder
    private var content: some View {
        VStack(spacing: 0) {
            monthPicker

            if let errorMessage = viewModel.errorMessage, viewModel.trendCurrentSummary == nil {
                ContentUnavailableView {
                    Label("Couldn't load analytics", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Retry") { Task { await viewModel.load() } }
                }
            } else if viewModel.isLoading && viewModel.trendCurrentSummary == nil {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                comparisonList
            }
        }
    }

    private var monthPicker: some View {
        HStack {
            Button {
                viewModel.shiftTrendMonth(by: -1)
            } label: {
                Image(systemName: "chevron.left")
            }
            .accessibilityLabel("Previous month")
            Spacer()
            Text(viewModel.trendRangeLabel).font(.headline)
            if viewModel.isLoadingTrend {
                ProgressView().padding(.leading, 4)
            }
            Spacer()
            Button {
                viewModel.shiftTrendMonth(by: 1)
            } label: {
                Image(systemName: "chevron.right")
            }
            .accessibilityLabel("Next month")
        }
        .padding()
    }

    private var comparisonList: some View {
        List {
            if let errorMessage = viewModel.errorMessage, viewModel.trendCurrentSummary != nil {
                // A stale pair can still be showing while a later fetch fails — surface the error
                // without blanking out the data that's already on screen.
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }

            if viewModel.comparisonRows.isEmpty {
                Section {
                    ContentUnavailableView(
                        "Nothing to compare yet",
                        systemImage: "arrow.left.arrow.right",
                        description: Text("The comparison fills in once you log spending for these months.")
                    )
                }
            } else {
                if let totalRow = viewModel.totalComparisonRow {
                    Section {
                        totalRowLabel(totalRow)
                    }
                }
                Section("Spending trend") {
                    ForEach(viewModel.comparisonRows) { row in
                        DisclosureGroup(isExpanded: expansionBinding(for: row.id)) {
                            itemsDetail(for: row)
                        } label: {
                            comparisonRowLabel(row)
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
            set: { _ in viewModel.toggleCategoryItems(categoryId) }
        )
    }

    private func comparisonRowLabel(_ row: CategoryComparisonRow) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(row.emoji)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.name)
                HStack(spacing: 4) {
                    Text("\(viewModel.trendPreviousMonthLabel) \(row.previousAmount.formatted(currencyCode: "EGP"))")
                    Text("→")
                    Text("\(viewModel.trendCurrentMonthLabel) \(row.currentAmount.formatted(currencyCode: "EGP"))")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
            changeBadge(for: row)
        }
        // `children: .combine` would read the "→" glyph literally and drop the up/down meaning,
        // which lives only in the badge's colour and SF Symbol — so this is described explicitly.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.name)
        .accessibilityValue(accessibilityValue(for: row))
    }

    /// The grand-total row above the per-category list — same amounts-and-badge shape as
    /// `comparisonRowLabel`, just set in a heavier weight so it reads as a summary, not one more
    /// category among the rest.
    private func totalRowLabel(_ row: CategoryComparisonRow) -> some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.name).font(.headline)
                HStack(spacing: 4) {
                    Text("\(viewModel.trendPreviousMonthLabel) \(row.previousAmount.formatted(currencyCode: "EGP"))")
                    Text("→")
                    Text("\(viewModel.trendCurrentMonthLabel) \(row.currentAmount.formatted(currencyCode: "EGP"))")
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
            Spacer()
            changeBadge(for: row)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.name)
        .accessibilityValue(accessibilityValue(for: row))
    }

    private func accessibilityValue(for row: CategoryComparisonRow) -> String {
        let previousText = "\(viewModel.trendPreviousMonthLabel) \(row.previousAmount.formatted(currencyCode: "EGP"))"
        let currentText = "\(viewModel.trendCurrentMonthLabel) \(row.currentAmount.formatted(currencyCode: "EGP"))"
        guard let ratio = row.changeRatio else {
            let isNew = row.previousAmount == 0 && row.currentAmount > 0
            return isNew ? "\(previousText), \(currentText), new category" : "\(previousText), \(currentText)"
        }
        let direction = ratio >= 0 ? "up" : "down"
        let percentText = abs(ratio).formatted(.percent.precision(.fractionLength(1)))
        return "\(previousText), \(currentText), \(direction) \(percentText)"
    }

    /// Spending going up is drawn as a regression (red), going down as an improvement (green) —
    /// the reverse of a typical stock-style trend badge, since this app tracks expenses.
    @ViewBuilder
    private func changeBadge(for row: CategoryComparisonRow) -> some View {
        if let ratio = row.changeRatio {
            let isIncrease = ratio >= 0
            Label(
                abs(ratio).formatted(.percent.precision(.fractionLength(1))),
                systemImage: isIncrease ? "arrow.up" : "arrow.down"
            )
            .font(.caption.bold())
            .foregroundStyle(isIncrease ? .red : .green)
        } else if row.previousAmount == 0 && row.currentAmount > 0 {
            Text("New")
                .font(.caption.bold())
                .foregroundStyle(.blue)
        }
    }

    /// The expanded body: items bought in this category in each of the two compared months,
    /// grouped by the order they were bought in — mirrors `GET /orders/by-category`, called once
    /// per month.
    @ViewBuilder
    private func itemsDetail(for row: CategoryComparisonRow) -> some View {
        if viewModel.loadingItemsCategoryId == row.id {
            ProgressView()
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, 8)
        } else if let error = viewModel.itemsErrorsByCategoryId[row.id] {
            VStack(alignment: .leading, spacing: 4) {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Retry") { viewModel.retryCategoryItems(row.id) }
                    .font(.footnote)
            }
        } else {
            monthItems(label: viewModel.trendPreviousMonthLabel, page: viewModel.previousMonthItems[row.id])
            monthItems(label: viewModel.trendCurrentMonthLabel, page: viewModel.currentMonthItems[row.id])
        }
    }

    @ViewBuilder
    private func monthItems(label: String, page: CategoryItemsPageDTO?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if let page, !page.orders.isEmpty {
                ForEach(page.orders) { group in
                    OrderGroupView(group: group)
                }
            } else {
                Text("No items.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.top, 4)
    }
}

#Preview {
    AnalyticsView()
}
