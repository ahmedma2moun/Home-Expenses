import SwiftUI

/// The core review & confirm screen: editable merchant/date/month, per-item category/qty/price,
/// mismatch banner, Confirm & Save footer (PROJECT_SPEC.md §10, screen 4).
struct ReviewView: View {
    @StateObject private var viewModel: ReviewViewModel
    var onConfirmed: () -> Void

    init(receiptId: String, parsed: ParsedReceiptDTO, onConfirmed: @escaping () -> Void) {
        _viewModel = StateObject(wrappedValue: ReviewViewModel(receiptId: receiptId, parsed: parsed))
        self.onConfirmed = onConfirmed
    }

    var body: some View {
        VStack(spacing: 0) {
            Form {
                Section("Receipt") {
                    TextField("Merchant", text: $viewModel.merchant)
                    HStack {
                        Text("Month")
                        Spacer()
                        Button {
                            viewModel.shiftMonth(by: -1)
                        } label: {
                            Image(systemName: "chevron.left")
                        }
                        Text(MonthLabel.format(viewModel.periodMonth))
                            .monospacedDigit()
                            .frame(minWidth: 70)
                        Button {
                            viewModel.shiftMonth(by: 1)
                        } label: {
                            Image(systemName: "chevron.right")
                        }
                    }
                    .buttonStyle(.plain)
                    TextField("Currency", text: $viewModel.currency)
                        .textInputAutocapitalization(.characters)
                }

                if viewModel.totalMismatch {
                    Section {
                        Label("Items + tax − discount doesn't match the receipt total.", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                            .font(.footnote)
                    }
                }

                Section("Items") {
                    ForEach($viewModel.items) { $item in
                        VStack(alignment: .leading, spacing: 6) {
                            TextField("Item name", text: $item.name)
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
                                ForEach(viewModel.categories) { category in
                                    Button("\(category.emoji) \(category.name)") {
                                        item.categoryId = category.id
                                    }
                                }
                            } label: {
                                let selected = viewModel.categories.first { $0.id == item.categoryId }
                                Label(selected.map { "\($0.emoji) \($0.name)" } ?? item.categoryId, systemImage: "tag")
                                    .font(.caption)
                            }
                        }
                        .padding(.vertical, 4)
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
                    }
                    HStack {
                        Text("Discount")
                        Spacer()
                        TextField("Discount", value: $viewModel.discount, format: .number)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }
                }

                if let errorMessage = viewModel.errorMessage {
                    Section {
                        Text(errorMessage).foregroundStyle(.red)
                    }
                }
            }

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
        .navigationTitle("Review")
        .navigationBarBackButtonHidden(true)
        .task {
            await viewModel.loadCategories()
        }
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
