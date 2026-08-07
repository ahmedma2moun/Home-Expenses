import SwiftUI

/// Insights tab: AI-generated spending narratives (PROJECT_SPEC.md §7.3, BR-5) — a rolling
/// baseline for the current month, and an explicit two-month comparison. Both are manually
/// triggered only; nothing on this screen calls the AI provider on load.
struct InsightsView: View {
    @StateObject private var viewModel = InsightsViewModel()

    var body: some View {
        NavigationStack {
            List {
                Section("This month") {
                    thisMonthCard
                }
                Section("Compare two months") {
                    compareCard
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Insights")
            .task { await viewModel.loadCategories() }
        }
    }

    @ViewBuilder
    private var thisMonthCard: some View {
        switch viewModel.thisMonthState {
        case .idle:
            VStack(alignment: .leading, spacing: 8) {
                Text("See what's driving this month's spending compared to your recent average.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Generate insight") { viewModel.generateThisMonthInsight() }
            }
            .padding(.vertical, 4)
        case .loading:
            loadingRow
        case .loaded(let result):
            comparisonCard(result, regenerateDisabled: false) {
                viewModel.generateThisMonthInsight(refresh: true)
            }
        case .failed(let message):
            failureRow(message) { viewModel.generateThisMonthInsight() }
        }
    }

    @ViewBuilder
    private var compareCard: some View {
        monthPickers
        switch viewModel.compareState {
        case .idle:
            Button("Compare") { viewModel.generateComparison() }
                .disabled(!viewModel.canCompare)
        case .loading:
            loadingRow
        case .loaded(let result):
            comparisonCard(result, regenerateDisabled: !viewModel.canCompare) {
                viewModel.generateComparison(refresh: true)
            }
        case .failed(let message):
            failureRow(message) { viewModel.generateComparison() }
        }
    }

    private var monthPickers: some View {
        HStack {
            DatePicker(
                "From",
                selection: $viewModel.compareMonthA,
                displayedComponents: .date
            )
            DatePicker(
                "To",
                selection: $viewModel.compareMonthB,
                displayedComponents: .date
            )
        }
        .datePickerStyle(.compact)
        .font(.subheadline)
    }

    private var loadingRow: some View {
        HStack {
            Spacer()
            ProgressView()
            Spacer()
        }
        .padding(.vertical, 8)
    }

    private func failureRow(_ message: String, retry: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(message, systemImage: "exclamationmark.triangle")
                .font(.footnote)
                .foregroundStyle(.orange)
            Button("Retry", action: retry)
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func comparisonCard(
        _ result: ComparisonDTO,
        regenerateDisabled: Bool,
        onRegenerate: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(result.payload.headline)
                .font(.headline)

            if result.payload.drivers.isEmpty {
                Text("No single category stood out this time.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(result.payload.drivers) { driver in
                    driverRow(driver, currencyCode: result.currency)
                }
            }

            ForEach(result.payload.anomalies, id: \.self) { anomaly in
                Label(anomaly, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }

            ForEach(result.payload.suggestions, id: \.self) { suggestion in
                Label(suggestion, systemImage: "lightbulb")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            HStack {
                if result.cached {
                    Text("From cache")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Regenerate", action: onRegenerate)
                    .font(.footnote)
                    .disabled(regenerateDisabled)
            }
        }
        .padding(.vertical, 4)
    }

    private func driverRow(_ driver: ComparisonDriverDTO, currencyCode: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(viewModel.emoji(forCategory: driver.category))
            VStack(alignment: .leading, spacing: 2) {
                Text(viewModel.categoryName(forCategory: driver.category))
                    .font(.subheadline.weight(.semibold))
                Text(driver.explanation)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Label(
                driver.amount.value.formatted(currencyCode: currencyCode),
                systemImage: driver.direction == "up" ? "arrow.up" : "arrow.down"
            )
            .font(.caption.bold())
            .foregroundStyle(driver.direction == "up" ? .red : .green)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(viewModel.categoryName(forCategory: driver.category))
        .accessibilityValue(
            "\(driver.explanation), \(driver.direction), \(driver.amount.value.formatted(currencyCode: currencyCode))"
        )
    }
}

#Preview {
    InsightsView()
}
