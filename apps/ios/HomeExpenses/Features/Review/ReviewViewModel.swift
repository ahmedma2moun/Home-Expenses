import Foundation

struct EditableItem: Identifiable {
    let id = UUID()
    var name: String
    var brand: String?
    var quantity: Double
    var unit: String?
    var unitPrice: Decimal?
    var lineTotal: Decimal
    var categoryId: String
    let aiCategoryId: String?
    /// The model's own confidence in this row, 0–1 — `nil` for a row the user added by hand, which
    /// has no AI reading to doubt. BR-2.6: rows below `ReviewViewModel.lowConfidenceThreshold` are
    /// flagged for a second look rather than silently trusted.
    var confidence: Double?
}

/// Editable state for the review screen (PROJECT_SPEC.md §10, screen 4). Nothing is written to
/// the backend until `confirm()` — the server trusts this final, user-edited payload (BR-2/BR-3).
@MainActor
final class ReviewViewModel: ObservableObject {
    /// BR-2.6: a row below this reading is flagged rather than silently trusted.
    static let lowConfidenceThreshold = 0.6

    @Published var merchant: String
    @Published var purchasedAt: Date?
    @Published var periodMonth: Date
    @Published var currency: String
    @Published var items: [EditableItem]
    @Published var tax: Decimal
    @Published var discount: Decimal
    @Published var notes: String = ""
    @Published private(set) var categories: [CategoryDTO] = []
    @Published private(set) var categoriesError: String?
    /// Keyed by the same normalized name the backend matches on (`normalizeItemName` on the
    /// server, `Self.normalize` here) — one batched lookup at load time, not one call per row.
    @Published private(set) var priceChecks: [String: PriceCheckResultDTO] = [:]
    @Published private(set) var isSaving = false
    @Published var errorMessage: String?
    @Published private(set) var didConfirm = false

    /// The model's own warnings about this parse (e.g. "Line 12 price is cropped and was not
    /// read") — surfaced as-is; BR-2.6 asks that low-confidence signals not be silently dropped.
    let warnings: [String]
    /// False when the images the user captured weren't a receipt at all. In the normal flow the
    /// backend already routes this to a `FAILED` receipt status before Review is ever reached
    /// (`runExtraction` in `receipts.ts`) — this is the defensive second check, not the primary one.
    let isReceipt: Bool

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

    /// Signed: positive means the entered items fall short of the receipt's printed total (an
    /// adjustment would add this much); negative means they overshoot it. `nil` whenever there's
    /// no mismatch to explain, so the banner never states a number that doesn't matter.
    var mismatchAmount: Decimal? {
        guard totalMismatch, let originalTotal else { return nil }
        return originalTotal - grandTotal
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
        warnings = parsed.warnings
        isReceipt = parsed.isReceipt
        items = parsed.items.map { item in
            EditableItem(
                name: item.name,
                brand: item.brand,
                quantity: item.quantity ?? 1,
                unit: item.unit,
                unitPrice: item.unitPrice?.value,
                lineTotal: item.lineTotal?.value ?? 0,
                categoryId: item.category,
                aiCategoryId: item.category,
                confidence: item.confidence
            )
        }
    }

    func loadCategories() async {
        categoriesError = nil
        do {
            let response: [CategoryDTO] = try await client.get("/api/v1/categories")
            categories = response.sorted { $0.sortOrder < $1.sortOrder }
        } catch {
            guard !error.isTaskCancellation else { return }
            // Without the taxonomy every category chip has nothing to render but the raw stored
            // slug and no menu to change it from — worth a distinct message and a retry, not a
            // silent empty list.
            categoriesError =
                (error as? LocalizedError)?.errorDescription ?? "Couldn't load categories."
        }
    }

