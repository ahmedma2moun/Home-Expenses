import SwiftUI

/// The item-history sheet: every past purchase of one item, with its cheapest store highlighted up
/// top. Opened from a Review-screen price badge, the Analytics "Price Watch" section, or the Home
/// teaser's list — there's no other item-detail screen in the app to extend, so this is new.
struct ItemHistoryView: View {
    @StateObject private var viewModel: ItemHistoryViewModel
    let itemName: String
    let currency: String

    init(itemName: String, normalizedName: String, currency: String) {
        self.itemName = itemName
        self.currency = currency
        _viewModel = StateObject(wrappedValue: ItemHistoryViewModel(normalizedName: normalizedName))
    }

    var body: some View {
        content
            .navigationTitle(itemName)
            .navigationBarTitleDisplayMode(.inline)
            .task { await viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        if let errorMessage = viewModel.errorMessage, viewModel.history == nil {
            ContentUnavailableView {
                Label("Couldn't load price history", systemImage: "exclamationmark.triangle")
            } description: {
                Text(errorMessage)
            } actions: {
                Button("Retry") { Task { await viewModel.load() } }
            }
        } else if let history = viewModel.history {
            historyList(history)
        } else {
            // Covers both "fetch in flight" and the frame before `.task` has even started —
            // `history` is `nil` in both cases, so there's nothing else this branch needs to check.
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func historyList(_ history: ItemPriceHistoryDTO) -> some View {
        List {
            if let cheapest = history.cheapest {
                Section {
                    HStack {
                        Label("Cheapest at \(cheapest.merchant)", systemImage: "tag.fill")
                            .foregroundStyle(.green)
                        Spacer()
                        Text(cheapest.unitPrice.value.formatted(currencyCode: currency))
                            .monospacedDigit()
                    }
                }
            }

            if history.history.isEmpty {
                Section {
                    ContentUnavailableView(
                        "No purchase history",
                        systemImage: "clock",
                        description: Text("This is the first time you've bought this item.")
                    )
                }
            } else {
                Section("Past purchases") {
                    ForEach(history.history, id: \.orderId) { entry in
                        purchaseRow(entry)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func purchaseRow(_ entry: PriceHistoryEntryDTO) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.merchant)
                if let date = entry.displayDate {
                    Text(date.formatted(date: .abbreviated, time: .omitted))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text(entry.unitPrice.value.formatted(currencyCode: currency))
                .monospacedDigit()
        }
    }
}

#Preview {
    NavigationStack {
        ItemHistoryView(itemName: "Tomatoes 1kg", normalizedName: "tomatoes 1kg", currency: "EGP")
    }
}
