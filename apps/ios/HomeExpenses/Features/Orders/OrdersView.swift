import SwiftUI

/// Manage orders: browse a month's saved orders, open one to edit it, or delete it
/// (PROJECT_SPEC.md §10, screen 5).
struct OrdersView: View {
    @StateObject private var viewModel = OrdersViewModel()

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Orders")
                .task {
                    if viewModel.orders.isEmpty {
                        await viewModel.load()
                    }
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
                    Label("Couldn't load your orders", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Retry") { Task { await viewModel.load() } }
                }
            } else if viewModel.isLoading && viewModel.orders.isEmpty {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewModel.orders.isEmpty {
                ContentUnavailableView(
                    "No orders this month",
                    systemImage: "tray",
                    description: Text("Confirmed receipts show up here, ready to edit.")
                )
            } else {
                orderList
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

    private var orderList: some View {
        List {
            Section {
                ForEach(viewModel.orders) { order in
                    NavigationLink {
                        OrderEditView(orderId: order.id) {
                            Task { await viewModel.load() }
                        }
                    } label: {
                        OrderRow(order: order)
                    }
                    .task {
                        await viewModel.loadNextPageIfNeeded(after: order)
                    }
                }
                .onDelete { offsets in
                    Task { await viewModel.delete(at: offsets) }
                }
            } header: {
                HStack {
                    Text("\(viewModel.orders.count) orders")
                    Spacer()
                    Text(viewModel.monthTotal.formatted(currencyCode: viewModel.currencyCode))
                }
            }
        }
        .listStyle(.insetGrouped)
    }
}

private struct OrderRow: View {
    let order: OrderSummaryDTO

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(order.merchant)
                    .font(.body)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(order.total.value.formatted(currencyCode: order.currency))
                .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        let itemLabel = order.itemCount == 1 ? "1 item" : "\(order.itemCount) items"
        guard let date = order.displayDate else { return itemLabel }
        return "\(date.formatted(date: .abbreviated, time: .omitted)) · \(itemLabel)"
    }
}

#Preview {
    OrdersView()
}
