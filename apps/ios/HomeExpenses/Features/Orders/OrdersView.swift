import SwiftUI

/// Manage orders: browse a month's saved orders, open one to edit it, or delete it
/// (PROJECT_SPEC.md §10, screen 5).
struct OrdersView: View {
    @StateObject private var viewModel = OrdersViewModel()
    @State private var pendingDeletion: OrderSummaryDTO?

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
                .confirmationDialog(
                    "Delete this order?",
                    isPresented: presenting($pendingDeletion),
                    presenting: pendingDeletion
                ) { order in
                    Button("Delete order", role: .destructive) {
                        Task { await viewModel.delete(order) }
                    }
                } message: { order in
                    Text("\(order.merchant) — its items are removed and the month's totals are recalculated.")
                }
                .alert("Couldn't delete", isPresented: presenting($viewModel.actionError)) {
                    Button("OK", role: .cancel) {}
                } message: {
                    Text(viewModel.actionError ?? "")
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        VStack(spacing: 0) {
            monthPicker

            if let loadError = viewModel.loadError {
                ContentUnavailableView {
                    Label("Couldn't load your orders", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(loadError)
                } actions: {
                    Button("Retry") { viewModel.reload() }
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
            Section(viewModel.countLabel) {
                ForEach(viewModel.orders) { order in
                    NavigationLink {
                        OrderEditView(orderId: order.id) {
                            viewModel.reload()
                        }
                    } label: {
                        OrderRow(order: order)
                    }
                    .task {
                        await viewModel.loadNextPageIfNeeded(after: order)
                    }
                    // Deliberately not `.onDelete`: deleting cascades the items, recomputes the
                    // month, and releases the receipt, which is too much to hang off one swipe.
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            pendingDeletion = order
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    /// Bridges "is there a pending value?" to the `isPresented` binding SwiftUI wants, and clears
    /// the value when the sheet dismisses itself.
    private func presenting<Value>(_ value: Binding<Value?>) -> Binding<Bool> {
        Binding(
            get: { value.wrappedValue != nil },
            set: { isPresented in
                if !isPresented {
                    value.wrappedValue = nil
                }
            }
        )
    }
}

private struct OrderRow: View {
    let order: OrderSummaryDTO

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(order.merchant)
                    .font(.body)
                Text(order.subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(order.total.value.formatted(currencyCode: order.currency))
                .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    OrdersView()
}
