import SwiftUI

/// Month-segmented order list (PROJECT_SPEC.md §10, screen 5). Business logic belongs in
/// OrdersViewModel, not here — this view only renders state.
struct OrdersView: View {
    var body: some View {
        ContentUnavailableView(
            "Orders",
            systemImage: "list.bullet.rectangle",
            description: Text("Ships in M3.")
        )
    }
}

#Preview {
    OrdersView()
}
