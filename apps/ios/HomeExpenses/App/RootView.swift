import SwiftUI

/// Trimmed to the core flow: capture a receipt, let AI categorize it, confirm & save, and see the
/// month's category summary. Orders list/edit, trends, AI comparison, and auth are out of scope.
struct RootView: View {
    var body: some View {
        SummaryView()
    }
}

#Preview {
    RootView()
}