    /// Same rule as the backend's `normalizeItemName` (lib/services/orders.ts) — the matching key
    /// for `priceChecks`, computed client-side so a lookup doesn't need a round trip per keystroke.
    static func normalize(_ name: String) -> String {
        name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// The one domain decision behind the Review row's price badge: a creep warning always wins
    /// over a cheaper-elsewhere note, since both point at the same row and the creep is the more
    /// actionable of the two while the user is still editing. Lives here, not in the view, per
    /// "views are dumb."
    enum PriceBadge {
        case creep(changeRatio: Double)
        case cheaperElsewhere(merchant: String)
    }

    func priceBadge(for item: EditableItem) -> PriceBadge? {
        guard let check = priceChecks[Self.normalize(item.name)] else { return nil }
        if let creep = check.priceCreep {
            return .creep(changeRatio: creep.changeRatio)
        }
        if let cheapest = check.cheapest,
            cheapest.merchant.localizedCaseInsensitiveCompare(merchant) != .orderedSame
        {
            return .cheaperElsewhere(merchant: cheapest.merchant)
        }
        return nil
    }

    /// Matches the backend's `PriceCheckRequestSchema` cap (`lib/api/schemas/items.ts`) — a request
    /// over the limit would 400 the whole batch and silently turn every badge off.
    private static let maxPriceCheckItems = 50

    /// One batched lookup over every item as originally parsed, fired once when the screen loads.
    /// Best-effort: a failure here leaves the badges off, not the whole screen — Review is fully
    /// usable without this hint. Deliberately not re-run as the user edits rows afterward.
    func checkPrices() async {
        let payloadItems =
            items
            .filter { !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .prefix(Self.maxPriceCheckItems)
            .map { PriceCheckItemRequest(name: $0.name, unitPrice: $0.unitPrice?.wireString, unit: $0.unit) }
        guard !payloadItems.isEmpty else { return }
        do {
            let request = PriceCheckRequest(
                merchant: merchant.trimmingCharacters(in: .whitespaces).isEmpty ? "Unknown merchant" : merchant,
                items: Array(payloadItems)
            )
            let results: [PriceCheckResultDTO] = try await client.post("/api/v1/items/price-check", body: request)
            priceChecks = Dictionary(results.map { ($0.name, $0) }, uniquingKeysWith: { first, _ in first })
        } catch {
            guard !error.isTaskCancellation else { return }
            // Silent otherwise — see the doc comment above; the badges just stay off.
        }
    }

    func addItem() {
        items.append(
            EditableItem(
                name: "",
                brand: nil,
                quantity: 1,
                unit: nil,
                unitPrice: nil,
                lineTotal: 0,
                categoryId: categories.first?.id ?? "other",
                aiCategoryId: nil,
                confidence: nil
            )
        )
    }

    /// BR-2.7's "adjustment" line item: one new row that reconciles `grandTotal` back to the
    /// receipt's own printed total exactly, so the user isn't left hunting for a misread line by
    /// hand. Negative when the entered items overshoot the printed total (moneySchema allows a
    /// leading `-`, mirroring `discount`'s sign convention on the wire).
    func addAdjustmentItem() {
        guard let mismatchAmount else { return }
        items.append(
            EditableItem(
                name: "Adjustment",
                brand: nil,
                quantity: 1,
                unit: nil,
                unitPrice: nil,
                lineTotal: mismatchAmount,
                categoryId: categories.first(where: { $0.id == "other" })?.id ?? "other",
                aiCategoryId: nil,
                confidence: nil
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
                brand: item.brand,
                quantity: item.quantity,
                unit: item.unit,
                unitPrice: item.unitPrice?.wireString,
                lineTotal: item.lineTotal.wireString,
                categoryId: item.categoryId,
                aiCategoryId: item.aiCategoryId,
                position: index
            )
        }

        let request = ConfirmReceiptRequest(
            merchant: merchant,
            purchasedAt: purchasedAt.map { ISO8601DateFormatter.wire.string(from: $0) },
            periodMonth: MonthLabel.format(periodMonth),
            currency: currency,
            subtotal: subtotal.wireString,
            tax: tax.wireString,
            discount: discount.wireString,
            total: grandTotal.wireString,
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
}
