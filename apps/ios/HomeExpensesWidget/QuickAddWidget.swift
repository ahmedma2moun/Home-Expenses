import WidgetKit
import SwiftUI

/// No network involved, so a single static entry with `.never` as the refresh policy is enough —
/// there's nothing about "add a receipt" that changes over time.
struct QuickAddEntry: TimelineEntry {
    let date: Date
}

struct QuickAddProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuickAddEntry {
        QuickAddEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (QuickAddEntry) -> Void) {
        completion(QuickAddEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QuickAddEntry>) -> Void) {
        completion(Timeline(entries: [QuickAddEntry(date: Date())], policy: .never))
    }
}

/// A one-tap deep link into Capture, not a true in-place interactive widget — receipt capture needs
/// the camera/photo picker, which can't run inside the widget's process. `.widgetURL` (iOS 14+, no
/// App Intents needed) opens the app via `homeexpenses://capture`, handled by
/// `HomeExpensesApp.onOpenURL` (see `Core/AppRouter.swift`).
struct QuickAddView: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "plus.circle.fill")
                .font(.system(size: 32))
                .foregroundStyle(.tint)
            Text("Add receipt")
                .font(.caption.bold())
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .containerBackground(for: .widget) { Color(.systemBackground) }
        .widgetURL(URL(string: "homeexpenses://capture"))
    }
}

struct QuickAddWidget: Widget {
    let kind = "QuickAddWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: QuickAddProvider()) { _ in
            QuickAddView()
        }
        .configurationDisplayName("Add Receipt")
        .description("One tap straight into Capture.")
        .supportedFamilies([.systemSmall])
    }
}

#Preview("Quick Add", as: .systemSmall) {
    QuickAddWidget()
} timeline: {
    QuickAddEntry(date: Date())
}
