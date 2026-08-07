import SwiftUI

/// Capture a receipt, let AI categorize it, confirm & save, then see the month's summary, manage
/// the orders behind it, review category spending and trends, and generate AI narratives about
/// spending changes. Auth is still out of scope.
struct RootView: View {
    var body: some View {
        TabView {
            SummaryView()
                .tabItem {
                    Label("Home", systemImage: "house")
                }
            OrdersView()
                .tabItem {
                    Label("Orders", systemImage: "list.bullet.rectangle")
                }
            AnalyticsView()
                .tabItem {
                    Label("Analytics", systemImage: "chart.pie")
                }
            InsightsView()
                .tabItem {
                    Label("Insights", systemImage: "sparkles")
                }
        }
    }
}

#Preview {
    RootView()
        .environmentObject(AppRouter())
}
