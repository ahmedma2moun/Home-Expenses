import Foundation

struct ReceiptImageInput: Encodable, Sendable {
    let blobKey: String
    let position: Int
    let mimeType: String
}

struct ReceiptCreateRequest: Encodable, Sendable {
    let clientRef: String
    let images: [ReceiptImageInput]
}

/// Matches ReceiptStatus in apps/web/prisma/schema.prisma.
enum ReceiptStatus: String, Decodable, Sendable {
    case uploaded = "UPLOADED"
    case parsing = "PARSING"
    case parsed = "PARSED"
    case failed = "FAILED"
    case confirmed = "CONFIRMED"
    case discarded = "DISCARDED"
}

struct ReceiptSummaryDTO: Decodable, Sendable {
    let id: String
    let status: ReceiptStatus
}

struct ParsedReceiptItemDTO: Decodable, Sendable {
    let name: String
    let quantity: Double?
    let unit: String?
    let unitPrice: MoneyString?
    let lineTotal: MoneyString?
    let category: String
    let confidence: Double?
}

struct ParsedReceiptDTO: Decodable, Sendable {
    let isReceipt: Bool
    let merchant: String?
    let purchasedAt: String?
    let currency: String?
    let items: [ParsedReceiptItemDTO]
    let subtotal: MoneyString?
    let tax: MoneyString?
    let discount: MoneyString?
    let total: MoneyString?
    let warnings: [String]
    let overallConfidence: Double?
}

struct ReceiptImageDetailDTO: Decodable, Sendable {
    let blobKey: String
    let position: Int
    let readUrl: String
}

struct ReceiptDetailDTO: Decodable, Sendable {
    let id: String
    let status: ReceiptStatus
    let parsedPayload: ParsedReceiptDTO?
    let parseError: String?
    let images: [ReceiptImageDetailDTO]
}
