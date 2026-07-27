import SwiftUI

/// Analytics tab: a category pie chart for a chosen month, and a per-category spending trend over
/// the last 6/12 months (PROJECT_SPEC.md §10, screen 6; BR-5).
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
        if let errorMessage = viewModel.errorMessage, viewModel.monthSummary == nil, viewModel.trends == nil {
            ContentUnavailableView {
                Label("Couldn't load analytics", systemImage: "exclamationmark.triangle")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("Retry") { Task { await viewModel.load() } }
            }
        } else if viewModel.isLoading && viewModel.monthSummary == nil && viewModel.trends == nil {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    // A section can fail without the other — e.g. the month summary loaded fine
                    // but the trends call errored. Surface it here rather than only when both fail.
                    if let errorMessage = viewModel.errorMessage {
                        errorBanner(errorMessage)
                    }
                    pieSection
                    trendSection
                }
                .padding(.vertical)
            }
        }
    }

    private func errorBanner(_ message: String) -> some View {
        Label(message, systemImage: "exclamationmark.triangle")
            .font(.footnote)
            .foregroundStyle(.orange)
            .padding(.horizontal)
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
            if viewModel.isLoadingMonth {
                ProgressView().padding(.leading, 4)
            }
            Spacer()
            Button {
                viewModel.shiftMonth(by: 1)
            } label: {
                Image(systemName: "chevron.right")
            }
            .accessibilityLabel("Next month")
        }
        .padding(.horizontal)
    }

    @ViewBuilder
    private var pieSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("By category")
                .font(.title3.bold())
                .padding(.horizontal)
            monthPicker
            if viewModel.pieSlices.isEmpty {
                ContentUnavailableView(
                    "No spending yet",
                    systemImage: "chart.pie",
                    description: Text("Add a receipt to see this month's breakdown.")
                )
                .frame(height: 200)
            } else {
                CategoryPieChart(slices: viewModel.pieSlices, total: viewModel.monthTotal)
                    .frame(height: 240)
                    .padding(.horizontal)
                CategoryLegend(slices: viewModel.pieSlices)
                    .padding(.horizontal)
            }
        }
    }

    @ViewBuilder
    private var trendSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Spending trend")
                    .font(.title3.bold())
                if viewModel.isLoadingTrends {
                    ProgressView().padding(.leading, 4)
                }
                Spacer()
                Picker("Window", selection: trendsWindowBinding) {
                    Text("6 mo").tag(6)
                    Text("12 mo").tag(12)
                }
                .pickerStyle(.segmented)
                .frame(minWidth: 150, idealWidth: 150, maxWidth: 200)
            }
            .padding(.horizontal)

            if viewModel.trendPoints.isEmpty {
                ContentUnavailableView(
                    "Not enough history yet",
                    systemImage: "chart.line.uptrend.xyaxis",
                    description: Text("The trend fills in as you log more months of spending.")
                )
                .frame(height: 200)
            } else {
                CategoryTrendChart(
                    points: viewModel.trendPoints,
                    months: viewModel.trends?.months ?? [],
                    colorScale: viewModel.trendColorScale
                )
                .frame(height: 260)
                .padding(.horizontal)
            }
        }
    }

    private var trendsWindowBinding: Binding<Int> {
        Binding(
            get: { viewModel.trendsWindowMonths },
            set: { viewModel.setTrendsWindow(months: $0) }
        )
    }
}

#Preview {
    AnalyticsView()
}
