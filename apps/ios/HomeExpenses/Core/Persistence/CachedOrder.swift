import Foundation
import SwiftData

/// Offline read cache of confirmed orders, synced from `GET /orders` (PROJECT_SPEC.md §10).
/// Not the source of truth — the backend is. Ships in M3 alongside the orders list.
@Model
final class CachedOrder {
    @Attribute(.unique) var id: String
    var merchant: String
    var periodMonth: Date
    var currency: String
    var total: Decimal
    var updatedAt: Date

    init(id: String, merchant: String, periodMonth: Date, currency: String, total: Decimal, updatedAt: Date) {
        self.id = id
        self.merchant = merchant
        self.periodMonth = periodMonth
        self.currency = currency
        self.total = total
        self.updatedAt = updatedAt
    }
}
