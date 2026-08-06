import SwiftUI

/// Edit or delete one saved order — the same controls as the review screen, applied to an order
/// that already exists (PROJECT_SPEC.md §10, screen 5).
struct OrderEditView: View {
    @StateObject private var viewModel: OrderEditViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var showingDeleteConfirmation = false

    /// Called after a successful save or delete, so the list behind this screen can refresh.
    var onChanged: () -> Void

    init(orderId: String, onChanged: @escaping () -> Void) {
        _viewModel = StateObject(wrappedValue: OrderEditViewModel(orderId: orderId))
        self.onChanged = onChanged
    }

    var body: some View {
        VStack(spacing: 0) {
            if viewModel.isLoaded {
                form
                footer
            } else if let loadError = viewModel.loadError {
                ContentUnavailableView {
                    Label("Couldn't load this order", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(loadError)
                } actions: {
                    Button("Retry") { Task { await viewModel.loadAll() } }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Edit order")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await viewModel.loadAll()
        }
        .onChange(of: viewModel.didFinish) { _, finished in
            if finished {
                onChanged()
                dismiss()
            }
        }
        .confirmationDialog("Delete this order?", isPresented: $showingDeleteConfirmation) {
            Button("Delete order", role: .destructive) {
                Task { await viewModel.delete() }
            }
        } message: {
            Text("Its items are removed and the month's totals are recalculated.")
        }
    }

    private var form: some View {
        Form {
            Section("Order") {
                TextField("Merchant", text: $viewModel.merchant)
                monthRow
                purchaseDateRow
                TextField("Currency", text: $viewModel.currency)
                    .textInputAutocapitalization(.characters)
            }

            itemsSection

            Section("Adjustments") {
                amountRow("Tax", value: $viewModel.tax)
                amountRow("Discount", value: $viewModel.discount)
            }

            Section("Notes") {
                TextField("Notes", text: $viewModel.notes, axis: .vertical)
                    .lineLimit(1...4)
            }

            if let errorMessage = viewModel.errorMessage {
                Section {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }

            Section {
                Button(role: .destructive) {
                    showingDeleteConfirmation = true
                } label: {
                    Label("Delete order", systemImage: "trash")
                }
            }
        }
    }

    private var monthRow: some View {
        HStack {
            Text("Month")
            Spacer()
            Button {
                viewModel.shiftMonth(by: -1)
            } label: {
                Image(systemName: "chevron.left")
            }
            .accessibilityLabel("Previous month")
            Text(MonthLabel.displayName(viewModel.periodMonth))
                .font(.subheadline)
            Button {
                viewModel.shiftMonth(by: 1)
            } label: {
                Image(systemName: "chevron.right")
            }
            .accessibilityLabel("Next month")
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var purchaseDateRow: some View {
        if let purchasedAt = Binding($viewModel.purchasedAt) {
            DatePicker("Purchased", selection: purchasedAt, displayedComponents: .date)
        } else {
            Button("Add purchase date") {
                viewModel.addPurchaseDate()
            }
        }
    }

    private var itemsSection: some View {
        Section("Items") {
            ForEach($viewModel.items) { $item in
                OrderItemEditor(item: $item, categories: viewModel.categories)
            }
            .onDelete(perform: viewModel.removeItem)

            Button {
                viewModel.addItem()
            } label: {
                Label("Add item", systemImage: "plus")
            }
        }
    }

    private func amountRow(_ label: String, value: Binding<Decimal>) -> some View {
        HStack {
            Text(label)
            Spacer()
            TextField(label, value: value, format: .number)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
        }
    }

    private var footer: some View {
        VStack(spacing: 8) {
            HStack {
                Text("Total")
                    .font(.headline)
                Spacer()
                Text(viewModel.grandTotal.formatted(currencyCode: viewModel.currency))
                    .font(.headline)
            }

            Button {
                Task { await viewModel.save() }
            } label: {
                if viewModel.isSaving {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Text("Save changes").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.isSaving)
        }
        .padding()
        .background(.bar)
    }
}

private struct OrderItemEditor: View {
    @Binding var item: EditableItem
    let categories: [CategoryDTO]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                TextField("Brand", text: brandBinding)
                    .frame(maxWidth: .infinity)
                TextField("Item name", text: $item.name)
                    .frame(maxWidth: .infinity)
            }
            HStack {
                TextField("Qty", value: $item.quantity, format: .number)
                    .keyboardType(.decimalPad)
                    .frame(width: 50)
                TextField("Unit price", value: $item.unitPrice, format: .number)
                    .keyboardType(.decimalPad)
                Spacer()
                TextField("Total", value: $item.lineTotal, format: .number)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 70)
            }
            .font(.subheadline)

            Menu {
                ForEach(categories) { category in
                    Button("\(category.emoji) \(category.name)") {
                        item.categoryId = category.id
                    }
                }
            } label: {
                Label(selectedCategoryLabel, systemImage: "tag")
                    .font(.caption)
            }
            // VoiceOver would otherwise read the emoji's Unicode name, or the raw slug before the
            // taxonomy has loaded.
            .accessibilityLabel("Category, \(selectedCategoryName)")
            .accessibilityHint("Changes this item's category")
        }
        .padding(.vertical, 4)
    }

    /// `EditableItem.brand` is `nil`-able, but `TextField` needs a non-optional binding — an
    /// empty string round-trips back to `nil` so a blank brand field never sends `""` upstream.
    private var brandBinding: Binding<String> {
        Binding(
            get: { item.brand ?? "" },
            set: { item.brand = $0.isEmpty ? nil : $0 }
        )
    }

    private var selectedCategory: CategoryDTO? {
        categories.first { $0.id == item.categoryId }
    }

    private var selectedCategoryLabel: String {
        selectedCategory.map { "\($0.emoji) \($0.name)" } ?? item.categoryId
    }

    private var selectedCategoryName: String {
        selectedCategory?.name ?? item.categoryId
    }
}

#Preview {
    NavigationStack {
        OrderEditView(orderId: "preview", onChanged: {})
    }
}
