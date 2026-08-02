import Foundation

/// One past purchase of an item. Shared by `GET /api/v1/items/price-history`,
/// `GET /api/v1/analytics/price-watch`, and `POST /api/v1/items/price-check`
/// (lib/services/priceHistory.ts). `purchasedAt` stays `String` and goes through
/// `FlexibleDateParser`, same reasoning as `OrderSummaryDTO`.
struct PriceHistoryEntryDTO: Decodable, Sendable {
    let orderId: String
    let merchant: String
    let unitPrice: MoneyString
    let purchasedAt: String?
    let periodMonth: String

    var displayDate: Date? {
        purchasedAt.flatMap(FlexibleDateParser.parse)
    }
}

/// A price rise between two purchases of the same item **at the same merchant** — cross-merchant
/// comparisons are never surfaced as creep (see `priceHistory.ts`'s `computeCreep`).
struct PriceCreepDTO: Decodable, Sendable {
    let previousMerchant: String
    let previousUnitPrice: MoneyString
    let latestUnitPrice: MoneyString
    let changeRatio: Double
}

/// Mirrors `GET /api/v1/items/price-history` — backs the item-history sheet.
struct ItemPriceHistoryDTO: Decodable, Sendable {
    let itemName: String
    let history: [PriceHistoryEntryDTO]
    let cheapest: PriceHistoryEntryDTO?
    let priceCreep: PriceCreepDTO?
}

/// Mirrors one row of `GET /api/v1/analytics/price-watch` — backs the Home teaser (which only
/// needs the array's count) and the Analytics "Price Watch" section.
struct PriceWatchItemDTO: Decodable, Identifiable, Sendable {
    var id: String { normalizedName }
    let itemName: String
    let normalizedName: String
    let merchant: String
    let previousMerchant: String
    let previousUnitPrice: MoneyString
    let latestUnitPrice: MoneyString
    let changeRatio: Double
    let periodMonth: String
}

/// Body of `POST /api/v1/items/price-check` — one entry per unconfirmed draft item on the Review
/// screen. `unitPrice`/`unit` mirror `EditableItem`'s own fields, which can still be empty at this
/// point. A `nil` `unit` only matches history rows that also have no `unit` recorded — see
/// `lib/services/priceHistory.ts`'s `sameUnit`.
struct PriceCheckItemRequest: Encodable, Sendable {
    let name: String
    let unitPrice: String?
    let unit: String?
}

struct PriceCheckRequest: Encodable, Sendable {
    let merchant: String
    let items: [PriceCheckItemRequest]
}

/// One result per **unique** normalized item name sent in the request.
struct PriceCheckResultDTO: Decodable, Sendable {
    let name: String
    let cheapest: PriceHistoryEntryDTO?
    let priceCreep: PriceCreepDTO?
}
