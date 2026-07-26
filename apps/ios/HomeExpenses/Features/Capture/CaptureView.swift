import SwiftUI

/// Camera / VisionKit scanner / photo picker, with reorderable thumbnails
/// (PROJECT_SPEC.md §10, screen 2). Image downscale + JPEG encode happens off the main actor
/// in CaptureViewModel, never here.
struct CaptureView: View {
    var body: some View {
        ContentUnavailableView(
            "Add a receipt",
            systemImage: "camera",
            description: Text("Ships in M1.")
        )
    }
}

#Preview {
    CaptureView()
}
