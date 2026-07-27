import Foundation

/// Carries the data the capture → parsing → review flow hands between its steps.
///
/// Deliberately a reference type rather than `@State` dictionaries on `ReceiptFlowView`. The
/// callbacks that write it are escaping closures owned by the pushed screens, and they write the
/// payload in the same turn as the `path.append` that navigates to it — a `navigationDestination`
/// closure built before that write reads its own stale copy of a `@State` dictionary, finds
/// nothing, and pushes an empty screen. Reference storage is read live, so the payload is always
/// there by the time the destination is built.
@MainActor
final class ReceiptFlowViewModel: ObservableObject {
    private var imagesByReceiptId: [String: [ReceiptImageInput]] = [:]
    private var parsedByReceiptId: [String: ParsedReceiptDTO] = [:]

    func store(_ created: CreatedReceipt) {
        imagesByReceiptId[created.receiptId] = created.images
    }

    func store(_ parsed: ParsedReceiptDTO, for receiptId: String) {
        parsedByReceiptId[receiptId] = parsed
    }

    /// Needed only to resend on retry — no blob storage means the server kept no copy
    /// (PROJECT_SPEC.md §2 is superseded here).
    func images(for receiptId: String) -> [ReceiptImageInput] {
        imagesByReceiptId[receiptId] ?? []
    }

    func parsed(for receiptId: String) -> ParsedReceiptDTO? {
        parsedByReceiptId[receiptId]
    }
}
