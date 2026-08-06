import Foundation

/// Shared navigation state reachable from outside the view that owns it — today that's just the
/// Quick Add widget's `homeexpenses://capture` deep link (see `HomeExpensesApp.onOpenURL` and
/// `HomeExpensesWidget/QuickAddWidget.swift`), driving the same sheet `SummaryView`'s own "+"
/// toolbar button already presents.
@MainActor
final class AppRouter: ObservableObject {
    @Published var showingCaptureFlow = false
}
