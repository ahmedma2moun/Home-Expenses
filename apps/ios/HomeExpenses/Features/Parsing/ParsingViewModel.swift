import Foundation

/// Polls receipt status every 2s, max 60s (PROJECT_SPEC.md §9). Never holds a request open —
/// extraction runs server-side in the background.
@MainActor
final class ParsingViewModel: ObservableObject {
    enum State: Equatable {
        case polling
        case failed(message: String)
        case timedOut
        /// The receipt reached a status polling can't do anything useful with (already confirmed
        /// or discarded, e.g. by another client) — distinct from `.failed` because "Retry" would
        /// just reparse a receipt that isn't in a reparseable state.
        case unavailable(message: String)
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
        pollTask = Task { [weak self] in
            guard let self else { return }
            await self.poll()
        }
    }

    func retry() async {
        state = .polling
        do {
            let request = ReparseRequest(images: images)
            let _: ReceiptSummaryDTO = try await client.post(
                "/api/v1/receipts/\(receiptId)/reparse",
                body: request
            )
        } catch {
            guard !error.isTaskCancellation else { return }
            state = .failed(
                message: (error as? LocalizedError)?.errorDescription ?? "Couldn't retry — check your connection."
            )
            return
        }
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            guard let self else { return }
            await self.poll()
        }
    }

    func cancel() {
        pollTask?.cancel()
    }

    private func poll() async {
        let deadline = Date().addingTimeInterval(60)
        // Tracks whether the *last* attempt before the deadline was a network failure, so a run of
        // nothing but dropped connections is reported as that, not as "taking longer than expected"
        // — the two need different next steps from the user (check your connection vs. just wait).
        var lastNetworkError: Error?

        while !Task.isCancelled {
            do {
                let detail: ReceiptDetailDTO = try await client.get("/api/v1/receipts/\(receiptId)")
                lastNetworkError = nil
                switch detail.status {
                case .parsed:
                    onParsed?(detail)
                    return
                case .failed:
                    state = .failed(message: detail.parseError ?? "Couldn't read this receipt.")
                    return
                case .confirmed:
                    state = .unavailable(message: "This receipt has already been confirmed.")
                    return
                case .discarded:
                    state = .unavailable(message: "This receipt was discarded.")
                    return
                case .parsing, .uploaded:
                    break
                }
            } catch {
                guard !error.isTaskCancellation else { return }
                lastNetworkError = error
            }

            if Date() >= deadline {
                if let lastNetworkError {
                    state = .failed(
                        message: (lastNetworkError as? LocalizedError)?.errorDescription
                            ?? "Couldn't reach the server — check your connection and retry."
                    )
                } else {
                    state = .timedOut
                }
                return
            }
            try? await Task.sleep(for: .seconds(2))
        }
    }
}
