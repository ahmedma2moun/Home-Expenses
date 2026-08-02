import SwiftUI

/// The core review & confirm screen: editable merchant/date/month, per-item category/qty/price,
/// mismatch banner, Confirm & Save footer (PROJECT_SPEC.md §10, screen 4).
struct ReviewView: View {
    private enum Field: Hashable {
        case merchant
        case itemQuantity(UUID)
        case itemUnitPrice(UUID)
        case itemLineTotal(UUID)
        case tax
        case discount
    }

    @StateObject private var viewModel: ReviewViewModel
    @FocusState private var focusedField: Field?
    var onConfirmed: () -> Void

    init(receiptId: String, parsed: ParsedReceiptDTO, onConfirmed: @escaping () -> Void) {
        _viewModel = StateObject(wrappedValue: ReviewViewModel(receiptId: receiptId, parsed: parsed))
        self.onConfirmed = onConfirmed
    }

    var body: some View {
        Group {
            if !viewModel.isReceipt {
                notAReceipt
            } else {
                reviewForm
                    .task {
                        await viewModel.loadCategories()
                    }
                    .task {
                        await viewModel.checkPrices()
                    }
            }
        }
        .navigationTitle("Review")
        .navigationBarBackButtonHidden(true)
    }

    /// Defensive UI for `isReceipt == false` reaching this screen at all — the normal path routes
    /// this to a `FAILED` receipt status before Review is ever pushed (`runExtraction` server-side),
    /// so this is a second line of defense, not the primary handling.
    private var notAReceipt: some View {
        ContentUnavailableView {
            Label("This doesn't look like a receipt", systemImage: "exclamationmark.triangle")
        } description: {
            Text("Go back and try a clearer photo of the receipt.")
        }
    }

