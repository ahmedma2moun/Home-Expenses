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

    private let client = APIClient.shared

    var canAnalyze: Bool { !thumbnails.isEmpty && !isAnalyzing }

    func remove(_ image: CapturedImage) {
        thumbnails.removeAll { $0.id == image.id }
    }

    func move(from source: IndexSet, to destination: Int) {
        thumbnails.move(fromOffsets: source, toOffset: destination)
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

            let request = ReceiptCreateRequest(clientRef: UUID().uuidString, images: images)
            let receipt: ReceiptSummaryDTO = try await client.post("/api/v1/receipts", body: request)
            return CreatedReceipt(receiptId: receipt.id, images: images)
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Something went wrong."
            return nil
        }
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
