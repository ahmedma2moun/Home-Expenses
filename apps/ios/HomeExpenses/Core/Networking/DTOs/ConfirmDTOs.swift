import Foundation

struct ConfirmOrderItemRequest: Encodable, Sendable {
    let name: String
    let quantity: Double
    let unit: String?
    let unitPrice: String?
    let lineTotal: String
    let categoryId: String
    let aiCategoryId: String?
    let position: Int
}

struct ConfirmReceiptRequest: Encodable, Sendable {
    let merchant: String
    let purchasedAt: String?
    let periodMonth: String
    let currency: String
    let subtotal: String
    let tax: String
    let discount: String
    let total: String
    let notes: String?
    let items: [ConfirmOrderItemRequest]
}

struct ConfirmReceiptResponse: Decodable, Sendable {
    let orderId: String
}
