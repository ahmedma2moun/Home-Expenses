import SwiftUI

/// Coordinates Capture → Parsing → Review as one modal flow (PROJECT_SPEC.md §10, screens 2–4).
struct ReceiptFlowView: View {
    private enum Step: Hashable {
        case parsing(String)
        case review(String)
    }

    @Environment(\.dismiss) private var dismiss
    @State private var path: [Step] = []
    @State private var parsedByReceiptId: [String: ParsedReceiptDTO] = [:]
    @State private var imagesByReceiptId: [String: [ReceiptImageInput]] = [:]
    var onSaved: () -> Void

    var body: some View {
        NavigationStack(path: $path) {
            CaptureView(onReceiptCreated: { created in
                imagesByReceiptId[created.receiptId] = created.images
                path.append(.parsing(created.receiptId))
            })
            .navigationDestination(for: Step.self) { step in
                switch step {
                case .parsing(let receiptId):
                    ParsingView(receiptId: receiptId, images: imagesByReceiptId[receiptId] ?? []) { detail in
                        guard let parsed = detail.parsedPayload else { return }
                        parsedByReceiptId[receiptId] = parsed
                        path.append(.review(receiptId))
                    }
                case .review(let receiptId):
                    if let parsed = parsedByReceiptId[receiptId] {
                        ReviewView(receiptId: receiptId, parsed: parsed) {
                            onSaved()
                            dismiss()
                        }
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
