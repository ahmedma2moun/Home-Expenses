import SwiftUI

/// One order's items within a category drilldown — merchant, the date it was saved, and each
/// item's name and line total. Shared by the Home tab's per-category expansion and the Analytics
/// tab's per-category, per-month expansion, both of which mirror `GET /orders/by-category`.
struct OrderGroupView: View {
    let group: CategoryOrderGroupDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(group.merchant)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                if let displayDate = group.displayDate {
                    Text(displayDate.formatted(date: .abbreviated, time: .omitted))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("Saved \(displayDate.formatted(date: .abbreviated, time: .omitted))")
                }
            }
            ForEach(group.items) { item in
                HStack {
                    Text(item.displayName)
                        .font(.footnote)
                    Spacer()
                    Text(item.lineTotal.value.formatted(currencyCode: group.currency))
                        .font(.footnote)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
