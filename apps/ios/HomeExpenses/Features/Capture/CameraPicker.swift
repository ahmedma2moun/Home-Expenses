import SwiftUI
import UIKit

/// The system camera, for photographing a receipt directly from the Capture screen. One shot per
/// presentation; `CaptureView` re-presents it for each additional page of a long receipt.
struct CameraPicker: UIViewControllerRepresentable {
    var onCapture: @MainActor (UIImage) -> Void
    /// Called after a shot or a cancel; the presenter flips its own `isPresented` flag. A closure,
    /// not `@Environment(\.dismiss)`: the coordinator outlives the struct copy it was made from,
    /// and environment values read from a stale copy aren't guaranteed to resolve.
    var onFinish: @MainActor () -> Void

    /// False on the simulator and on devices with a restricted/missing camera — `CaptureView`
    /// hides the button rather than presenting a picker that would fail.
    static var isAvailable: Bool {
        UIImagePickerController.isSourceTypeAvailable(.camera)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onCapture: onCapture, onFinish: onFinish)
    }

    @MainActor
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let onCapture: @MainActor (UIImage) -> Void
        private let onFinish: @MainActor () -> Void

        init(
            onCapture: @escaping @MainActor (UIImage) -> Void,
            onFinish: @escaping @MainActor () -> Void
        ) {
            self.onCapture = onCapture
            self.onFinish = onFinish
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let image = info[.originalImage] as? UIImage {
                onCapture(image)
            }
            onFinish()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onFinish()
        }
    }
}