    private var reviewForm: some View {
        VStack(spacing: 0) {
            Form {
                Section("Receipt") {
                    TextField("Merchant", text: $viewModel.merchant)
                        .focused($focusedField, equals: .merchant)
                    HStack {
                        Text("Month")
                        Spacer()
                        Button {
                            viewModel.shiftMonth(by: -1)
                        } label: {
                            Image(systemName: "chevron.left")
                        }
                        .accessibilityLabel("Previous month")
                        Text(MonthLabel.format(viewModel.periodMonth))
                            .monospacedDigit()
                            .frame(minWidth: 70)
                        Button {
                            viewModel.shiftMonth(by: 1)
                        } label: {
                            Image(systemName: "chevron.right")
                        }
                        .accessibilityLabel("Next month")
                    }
                    .buttonStyle(.plain)
                    TextField("Currency", text: $viewModel.currency)
                        .textInputAutocapitalization(.characters)
                }

                if !viewModel.warnings.isEmpty {
                    Section {
                        ForEach(viewModel.warnings, id: \.self) { warning in
                            Label(warning, systemImage: "exclamationmark.circle")
                                .foregroundStyle(.orange)
                                .font(.footnote)
                        }
                    } header: {
                        Text("From the scan")
                    }
                }

                if let mismatchAmount = viewModel.mismatchAmount {
                    mismatchBanner(mismatchAmount)
                }

                Section("Items") {
                    ForEach($viewModel.items) { $item in
                        itemRow($item)
                    }
                    .onDelete(perform: viewModel.removeItem)

                    Button {
                        viewModel.addItem()
                    } label: {
                        Label("Add item", systemImage: "plus")
                    }
                }

                Section("Adjustments") {
                    HStack {
                        Text("Tax")
                        Spacer()
                        TextField("Tax", value: $viewModel.tax, format: .number)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .focused($focusedField, equals: .tax)
                    }
                    HStack {
                        Text("Discount")
                        Spacer()
                        TextField("Discount", value: $viewModel.discount, format: .number)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .focused($focusedField, equals: .discount)
                    }
                }

                if let categoriesError = viewModel.categoriesError {
                    Section {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(categoriesError).foregroundStyle(.red)
                            Button("Retry") {
                                Task { await viewModel.loadCategories() }
                            }
                        }
                    }
                }

                if let errorMessage = viewModel.errorMessage {
                    Section {
                        Text(errorMessage).foregroundStyle(.red)
                    }
                }
            }
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    // The sticky footer with Confirm & Save sits below this Form — with no way to
                    // dismiss `.decimalPad` (it has no return key), it stayed hidden under the
                    // keyboard for the last field on the screen.
                    Button("Done") { focusedField = nil }
                }
            }

            footer
        }
    }

    private func mismatchBanner(_ mismatchAmount: Decimal) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Label(mismatchMessage(mismatchAmount), systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.orange)
                    .font(.footnote)
                Button("Add adjustment for \(abs(mismatchAmount).formatted(currencyCode: viewModel.currency))") {
                    viewModel.addAdjustmentItem()
                }
                .font(.footnote)
            }
        }
    }

    private func mismatchMessage(_ mismatchAmount: Decimal) -> String {
        let amount = abs(mismatchAmount).formatted(currencyCode: viewModel.currency)
        return mismatchAmount > 0
            ? "Items + tax − discount is short of the receipt total by \(amount)."
            : "Items + tax − discount is \(amount) over the receipt total."
    }

    private func itemRow(_ item: Binding<EditableItem>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Item name", text: item.name)
            HStack {
                TextField("Qty", value: item.quantity, format: .number)
                    .keyboardType(.decimalPad)
                    .frame(minWidth: 40, idealWidth: 50)
                    .focused($focusedField, equals: .itemQuantity(item.wrappedValue.id))
                TextField("Unit price", value: item.unitPrice, format: .number)
                    .keyboardType(.decimalPad)
                    .focused($focusedField, equals: .itemUnitPrice(item.wrappedValue.id))
                Spacer()
                TextField("Total", value: item.lineTotal, format: .number)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .frame(minWidth: 50, idealWidth: 70)
                    .focused($focusedField, equals: .itemLineTotal(item.wrappedValue.id))
            }
            .font(.subheadline)

            HStack(spacing: 6) {
                Menu {
                    ForEach(viewModel.categories) { category in
                        Button("\(category.emoji) \(category.name)") {
                            item.wrappedValue.categoryId = category.id
                        }
                    }
                } label: {
                    let selected = viewModel.categories.first { $0.id == item.wrappedValue.categoryId }
                    Label(selected.map { "\($0.emoji) \($0.name)" } ?? item.wrappedValue.categoryId, systemImage: "tag")
                        .font(.caption)
                }

                if isLowConfidence(item.wrappedValue) {
                    Label("Low confidence", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .accessibilityLabel("Low confidence reading — double-check this row")
                }

                priceBadge(for: item.wrappedValue)
            }
        }
        .padding(.vertical, 4)
    }

    private func isLowConfidence(_ item: EditableItem) -> Bool {
        guard let confidence = item.confidence else { return false }
        return confidence < ReviewViewModel.lowConfidenceThreshold
    }

    @ViewBuilder
    private func priceBadge(for item: EditableItem) -> some View {
        switch viewModel.priceBadge(for: item) {
        case .creep(let changeRatio):
            let percentText = changeRatio.formatted(.percent.precision(.fractionLength(0)))
            Label("Up \(percentText) since last time", systemImage: "arrow.up.circle.fill")
                .font(.caption)
                .foregroundStyle(.orange)
                .accessibilityLabel("Price up \(percentText) since last time")
        case .cheaperElsewhere(let merchant):
            Label("Cheaper at \(merchant)", systemImage: "tag")
                .font(.caption)
                .foregroundStyle(.blue)
                .accessibilityLabel("Cheaper at \(merchant)")
        case nil:
            EmptyView()
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
                Task {
                    await viewModel.confirm()
                    if viewModel.didConfirm {
                        onConfirmed()
                    }
                }
            } label: {
                if viewModel.isSaving {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Text("Confirm & Save").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.isSaving)
        }
        .padding()
        .background(.bar)
    }
}

#Preview {
    NavigationStack {
        ReviewView(
            receiptId: "preview",
            parsed: ParsedReceiptDTO(
                isReceipt: true,
                merchant: "Carrefour",
                purchasedAt: "2026-07-14T18:32:00",
                currency: "EGP",
                items: [],
                subtotal: nil,
                tax: nil,
                discount: nil,
                total: nil,
                warnings: [],
                overallConfidence: nil
            ),
            onConfirmed: {}
        )
    }
}
