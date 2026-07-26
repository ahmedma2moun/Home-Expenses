import Foundation

/// Polls receipt status every 2s, max 60s (PROJECT_SPEC.md §9). Never holds a request open —
/// extraction runs server-side in the background.
@MainActor
final class ParsingViewModel: ObservableObject {
    enum State: Equatable {
        case polling
        case failed(message: String)
        case timedOut
    }

    @Published private(set) var state: State = .polling

    private let client = APIClient.shared
    private let receiptId: String
    /// No blob storage — a retry must resend the original images (PROJECT_SPEC.md §2 superseded).
    private let images: [ReceiptImageInput]
    private var onParsed: ((ReceiptDetailDTO) -> Void)?
    private var pollTask: Task<Void, Never>?

    init(receiptId: String, images: [ReceiptImageInput]) {
        self.receiptId = receiptId
        self.images = images
    }

    func start(onParsed: @escaping (ReceiptDetailDTO) -> Void) {
        self.onParsed = onParsed
        state = .polling
        pollTask?.cancel()
        pollTask = Task { await poll() }
    }

    func retry() async {
        state = .polling
        let request = ReparseRequest(images: images)
        let _: ReceiptSummaryDTO? = try? await client.post(
            "/api/v1/receipts/\(receiptId)/reparse",
            body: request
        )
        pollTask?.cancel()
        pollTask = Task { await poll() }
    }

    func cancel() {
        pollTask?.cancel()
    }

    private func poll() async {
        let deadline = Date().addingTimeInterval(60)

        while !Task.isCancelled {
            if let detail = try? await client.get("/api/v1/receipts/\(receiptId)") as ReceiptDetailDTO {
                switch detail.status {
                case .parsed:
                    onParsed?(detail)
                    return
                case .failed:
                    state = .failed(message: detail.parseError ?? "Couldn't read this receipt.")
                    return
                case .confirmed, .discarded:
                    return
                case .parsing, .uploaded:
                    break
                }
            }

            if Date() >= deadline {
                state = .timedOut
                return
            }
            try? await Task.sleep(for: .seconds(2))
        }
    }
}
