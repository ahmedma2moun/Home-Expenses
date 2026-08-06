import Foundation

/// No blob storage — images travel as base64 in the request body, used once in memory server-side
/// and never persisted.
struct ReceiptImageInput: Encodable, Sendable {
    let base64: String
    let position: Int
    let mimeType: String
}

struct ReceiptCreateRequest: Encodable, Sendable {
    let clientRef: String
    let images: [ReceiptImageInput]
}

struct ReparseRequest: Encodable, Sendable {
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
    let brand: String?
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
    let position: Int
    let mimeType: String
}

struct ReceiptDetailDTO: Decodable, Sendable {
    let id: String
    let status: ReceiptStatus
    let parsedPayload: ParsedReceiptDTO?
    let parseError: String?
    let images: [ReceiptImageDetailDTO]
}
