import SwiftUI

/// The full "Price Watch" list — every item whose price rose this month at the same merchant it
/// was last bought at. Pushed as its own screen from the Home teaser (`SummaryView`); the
/// equivalent inline section in `AnalyticsView` renders the same `PriceWatchRow` but from its own
/// already-loaded data instead of a second fetch here.
struct PriceWatchListView: View {
    @StateObject private var viewModel: PriceWatchViewModel
    let currency: String

    init(month: Date, currency: String) {
        self.currency = currency
        _viewModel = StateObject(wrappedValue: PriceWatchViewModel(month: month))
    }

    var body: some View {
        content
            .navigationTitle("Price Watch")
            .task { await viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        if let errorMessage = viewModel.errorMessage, viewModel.items.isEmpty {
            ContentUnavailableView {
                Label("Couldn't load price watch", systemImage: "exclamationmark.triangle")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("Retry") { Task { await viewModel.load() } }
            }
        } else if viewModel.isLoading || !viewModel.hasLoaded {
            // `hasLoaded` covers the frame before `.task` even starts — otherwise this branch order
            // would show the empty state below for an instant ahead of the real fetch.
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if viewModel.items.isEmpty {
            ContentUnavailableView(
                "No price increases",
                systemImage: "checkmark.circle",
                description: Text("Nothing you bought this month went up in price.")
            )
        } else {
            List(viewModel.items) { item in
                NavigationLink {
                    ItemHistoryView(
                        itemName: item.itemName,
                        normalizedName: item.normalizedName,
                        currency: currency
                    )
                } label: {
                    PriceWatchRow(item: item, currency: currency)
                }
            }
            .listStyle(.insetGrouped)
        }
    }
}

/// One flagged item's row — shared by `PriceWatchListView` and `AnalyticsView`'s inline section.
struct PriceWatchRow: View {
    let item: PriceWatchItemDTO
    let currency: String

    private var percentText: String {
        item.changeRatio.formatted(.percent.precision(.fractionLength(0)))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(item.itemName)
                    .lineLimit(1)
                Spacer()
                // `.fixedSize()` so the percent badge never gets compressed at large Dynamic Type
                // sizes — the item name truncates first instead (AnalyticsView.swift's equivalent
                // trailing badge relies on the same precedence).
                Label(percentText, systemImage: "arrow.up")
                    .font(.caption.bold())
                    .foregroundStyle(.red)
                    .fixedSize()
            }
            Text(item.merchant)
                .font(.caption)
                .foregroundStyle(.secondary)
            // On its own line, not competing with the badge for width, so a long price pair wraps
            // instead of ever truncating a number.
            HStack(spacing: 4) {
                Text(item.previousUnitPrice.value.formatted(currencyCode: currency))
                Text("→")
                Text(item.latestUnitPrice.value.formatted(currencyCode: currency))
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        // `children: .ignore` + an explicit value, not `.combine` — combining would read the "→"
        // glyph literally and drop the up/down meaning that lives only in the badge's color and SF
        // Symbol (see AnalyticsView.swift's `comparisonRowLabel` for the same rule).
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(item.itemName)
        .accessibilityValue(accessibilityValueText)
    }

    private var accessibilityValueText: String {
        let previousText = item.previousUnitPrice.value.formatted(currencyCode: currency)
        let currentText = item.latestUnitPrice.value.formatted(currencyCode: currency)
        return "\(item.merchant), \(previousText) to \(currentText), up \(percentText)"
    }
}

#Preview {
    NavigationStack {
        PriceWatchListView(month: Date(), currency: "EGP")
    }
}
