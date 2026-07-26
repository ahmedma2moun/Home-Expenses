import Foundation

struct EditableItem: Identifiable {
    let id = UUID()
    var name: String
    var quantity: Double
    var unit: String?
    var unitPrice: Decimal?
    var lineTotal: Decimal
    var categoryId: String
    let aiCategoryId: String?
}

/// Editable state for the review screen (PROJECT_SPEC.md §10, screen 4). Nothing is written to
/// the backend until `confirm()` — the server trusts this final, user-edited payload (BR-2/BR-3).
@MainActor
final class ReviewViewModel: ObservableObject {
    @Published var merchant: String
    @Published var purchasedAt: Date?
    @Published var periodMonth: Date
    @Published var currency: String
    @Published var items: [EditableItem]
    @Published var tax: Decimal
    @Published var discount: Decimal
    @Published var notes: String = ""
    @Published private(set) var categories: [CategoryDTO] = []
    @Published private(set) var isSaving = false
    @Published var errorMessage: String?
    @Published private(set) var didConfirm = false

    private let client = APIClient.shared
    private let receiptId: String

    var subtotal: Decimal {
        items.reduce(Decimal(0)) { $0 + $1.lineTotal }
    }

    var grandTotal: Decimal {
        subtotal + tax - discount
    }

    /// Non-blocking mismatch check (BR-2): flags when items+tax-discount drift from the AI total
    /// by more than 1% or 1 currency unit, whichever is larger.
    var totalMismatch: Bool {
        guard let originalTotal else { return false }
        let diff = abs(grandTotal - originalTotal)
        let onePercent = originalTotal / Decimal(100)
        let tolerance = max(Decimal(1), onePercent)
        return diff > tolerance
    }

    private let originalTotal: Decimal?

    init(receiptId: String, parsed: ParsedReceiptDTO) {
        let parsedDate = parsed.purchasedAt.flatMap(FlexibleDateParser.parse)

        self.receiptId = receiptId
        merchant = parsed.merchant ?? ""
        currency = parsed.currency ?? "EGP"
        purchasedAt = parsedDate
        periodMonth = MonthLabel.startOfMonth(parsedDate ?? Date())
        tax = parsed.tax?.value ?? 0
        discount = parsed.discount?.value ?? 0
        originalTotal = parsed.total?.value
        items = parsed.items.map { item in
            EditableItem(
                name: item.name,
                quantity: item.quantity ?? 1,
                unit: item.unit,
                unitPrice: item.unitPrice?.value,
                lineTotal: item.lineTotal?.value ?? 0,
                categoryId: item.category,
                aiCategoryId: item.category
            )
        }
    }

    func loadCategories() async {
        if let response = try? await client.get("/api/v1/categories") as [CategoryDTO] {
            categories = response.sorted { $0.sortOrder < $1.sortOrder }
        }
    }

    func addItem() {
        items.append(
            EditableItem(
                name: "",
                quantity: 1,
                unit: nil,
                unitPrice: nil,
                lineTotal: 0,
                categoryId: categories.first?.id ?? "other",
                aiCategoryId: nil
            )
        )
    }

    func removeItem(at offsets: IndexSet) {
        items.remove(atOffsets: offsets)
    }

    func shiftMonth(by months: Int) {
        periodMonth = Calendar.current.date(byAdding: .month, value: months, to: periodMonth) ?? periodMonth
    }

    func confirm() async {
        guard !items.isEmpty else {
            errorMessage = "Add at least one item."
            return
        }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        let requestItems = items.enumerated().map { index, item in
            ConfirmOrderItemRequest(
                name: item.name,
                quantity: item.quantity,
                unit: item.unit,
                unitPrice: item.unitPrice.map(Self.moneyString),
                lineTotal: Self.moneyString(item.lineTotal),
                categoryId: item.categoryId,
                aiCategoryId: item.aiCategoryId,
                position: index
            )
        }

        let request = ConfirmReceiptRequest(
            merchant: merchant,
            purchasedAt: purchasedAt.map { ISO8601DateFormatter().string(from: $0) },
            periodMonth: MonthLabel.format(periodMonth),
            currency: currency,
            subtotal: Self.moneyString(subtotal),
            tax: Self.moneyString(tax),
            discount: Self.moneyString(discount),
            total: Self.moneyString(grandTotal),
            notes: notes.isEmpty ? nil : notes,
            items: requestItems
        )

        do {
            let _ = try await client.post("/api/v1/receipts/\(receiptId)/confirm", body: request)
                as ConfirmReceiptResponse
            didConfirm = true
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't save this order."
        }
    }

    private static func moneyString(_ value: Decimal) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        formatter.usesGroupingSeparator = false
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.string(from: value as NSDecimalNumber) ?? "0.00"
    }
}
