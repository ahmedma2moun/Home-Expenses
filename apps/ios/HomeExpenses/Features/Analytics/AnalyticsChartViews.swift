import Charts
import SwiftUI

/// Donut chart of one month's category totals, with the month's grand total in the center.
struct CategoryPieChart: View {
    let slices: [CategorySlice]
    let total: Decimal

    var body: some View {
        Chart(slices) { slice in
            SectorMark(
                angle: .value("Amount", slice.plotValue),
                innerRadius: .ratio(0.62),
                angularInset: 1.5
            )
            .foregroundStyle(slice.color)
            .cornerRadius(3)
        }
        .overlay {
            VStack(spacing: 2) {
                Text("Total").font(.caption).foregroundStyle(.secondary)
                Text(total.formatted(currencyCode: "EGP")).font(.title3.bold())
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Spending by category")
        .accessibilityValue(accessibilitySummary)
    }

    private var accessibilitySummary: String {
        let categoryList = slices
            .map { "\($0.name): \($0.amount.formatted(currencyCode: "EGP"))" }
            .joined(separator: ", ")
        return "Total \(total.formatted(currencyCode: "EGP")). \(categoryList)"
    }
}

/// The pie's legend as a plain list — a colour swatch beside each category so identity never rests
/// on hue alone (the amount label already carries it in text).
struct CategoryLegend: View {
    let slices: [CategorySlice]

    var body: some View {
        VStack(spacing: 8) {
            ForEach(slices) { slice in
                HStack(spacing: 8) {
                    Circle().fill(slice.color).frame(width: 10, height: 10)
                    Text(slice.emoji)
                    Text(slice.name)
                    Spacer()
                    Text(slice.amount.formatted(currencyCode: "EGP"))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .font(.subheadline)
                .accessibilityElement(children: .combine)
            }
        }
    }
}

/// One line per category, month over month. Colour comes from `colorScale` so a category always
/// matches its slice in `CategoryPieChart` — the legend Swift Charts draws from the same scale
/// keeps identity readable without relying on colour alone.
struct CategoryTrendChart: View {
    let points: [CategoryTrendPoint]
    let months: [String]
    let colorScale: (domain: [String], range: [Color])

    var body: some View {
        Chart(points) { point in
            LineMark(
                x: .value("Month", point.month),
                y: .value("Amount", point.plotValue)
            )
            .foregroundStyle(by: .value("Category", point.categoryName))
            .symbol(by: .value("Category", point.categoryName))
            .interpolationMethod(.monotone)
            .lineStyle(StrokeStyle(lineWidth: 2))
        }
        .chartForegroundStyleScale(domain: colorScale.domain, range: colorScale.range)
        .chartXScale(domain: months)
        .chartXAxis {
            AxisMarks(values: .automatic) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let month = value.as(String.self) {
                        Text(MonthLabel.abbreviatedMonth(fromLabel: month))
                    }
                }
            }
        }
        .chartLegend(position: .bottom, alignment: .leading, spacing: 8)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Category spending trend, last \(months.count) months")
        .accessibilityValue(accessibilitySummary)
    }

    /// Swift Charts doesn't expose one accessibility node per line for a `foregroundStyle(by:)`
    /// series group, so the chart is described as a single element with the per-category window
    /// totals spoken out — mirrors how `CategoryPieChart` summarizes itself.
    private var accessibilitySummary: String {
        var totals: [String: Decimal] = [:]
        var order: [String] = []
        for point in points {
            if totals[point.categoryName] == nil { order.append(point.categoryName) }
            totals[point.categoryName, default: 0] += point.amount
        }
        return order
            .map { "\($0): \((totals[$0] ?? 0).formatted(currencyCode: "EGP"))" }
            .joined(separator: ", ")
    }
}
