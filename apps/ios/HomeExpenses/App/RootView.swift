import SwiftUI

/// Top-level tab shell. Home (current month total, category donut, recent orders, "Add receipt"
/// FAB — PROJECT_SPEC.md §10 screen 1) lands with Orders in M3; Capture/Review are pushed from
/// there, not tabbed.
struct RootView: View {
    var body: some View {
        TabView {
            OrdersView()
                .tabItem { Label("Orders", systemImage: "list.bullet.rectangle") }

            AnalyticsView()
                .tabItem { Label("Analytics", systemImage: "chart.bar.xaxis") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}

#Preview {
    RootView()
}
