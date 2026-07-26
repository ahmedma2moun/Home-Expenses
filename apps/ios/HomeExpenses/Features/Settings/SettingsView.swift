import SwiftUI

/// Account, default currency, default month behaviour, sign out, delete account
/// (PROJECT_SPEC.md §10, screen 7).
struct SettingsView: View {
    var body: some View {
        ContentUnavailableView(
            "Settings",
            systemImage: "gearshape",
            description: Text("Ships alongside Sign in with Apple (M1).")
        )
    }
}

#Preview {
    SettingsView()
}
