import Foundation

/// No blob storage — images travel as base64 in the request body, used once in memory server-side
/// and never persisted.
struct ReceiptImageInput: Encodable, Sendable {
    let base64: String
    let position: Int
    let mimeType: String
}

/// Matches `ExtractionModeSchema` in apps/web/lib/api/schemas/receipts.ts.
enum ExtractionMode: String, Encodable, Sendable {
    case cloud
    case onDevice = "on_device"
}

struct ReceiptCreateRequest: Encodable, Sendable {
    let clientRef: String
    let images: [ReceiptImageInput]
    var extractionMode: ExtractionMode = .cloud
    /// Required by the server when `extractionMode == .onDevice` (AI_PROVIDER.md §10) — the result
    /// of `OnDeviceReceiptExtractor`, validated server-side against the same schema the cloud path's
    /// output goes through.
    var clientParsedPayload: ParsedReceiptDTO?
    /// e.g. "on-device:apple-foundation-model" — stored as `Receipt.model`.
    var clientModel: String?
    var clientLatencyMs: Int?
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

// Codable, not just Decodable: the on-device extraction path (AI_PROVIDER.md §10) builds one of
// these client-side and encodes it as `clientParsedPayload` on `POST /receipts`, same shape the
// cloud path decodes from `GET /receipts/:id`.
struct ParsedReceiptItemDTO: Codable, Sendable {
    let name: String
    let brand: String?
    let quantity: Double?
    let unit: String?
    let unitPrice: MoneyString?
    let lineTotal: MoneyString?
    let category: String
    let confidence: Double?
}

struct ParsedReceiptDTO: Codable, Sendable {
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
    /// How long extraction itself took — the vision call for cloud, OCR+generation for on-device
    /// (AI_PROVIDER.md §10). `nil` while still `PARSING`, or if a client never reported one.
    let latencyMs: Int?
}
