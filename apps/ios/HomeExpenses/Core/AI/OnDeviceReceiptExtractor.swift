import FoundationModels
import UIKit
import Vision

enum OnDeviceExtractionError: LocalizedError {
    case unavailable(reason: String)
    case noTextFound
    case generationFailed

    var errorDescription: String? {
        switch self {
        case .unavailable(let reason): return reason
        case .noTextFound: return "Couldn't read any text from this receipt."
        case .generationFailed: return "The on-device model couldn't parse this receipt."
        }
    }
}

/// On-device alternative to the backend's cloud extraction call (AI_PROVIDER.md §10): Vision OCR
/// reads the receipt images, then Apple's on-device Foundation Model turns that text into the same
/// shape `ParsedReceiptDTO` already has. Text-only — the model never sees the image itself, only
/// what OCR read off it — so accuracy trails the cloud vision path on cluttered/handwritten receipts.
/// Instructions kept in sync with docs/prompts/extraction-on-device.v1.md (prompt-change skill).
enum OnDeviceReceiptExtractor {
    /// Matches `docs/prompts/extraction-on-device.v1.md`. Recorded in `Receipt.model` (see
    /// `modelIdentifier`) so the server can tell which prompt version produced a given receipt —
    /// there's no shared eval harness (yet) to catch the two drifting apart, per that doc's caveat.
    static let promptVersion = "extraction-on-device.v1"

    /// What `CaptureViewModel` sends as `clientModel` on `POST /receipts`.
    static let modelIdentifier = "on-device:apple-foundation-model:\(promptVersion)"

    /// Mirrors `ParsedReceiptSchema` (apps/web/lib/api/schemas/receipts.ts) field-for-field so the
    /// result can travel as `clientParsedPayload` unchanged. Money fields are `String`, not
    /// `Decimal` — `@Generable` doesn't support `Decimal` as a field type, and the wire format is a
    /// string anyway (CLAUDE.md rule 1); `map(_:)` below converts each one through `MoneyString`
    /// before it reaches `ParsedReceiptDTO`, so nothing downstream ever sees a raw unparsed string.
    @available(iOS 26.0, *)
    @Generable
    struct GeneratedReceipt {
        @Guide(description: "True only if this text is clearly from a retail/restaurant receipt.")
        var isReceipt: Bool
        @Guide(description: "The merchant/store name, or null if not legible.")
        var merchant: String?
        @Guide(description: "Currency code or symbol read from the receipt, or null if absent.")
        var currency: String?
        var items: [GeneratedItem]
        @Guide(description: "Money amount with exactly two decimals, e.g. \"45.00\", or null.")
        var subtotal: String?
        var tax: String?
        var discount: String?
        var total: String?
        var warnings: [String]
        @Guide(description: "Overall confidence in this parse, 0 to 1.")
        var overallConfidence: Double?
    }

    @available(iOS 26.0, *)
    @Generable
    struct GeneratedItem {
        var name: String
        @Guide(description: "Manufacturer/product-line name, or null if none is printed/legible.")
        var brand: String?
        @Guide(description: "Quantity purchased; default to 1 if the text doesn't state one.")
        var quantity: Double?
        var unit: String?
        @Guide(description: "Money amount with exactly two decimals, or null if unreadable.")
        var unitPrice: String?
        var lineTotal: String?
        @Guide(description: "Exactly one category slug from the allowed list in the instructions.")
        var category: String
        @Guide(description: "This item's own confidence, 0 to 1.")
        var confidence: Double?
    }

