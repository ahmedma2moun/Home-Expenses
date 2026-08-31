import Foundation

struct ConfirmOrderItemRequest: Encodable, Sendable {
    let name: String
    let brand: String?
    let quantity: Double
    let unit: String?
    let unitPrice: String?
    let lineTotal: String
    let categoryId: String
    let aiCategoryId: String?
    let position: Int
    let isProtein: Bool
}

struct ConfirmReceiptRequest: Encodable, Sendable {
    let merchant: String
    let periodMonth: String
    let periodWeek: Int
    let currency: String
    let subtotal: String
    let tax: String
    let discount: String
    let total: String
    /// What actually left the wallet, when it differs from `total` (tip, rounding, register
    /// discount) — omit when it's the same as `total`.
    let actualPaid: String?
    let notes: String?
    let items: [ConfirmOrderItemRequest]
}

struct ConfirmReceiptResponse: Decodable, Sendable {
    let orderId: String
}
