import SwiftUI

/// The core review & confirm screen: editable merchant/date/month, per-item category/qty/price,
/// mismatch banner, Confirm & Save footer (PROJECT_SPEC.md §10, screen 4). All parsing and
/// recompute logic belongs in ReviewViewModel, never in this view.
struct ReviewView: View {
    var body: some View {
        ContentUnavailableView(
            "Review receipt",
            systemImage: "checklist",
            description: Text("Ships in M2.")
        )
    }
}

#Preview {
    ReviewView()
}
