import XCTest
@testable import HomeExpenses

/// Pins `ClearableMoney`'s three-way encoding against `OrderUpdateRequestSchema`/
/// `BudgetUpdateRequestSchema` on the wire: omit the key (leave untouched), `null` (clear), or a
/// value (set) — a plain `String?` can only tell "send" from "omit," never "send `null`," so a
/// regression back to that shape would silently stop every "turn this override off" toggle from
/// clearing anything server-side while still compiling and passing every other test.
final class ClearableMoneyTests: XCTestCase {
    private struct Wrapper: Encodable {
        var amount: ClearableMoney?
    }

    private func encodedJSON(_ wrapper: Wrapper) throws -> String {
        let data = try JSONEncoder().encode(wrapper)
        return try XCTUnwrap(String(data: data, encoding: .utf8))
    }

    func testNilOmitsTheKeyEntirely() throws {
        let json = try encodedJSON(Wrapper(amount: nil))
        XCTAssertFalse(json.contains("amount"), "expected no \"amount\" key in \(json)")
    }

    func testClearedEncodesAsExplicitNull() throws {
        let json = try encodedJSON(Wrapper(amount: .cleared))
        XCTAssertTrue(json.contains(#""amount":null"#), "expected \"amount\":null in \(json)")
    }

    func testValueEncodesTheWireString() throws {
        let json = try encodedJSON(Wrapper(amount: .value("45.00")))
        XCTAssertTrue(json.contains(#""amount":"45.00""#), "expected \"amount\":\"45.00\" in \(json)")
    }

    // `WeekBudgetInput.amount` is a bare `ClearableMoney` (not wrapped in `Optional`) — the key must
    // always be present, since `BudgetUpdateRequestSchema` requires it on every entry in `weeks`.
    func testNonOptionalUsageAlwaysEncodesTheKey() throws {
        struct WeekInput: Encodable {
            let week: Int
            let amount: ClearableMoney
        }
        let data = try JSONEncoder().encode(WeekInput(week: 3, amount: .cleared))
        let json = try XCTUnwrap(String(data: data, encoding: .utf8))
        XCTAssertTrue(json.contains(#""amount":null"#), "expected \"amount\":null in \(json)")
    }
}
