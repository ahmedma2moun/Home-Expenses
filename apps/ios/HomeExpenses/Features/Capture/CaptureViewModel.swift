import Foundation
import PhotosUI
import SwiftUI
import UIKit

/// Uploads captured images and creates the Receipt (BR-1/BR-2). Image downscale + JPEG encoding
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

    /// Downscales + uploads every image, then creates the Receipt. Returns its id on success.
    func analyze() async -> String? {
        guard canAnalyze else { return nil }
        isAnalyzing = true
        errorMessage = nil
        defer { isAnalyzing = false }

        do {
            var processedImages: [Data] = []
            for thumbnail in thumbnails {
                guard let data = ImagePreprocessor.process(thumbnail.uiImage) else {
                    throw CaptureError.encodingFailed
                }
                processedImages.append(data)
            }

            let uploadRequest = UploadTokenRequest(
                files: processedImages.map { UploadFileRequest(mimeType: "image/jpeg", bytes: $0.count) }
            )
            let tokenResponse: UploadTokenResponse = try await client.post(
                "/api/v1/uploads/token",
                body: uploadRequest
            )
            guard tokenResponse.targets.count == processedImages.count else {
                throw CaptureError.uploadMismatch
            }

            for (index, target) in tokenResponse.targets.enumerated() {
                guard let url = URL(string: target.uploadUrl) else {
                    throw CaptureError.invalidUploadURL
                }
                try await client.uploadFile(to: url, data: processedImages[index], contentType: "image/jpeg")
            }

            let images = tokenResponse.targets.enumerated().map { index, target in
                ReceiptImageInput(blobKey: target.blobKey, position: index, mimeType: "image/jpeg")
            }
            let request = ReceiptCreateRequest(clientRef: UUID().uuidString, images: images)
            let receipt: ReceiptSummaryDTO = try await client.post("/api/v1/receipts", body: request)
            return receipt.id
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Something went wrong."
            return nil
        }
    }
}

enum CaptureError: LocalizedError {
    case encodingFailed
    case uploadMismatch
    case invalidUploadURL

    var errorDescription: String? {
        switch self {
        case .encodingFailed: return "Couldn't process one of the images."
        case .uploadMismatch: return "Upload targets didn't match the number of images."
        case .invalidUploadURL: return "Received an invalid upload URL."
        }
    }
}