    /// - Parameters:
    ///   - images: the original captured images (not the downscaled upload bytes) — OCR accuracy
    ///     benefits from the higher resolution.
    ///   - categorySlugs: the current active taxonomy from `GET /api/v1/categories`, fetched by the
    ///     caller — never hardcoded here, so this can't drift from the server's list.
    ///
    /// Deliberately not `@MainActor`: OCR (`.accurate` recognition with language correction, over
    /// up to 6 full-resolution photos) is exactly the kind of work that must not block the main
    /// thread. `CaptureViewModel` (which is `@MainActor`) simply `await`s this from a background
    /// executor hop, same as any other non-isolated async call.
    static func extract(images: [UIImage], categorySlugs: [String]) async throws -> ParsedReceiptDTO {
        switch OnDeviceAvailability.current() {
        case .unavailable(let reason):
            throw OnDeviceExtractionError.unavailable(reason: reason)
        case .available:
            break
        }
        guard #available(iOS 26.0, *) else {
            throw OnDeviceExtractionError.unavailable(reason: "Requires iOS 26 or later.")
        }
        return try await extractOnSupportedOS(images: images, categorySlugs: categorySlugs)
    }

    @available(iOS 26.0, *)
    private static func extractOnSupportedOS(
        images: [UIImage],
        categorySlugs: [String]
    ) async throws -> ParsedReceiptDTO {
        let text = try recognizeText(in: images)
        guard !text.isEmpty else { throw OnDeviceExtractionError.noTextFound }

        let session = LanguageModelSession(instructions: instructions(categorySlugs: categorySlugs))
        let response: LanguageModelSession.Response<GeneratedReceipt>
        do {
            response = try await session.respond(
                to: "Receipt text, in reading order:\n\n\(text)",
                generating: GeneratedReceipt.self
            )
        } catch is CancellationError {
            // Pass through as-is — a cancelled "Analyze" (user backed out, view disappeared) is not
            // a parse failure, and `CaptureViewModel` needs to tell the two apart.
            throw CancellationError()
        } catch {
            // The framework's own error cases (context window overflow from a long receipt's OCR
            // text, guardrail refusals, etc.) don't have a single stable public type to switch on
            // here; folded into one message rather than silently mis-describing a specific cause.
            throw OnDeviceExtractionError.generationFailed
        }

        return map(response.content)
    }

    private static func recognizeText(in images: [UIImage]) throws -> String {
        var pages: [String] = []
        for image in images {
            guard let cgImage = image.cgImage else { continue }
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            try handler.perform([request])
            let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
            pages.append(lines.joined(separator: "\n"))
        }
        return pages.joined(separator: "\n---\n")
    }

    private static func instructions(categorySlugs: [String]) -> String {
        """
        You extract structured data from OCR text of a retail receipt. Read every line item. \
        Never invent a price you cannot read: set it to null and lower confidence. Assign each \
        item exactly one category slug from this allowed list: \(categorySlugs.joined(separator: ", ")). \
        Prefer the most specific matching category; use "other" only when nothing fits. If the text \
        is not a receipt, set isReceipt to false.
        """
    }

    @available(iOS 26.0, *)
    private static func map(_ generated: GeneratedReceipt) -> ParsedReceiptDTO {
        ParsedReceiptDTO(
            isReceipt: generated.isReceipt,
            merchant: generated.merchant,
            currency: generated.currency,
            items: generated.items.map { item in
                ParsedReceiptItemDTO(
                    name: item.name,
                    brand: item.brand,
                    quantity: roundedQuantity(item.quantity),
                    unit: item.unit,
                    unitPrice: money(item.unitPrice),
                    lineTotal: money(item.lineTotal),
                    category: item.category,
                    confidence: item.confidence
                )
            },
            subtotal: money(generated.subtotal),
            tax: money(generated.tax),
            discount: money(generated.discount),
            total: money(generated.total),
            warnings: generated.warnings,
            overallConfidence: generated.overallConfidence
        )
    }

    private static func money(_ raw: String?) -> MoneyString? {
        raw.flatMap { MoneyString(wireString: $0) }
    }

    /// `OrderItem.quantity` is `Decimal(10,3)` server-side; a generated `Double` like
    /// `0.30000000000000004` would round-trip through JSON as float noise for no reason (`quantity`
    /// isn't money, so `MoneyString`'s strict parsing doesn't apply, but it's still a number a
    /// human reviews on the Review screen before confirming).
    private static func roundedQuantity(_ raw: Double?) -> Double? {
        raw.map { (($0 * 1000).rounded()) / 1000 }
    }
}
