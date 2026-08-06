import WidgetKit
import SwiftUI

@main
struct HomeExpensesWidgetBundle: WidgetBundle {
    var body: some Widget {
        SpendWidget()
        QuickAddWidget()
    }
}
