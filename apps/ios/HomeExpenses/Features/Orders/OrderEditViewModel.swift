import Foundation

/// Editable state for one saved order (BR-4: correct it, move it to another month, delete it).
/// Mirrors `ReviewViewModel`, but against `PATCH /orders/:id` instead of the confirm endpoint —
/// the line-item shape is the same, so `EditableItem` is shared.
@MainActor
final class OrderEditViewModel: ObservableObject {
    @Published var merchant = ""
    @Published var purchasedAt: Date?
    @Published var periodMonth = MonthLabel.startOfMonth(Date())
    @Published var currency = "EGP"
    @Published var items: [EditableItem] = []
    @Published var tax: Decimal = 0
    @Published var discount: Decimal = 0
    @Published var notes = ""
    @Published private(set) var categories: [CategoryDTO] = []
    @Published private(set) var isSaving = false
    @Published private(set) var didFinish = false
    /// Set only when the order itself couldn't be read. The form stays hidden until it clears —
    /// editing defaults over an order we never loaded would save nonsense over a real one.
    @Published private(set) var loadError: String?
    @Published private(set) var isLoaded = false
    /// A save or delete that failed, shown alongside the form the user is still editing.
    @Published var errorMessage: String?

    private let orderId: String
    private let client = APIClient.shared

    init(orderId: String) {
        self.orderId = orderId
    }

    var subtotal: Decimal {
        items.reduce(Decimal(0)) { $0 + $1.lineTotal }
    }

    var grandTotal: Decimal {
        subtotal + tax - discount
    }

    /// The screen needs both the order and the taxonomy behind its category chips.
    func loadAll() async {
        await load()
        await loadCategories()
    }

    func load() async {
        loadError = nil

        do {
            let order: OrderDetailDTO = try await client.get("/api/v1/orders/\(orderId)")
            guard let month = MonthLabel.parse(order.periodMonth) else {
                // Guessing a month here would quietly move the order on the next save.
                loadError = "This order's month (\(order.periodMonth)) couldn't be read."
                return
            }
            apply(order, periodMonth: month)
            isLoaded = true
        } catch {
            guard !error.isTaskCancellation else { return }
            loadError = (error as? LocalizedError)?.errorDescription ?? "Couldn't load this order."
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

    /// Orders saved before the receipt date could be read have none; default to the month being
    /// billed rather than today, which may sit in a different month entirely.
    func addPurchaseDate() {
        purchasedAt = periodMonth
    }

    func save() async {
        guard !items.isEmpty else {
            errorMessage = "An order needs at least one item. Delete the order instead."
            return
        }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        do {
            let _: OrderDetailDTO = try await client.patch("/api/v1/orders/\(orderId)", body: updateRequest())
            didFinish = true
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't save this order."
        }
    }

    func delete() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        do {
            let _: OrderDeleteResponse = try await client.delete("/api/v1/orders/\(orderId)")
            didFinish = true
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't delete this order."
        }
    }

    private func apply(_ order: OrderDetailDTO, periodMonth month: Date) {
        merchant = order.merchant
        purchasedAt = order.purchasedAt.flatMap(FlexibleDateParser.parse)
        periodMonth = month
        currency = order.currency
        tax = order.tax.value
        discount = order.discount.value
        notes = order.notes ?? ""
        items = order.items.map { item in
            EditableItem(
                name: item.name,
                quantity: item.quantity,
                unit: item.unit,
                unitPrice: item.unitPrice?.value,
                lineTotal: item.lineTotal.value,
                categoryId: item.categoryId,
                // Kept so the learning-loop record (ItemCategoryOverride) survives an edit —
                // dropping it would make a re-categorized item look like the AI's own choice.
                aiCategoryId: item.aiCategoryId
            )
        }
    }

    private func updateRequest() -> OrderUpdateRequest {
        OrderUpdateRequest(
            merchant: merchant,
            purchasedAt: purchasedAt.map { ISO8601DateFormatter().string(from: $0) },
            periodMonth: MonthLabel.format(periodMonth),
            currency: currency,
            subtotal: subtotal.wireString,
            tax: tax.wireString,
            discount: discount.wireString,
            total: grandTotal.wireString,
            notes: notes,
            items: items.enumerated().map { index, item in
                OrderItemInput(
                    name: item.name,
                    quantity: item.quantity,
                    unit: item.unit,
                    unitPrice: item.unitPrice?.wireString,
                    lineTotal: item.lineTotal.wireString,
                    categoryId: item.categoryId,
                    aiCategoryId: item.aiCategoryId,
                    position: index
                )
            }
        )
    }
}
