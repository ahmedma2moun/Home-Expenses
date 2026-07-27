import SwiftUI

/// Coordinates Capture → Parsing → Review as one modal flow (PROJECT_SPEC.md §10, screens 2–4).
struct ReceiptFlowView: View {
    private enum Step: Hashable {
        case parsing(String)
        case review(String)
    }

    @Environment(\.dismiss) private var dismiss
    @StateObject private var flow = ReceiptFlowViewModel()
    @State private var path: [Step] = []
    var onSaved: () -> Void

    var body: some View {
        NavigationStack(path: $path) {
            CaptureView(onReceiptCreated: { created in
                flow.store(created)
                path.append(.parsing(created.receiptId))
            })
            .navigationDestination(for: Step.self) { step in
                destination(for: step)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    @ViewBuilder
    private func destination(for step: Step) -> some View {
        switch step {
        case .parsing(let receiptId):
            ParsingView(receiptId: receiptId, images: flow.images(for: receiptId)) { detail in
                guard let parsed = detail.parsedPayload else { return }
                flow.store(parsed, for: receiptId)
                path.append(.review(receiptId))
            }
        case .review(let receiptId):
            if let parsed = flow.parsed(for: receiptId) {
                ReviewView(receiptId: receiptId, parsed: parsed) {
                    onSaved()
                    dismiss()
                }
            } else {
                // Unreachable — the payload is stored before this step is pushed. Kept visible
                // rather than falling through to a blank pushed screen, which is exactly how the
                // stale-`@State` version of this failed.
                ContentUnavailableView {
                    Label("Couldn't open the review", systemImage: "exclamationmark.triangle")
                } description: {
                    Text("The parsed receipt was no longer available.")
                } actions: {
                    Button("Start over") { path.removeAll() }
                }
            }
        }
    }
}
