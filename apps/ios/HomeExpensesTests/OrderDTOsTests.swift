import XCTest
@testable import HomeExpenses

final class OrderDTOsTests: XCTestCase {
    private func decode(actualPaid: String?) throws -> OrderSummaryDTO {
        let actualPaidJSON = actualPaid.map { #""\#($0)""# } ?? "null"
        let json = """
        {"id":"order-1","merchant":"Carrefour","periodMonth":"2026-07","periodWeek":1,
         "currency":"EGP","total":"650.00","actualPaid":\(actualPaidJSON),"itemCount":3,
         "source":"receipt","createdAt":"2026-07-14T19:02:11.412Z"}
        """
        return try JSONDecoder().decode(OrderSummaryDTO.self, from: Data(json.utf8))
    }

    // `displayTotal` is what every screen shows in place of `total` — a regression here would
    // silently show the wrong figure everywhere an order's total appears, not just crash loudly.
    func testDisplayTotalFallsBackToTotalWhenActualPaidIsAbsent() throws {
        let order = try decode(actualPaid: nil)
        XCTAssertEqual(order.displayTotal, Decimal(string: "650.00"))
    }

    func testDisplayTotalPrefersActualPaidWhenPresent() throws {
        let order = try decode(actualPaid: "700.00")
        XCTAssertEqual(order.displayTotal, Decimal(string: "700.00"))
        // `total` itself is never overwritten — the receipt figure stays available.
        XCTAssertEqual(order.total.value, Decimal(string: "650.00"))
    }
}
