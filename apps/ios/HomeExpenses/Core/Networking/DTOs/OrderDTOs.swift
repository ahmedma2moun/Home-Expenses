import Foundation

/// Mirrors `GET /api/v1/orders` — one row of the month list, without its line items
/// (lib/services/orderManagement.ts).
/// `createdAt` stays `String` on the DTO and goes through `FlexibleDateParser`: the backend's
/// `toISOString()` carries fractional seconds, which `JSONDecoder`'s stock `.iso8601` strategy
/// rejects outright.
struct OrderSummaryDTO: Decodable, Identifiable, Sendable {
    let id: String
    let merchant: String
    let periodMonth: String
    let currency: String
    let total: MoneyString
    let itemCount: Int
    let source: String
    let createdAt: String

    /// The day the order was saved — there is no separate receipt date (extraction no longer
    /// reads one; see `docs/prompts/extraction.v3.md`).
    var displayDate: Date? {
        FlexibleDateParser.parse(createdAt)
    }

    var itemCountLabel: String {
        itemCount == 1 ? "1 item" : "\(itemCount) items"
    }

    /// Prefixed "Saved" rather than shown bare: this list is already scoped to one accounting
    /// month, and an order confirmed after the fact (a July receipt saved in August) would
    /// otherwise show a date that looks like it belongs to the wrong month.
    var subtitle: String {
        guard let displayDate else { return itemCountLabel }
        return "Saved \(displayDate.formatted(date: .abbreviated, time: .omitted)) · \(itemCountLabel)"
    }
}

struct OrderListPageDTO: Decodable, Sendable {
    let orders: [OrderSummaryDTO]
    /// Send back as `?cursor=` for the next page; `nil` on the last one.
    let nextCursor: String?
}

/// One saved line item. `quantity` is a count or weight, so it is a JSON number — the money
/// fields next to it are strings (CLAUDE.md rule 1).
struct OrderItemDTO: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let brand: String?
    let quantity: Double
    let unit: String?
    let unitPrice: MoneyString?
    let lineTotal: MoneyString
    let categoryId: String
    let aiCategoryId: String?
    let position: Int

    /// "Milkman Full Cream Milk" when a brand was captured, otherwise just the item name — for
    /// read-only rows (e.g. `OrderGroupView`) that don't edit brand and name as separate fields.
    var displayName: String {
        guard let brand, !brand.isEmpty else { return name }
        return "\(brand) \(name)"
    }
}

/// Mirrors `GET /api/v1/orders/:id` and the body of a successful `PATCH`. The response's
/// `createdAt`/`updatedAt` are deliberately left out — the edit screen shows neither, and
/// `Decodable` ignores keys it wasn't given a home for.
struct OrderDetailDTO: Decodable, Sendable {
    let id: String
    let receiptId: String?
    let merchant: String
    let periodMonth: String
    let currency: String
    let subtotal: MoneyString
    let tax: MoneyString
    let discount: MoneyString
    let total: MoneyString
    let notes: String?
    let source: String
    let itemCount: Int
    let items: [OrderItemDTO]
}

/// Body of `PATCH /api/v1/orders/:id`. Every field is optional and an omitted one is left
/// untouched server-side; the synthesized `Encodable` conformance uses `encodeIfPresent`, so a
/// `nil` here is left out of the JSON entirely rather than sent as `null`. `items` replaces the
/// whole list, and the backend then requires `subtotal` and `total` alongside it.
struct OrderUpdateRequest: Encodable, Sendable {
    var merchant: String?
    var periodMonth: String?
    var currency: String?
    var subtotal: String?
    var tax: String?
    var discount: String?
    var total: String?
    var notes: String?
    var items: [OrderItemInput]?
}

struct OrderItemInput: Encodable, Sendable {
    let name: String
    let brand: String?
    let quantity: Double
    let unit: String?
    let unitPrice: String?
    let lineTotal: String
    let categoryId: String
    let aiCategoryId: String?
    let position: Int
}

struct OrderDeleteResponse: Decodable, Sendable {
    let id: String
}

/// One order's items within a single category. Mirrors `GET /api/v1/orders/by-category` — the
/// Home screen's "expand a category" drill-down (lib/services/orderManagement.ts).
struct CategoryOrderGroupDTO: Decodable, Identifiable, Sendable {
    let orderId: String
    let merchant: String
    let createdAt: String
    let currency: String
    let items: [OrderItemDTO]

    var id: String { orderId }

    var displayDate: Date? {
        FlexibleDateParser.parse(createdAt)
    }
}

struct CategoryItemsPageDTO: Decodable, Sendable {
    let month: String
    let categoryId: String
    let orders: [CategoryOrderGroupDTO]
}
