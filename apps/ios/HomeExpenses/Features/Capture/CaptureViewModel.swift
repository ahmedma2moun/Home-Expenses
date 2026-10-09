import Foundation
import PhotosUI
import SwiftUI
import UIKit

struct CreatedReceipt {
    let receiptId: String
    /// Kept so ParsingView can resend on retry — no blob storage means the server never retains
    /// the originals (PROJECT_SPEC.md §2 is superseded here).
    let images: [ReceiptImageInput]
}

/// Encodes captured images and creates the Receipt (BR-1/BR-2). Image downscale + JPEG encoding
/// happens here, never in the view.
@MainActor
final class CaptureViewModel: ObservableObject {
    struct CapturedImage: Identifiable {
        let id = UUID()
        let uiImage: UIImage
    }

    @Published var selectedItems: [PhotosPickerItem] = [] {
        didSet { Task { await loadSelection() } }
    }
    @Published private(set) var thumbnails: [CapturedImage] = []
    @Published private(set) var isAnalyzing = false
    @Published var errorMessage: String?
    /// Defaults to cloud even on an Apple Intelligence-capable device — on-device is an explicit
    /// opt-in on the Capture screen, not a silent default switch.
    @Published var extractionMode: ExtractionMode = .cloud

    private let client = APIClient.shared
    /// On-device generation can run for several seconds — if the user backs out of the
    /// Capture screen mid-analyze, `CaptureView` cancels this from `.onDisappear` rather than
    /// leaving an untracked `Task` running against a view model nothing still references.
    private var analyzeTask: Task<Void, Never>?

    var canAnalyze: Bool { !thumbnails.isEmpty && !isAnalyzing }

    /// Read by `CaptureView` to decide whether the on-device segment is enabled/dimmed. A computed
    /// property, not `@Published` state: `SystemLanguageModel.default.availability` is a cheap
    /// synchronous read and this way there's no stale cached value to invalidate.
    var onDeviceAvailability: OnDeviceAvailability { OnDeviceAvailability.current() }

    func remove(_ image: CapturedImage) {
        thumbnails.removeAll { $0.id == image.id }
    }

    func move(from source: IndexSet, to destination: Int) {
        thumbnails.move(fromOffsets: source, toOffset: destination)
    }

    /// Starts `analyze()` as a tracked, cancellable `Task` — the view's "Analyze" button uses this
    /// instead of wrapping the call in its own untracked `Task { }`.
    func startAnalyzing(onCreated: @escaping (CreatedReceipt) -> Void) {
        analyzeTask?.cancel()
        analyzeTask = Task { [weak self] in
            guard let self, let created = await self.analyze() else { return }
            onCreated(created)
        }
    }

    func cancelAnalyzing() {
        analyzeTask?.cancel()
    }

    private func loadSelection() async {
        var images: [CapturedImage] = []
        for item in selectedItems {
            if let data = try? await item.loadTransferable(type: Data.self),
                let uiImage = UIImage(data: data)
            {
                images.append(CapturedImage(uiImage: uiImage))
            }
        }
        thumbnails = images
    }

    /// Downscales every image, base64-encodes it into the request body, and creates the Receipt.
    /// When `extractionMode == .onDevice`, also runs `OnDeviceReceiptExtractor` first and attaches
    /// its result — the request already carries the final parse, so the server never calls the
    /// configured cloud provider for this receipt (AI_PROVIDER.md §10).
    func analyze() async -> CreatedReceipt? {
        guard canAnalyze else { return nil }
        isAnalyzing = true
        errorMessage = nil
        defer { isAnalyzing = false }

        do {
            var images: [ReceiptImageInput] = []
            for (index, thumbnail) in thumbnails.enumerated() {
                guard let data = ImagePreprocessor.process(thumbnail.uiImage) else {
                    throw CaptureError.encodingFailed
                }
                images.append(
                    ReceiptImageInput(
                        base64: data.base64EncodedString(),
                        position: index,
                        mimeType: "image/jpeg"
                    )
                )
            }

            var request = ReceiptCreateRequest(clientRef: UUID().uuidString, images: images)
            if extractionMode == .onDevice {
                try await attachOnDeviceParse(to: &request)
            }

            let receipt: ReceiptSummaryDTO = try await client.post("/api/v1/receipts", body: request)
            return CreatedReceipt(receiptId: receipt.id, images: images)
        } catch {
            // A cancelled analyze (user backed out mid-model-run, see `cancelAnalyzing()`) is
            // not a failure to report — `ParsingViewModel` and friends use this same check.
            guard !error.isTaskCancellation else { return nil }
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Something went wrong."
            return nil
        }
    }

    /// Runs `OnDeviceReceiptExtractor` and fills in the request's on-device fields. Split out of
    /// `analyze()` to keep that function under the repo's line-length convention, not because this
    /// is reused anywhere else.
    private func attachOnDeviceParse(to request: inout ReceiptCreateRequest) async throws {
        let categorySlugs = try await loadCategorySlugs()
        // Timer starts after the category fetch: this measures on-device generation only,
        // matching what `Receipt.latencyMs` means for the cloud path (the vision call's own
        // duration, not any network round-trip around it).
        let startedAt = Date()
        let parsed = try await OnDeviceReceiptExtractor.extract(
            images: thumbnails.map(\.uiImage),
            categorySlugs: categorySlugs
        )
        request.extractionMode = .onDevice
        request.clientParsedPayload = parsed
        request.clientModel = OnDeviceReceiptExtractor.modelIdentifier
        request.clientLatencyMs = Int(Date().timeIntervalSince(startedAt) * 1000)
    }

    private func loadCategorySlugs() async throws -> [String] {
        let categories: [CategoryDTO] = try await client.get("/api/v1/categories")
        return categories.map(\.id)
    }
}

enum CaptureError: LocalizedError {
    case encodingFailed

    var errorDescription: String? {
        switch self {
        case .encodingFailed: return "Couldn't process one of the images."
        }
    }
}
