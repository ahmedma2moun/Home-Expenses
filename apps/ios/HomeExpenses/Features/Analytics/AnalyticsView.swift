import SwiftUI

/// Month totals, category bars, trend chart, and the "Compare months" sheet (PROJECT_SPEC.md §10,
/// screen 6). Aggregation math belongs in AnalyticsViewModel, not here.
struct AnalyticsView: View {
    var body: some View {
        ContentUnavailableView(
            "Analytics",
            systemImage: "chart.bar.xaxis",
            description: Text("Ships in M4.")
        )
    }
}

#Preview {
    AnalyticsView()
}
