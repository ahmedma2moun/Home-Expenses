import XCTest
@testable import HomeExpenses

final class AnalyticsComparisonDataTests: XCTestCase {
    private func summary(_ categories: [(String, String, String, String)]) -> MonthSummaryDTO {
        let decoded = categories.map { id, name, emoji, amount in
            """
            {"categoryId":"\(id)","name":"\(name)","emoji":"\(emoji)","totalAmount":"\(amount)","itemCount":1,"orderCount":1}
            """
        }.joined(separator: ",")
        let json = """
        {"month":"2026-07","currency":"EGP","totalAmount":"0.00","orderCount":0,"itemCount":0,"categories":[\(decoded)]}
        """
        return try! JSONDecoder().decode(MonthSummaryDTO.self, from: Data(json.utf8))
    }

    func testMatchesCategoriesPresentInEitherMonth() {
        let current = summary([("produce", "Produce", "🥦", "20.00")])
        let previous = summary([("dairy_eggs", "Dairy & Eggs", "🥛", "10.00")])

        let rows = AnalyticsComparisonData.comparisonRows(current: current, previous: previous)

        XCTAssertEqual(Set(rows.map(\.id)), ["produce", "dairy_eggs"])
    }

    // A category dropped to zero this month should still show up (as a drop to zero), not vanish —
    // surfacing that drop is the entire point of a month-over-month comparison.
    func testACategoryAbsentThisMonthShowsAsZero() {
        let current = summary([])
        let previous = summary([("produce", "Produce", "🥦", "20.00")])

        let rows = AnalyticsComparisonData.comparisonRows(current: current, previous: previous)

        XCTAssertEqual(rows.first?.currentAmount, 0)
        XCTAssertEqual(rows.first?.previousAmount, 20)
    }

    func testChangeRatioIsNilWithNoPreviousBaseline() {
        let row = CategoryComparisonRow(id: "produce", name: "Produce", emoji: "🥦", previousAmount: 0, currentAmount: 20)
        XCTAssertNil(row.changeRatio)
    }

    func testChangeRatioReflectsAnIncrease() {
        let row = CategoryComparisonRow(id: "produce", name: "Produce", emoji: "🥦", previousAmount: 10, currentAmount: 15)
        XCTAssertEqual(row.changeRatio, 0.5)
    }
}
