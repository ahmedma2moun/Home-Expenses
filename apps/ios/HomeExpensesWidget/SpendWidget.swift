import WidgetKit
import SwiftUI

struct SpendWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SpendWidgetEntry

    var body: some View {
        content
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .containerBackground(for: .widget) { Color(.systemBackground) }
    }

    @ViewBuilder
    private var content: some View {
        switch family {
        case .systemMedium:
            HStack(alignment: .top, spacing: 16) {
                totalsColumn
                Divider()
                categoriesColumn
            }
        default:
            totalsColumn
        }
    }

    private var totalsColumn: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(entry.monthLabel)
                .font(.caption)
                .foregroundStyle(.secondary)

            Text(entry.totalAmount?.formatted(currencyCode: entry.currency) ?? "—")
                .font(.title2.bold())
                .minimumScaleFactor(0.7)
                .lineLimit(1)

            if let changeRatio = entry.changeRatio {
                trendLabel(changeRatio)
            }

            Spacer(minLength: 4)

            if entry.priceWatchCount > 0 {
                Label("\(entry.priceWatchCount) up in price", systemImage: "arrow.up.circle.fill")
                    .font(.caption2.bold())
                    .foregroundStyle(.orange)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            } else if let errorMessage = entry.errorMessage {
                Text(errorMessage)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var categoriesColumn: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Top categories")
                .font(.caption)
                .foregroundStyle(.secondary)
            ForEach(entry.topCategories) { category in
                HStack(spacing: 4) {
                    Text(category.emoji)
                    Text(category.name)
                        .font(.caption)
                        .lineLimit(1)
                    Spacer()
                    Text(category.totalAmount.value.formatted(currencyCode: entry.currency))
                        .font(.caption)
                        .monospacedDigit()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Spending going up is drawn as a regression (red), going down as an improvement (green) — the
    /// same convention `AnalyticsView.changeBadge` uses, since this is an expense tracker.
    private func trendLabel(_ ratio: Double) -> some View {
        let isIncrease = ratio >= 0
        return Label(
            abs(ratio).formatted(.percent.precision(.fractionLength(1))),
            systemImage: isIncrease ? "arrow.up" : "arrow.down"
        )
        .font(.caption2.bold())
        .foregroundStyle(isIncrease ? .red : .green)
    }
}

struct SpendWidget: Widget {
    let kind = "SpendWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SpendWidgetProvider()) { entry in
            SpendWidgetView(entry: entry)
        }
        .configurationDisplayName("Spend")
        .description("This month's total, its trend, and anything flagged by Price Watch.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

#Preview("Small", as: .systemSmall) {
    SpendWidget()
} timeline: {
    SpendWidgetEntry.placeholder
}

#Preview("Medium", as: .systemMedium) {
    SpendWidget()
} timeline: {
    SpendWidgetEntry.placeholder
}
