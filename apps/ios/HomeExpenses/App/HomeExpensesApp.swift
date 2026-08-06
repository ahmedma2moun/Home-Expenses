import SwiftUI

@main
struct HomeExpensesApp: App {
    @StateObject private var router = AppRouter()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(router)
                .onOpenURL { url in
                    // The Quick Add widget's only deep link today (`QuickAddWidget.swift`).
                    if url.host == "capture" {
                        router.showingCaptureFlow = true
                    }
                }
        }
    }
}
