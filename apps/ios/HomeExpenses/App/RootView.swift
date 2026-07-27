import SwiftUI

/// Capture a receipt, let AI categorize it, confirm & save, then see the month's summary and
/// manage the orders behind it. Trends, AI comparison, and auth are still out of scope.
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
        }
    }
}

#Preview {
    RootView()
}
