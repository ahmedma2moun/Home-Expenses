import SwiftUI

/// Progress state while the backend extracts the receipt; handles failure with retry
/// (PROJECT_SPEC.md §10, screen 3).
struct ParsingView: View {
    @StateObject private var viewModel: ParsingViewModel
    var onParsed: (ReceiptDetailDTO) -> Void

    init(receiptId: String, images: [ReceiptImageInput], onParsed: @escaping (ReceiptDetailDTO) -> Void) {
        _viewModel = StateObject(wrappedValue: ParsingViewModel(receiptId: receiptId, images: images))
        self.onParsed = onParsed
    }

    var body: some View {
        VStack(spacing: 16) {
            switch viewModel.state {
            case .polling:
                ProgressView("Reading your receipt…")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Couldn't read this receipt", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Retry") {
                        Task { await viewModel.retry() }
                    }
                    .buttonStyle(.borderedProminent)
                }
            case .timedOut:
                ContentUnavailableView {
                    Label("Taking longer than expected", systemImage: "clock")
                } description: {
                    Text("The receipt is still processing.")
                } actions: {
                    Button("Retry") {
                        Task { await viewModel.retry() }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        }
        .navigationTitle("Parsing")
        .navigationBarBackButtonHidden(true)
        .task {
            viewModel.start(onParsed: onParsed)
        }
        .onDisappear {
            viewModel.cancel()
        }
    }
}

#Preview {
    NavigationStack {
        ParsingView(receiptId: "preview", images: [], onParsed: { _ in })
    }
}
