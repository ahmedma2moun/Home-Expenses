import Foundation

/// Mirrors `GET /api/v1/orders` — one row of the month list, without its line items
/// (lib/services/orderManagement.ts).
/// Timestamps stay `String` on the DTO and go through `FlexibleDateParser`: the backend's
/// `toISOString()` carries fractional seconds, which `JSONDecoder`'s stock `.iso8601` strategy
/// rejects outright.
struct OrderSummaryDTO: Decodable, Identifiable, Sendable {
    let id: String
    let merchant: String
    let purchasedAt: String?
    let periodMonth: String
    let currency: String
    let total: MoneyString
    let itemCount: Int
    let source: String
    let createdAt: String

    /// The receipt's own date when it was readable, otherwise the day the order was saved.
    var displayDate: Date? {
        purchasedAt.flatMap(FlexibleDateParser.parse) ?? FlexibleDateParser.parse(createdAt)
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
    let quantity: Double
    let unit: String?
    let unitPrice: MoneyString?
    let lineTotal: MoneyString
    let categoryId: String
    let aiCategoryId: String?
    let position: Int
}

/// Mirrors `GET /api/v1/orders/:id` and the body of a successful `PATCH`.
struct OrderDetailDTO: Decodable, Sendable {
    let id: String
    let receiptId: String?
    let merchant: String
    let purchasedAt: String?
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
    var purchasedAt: String?
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
