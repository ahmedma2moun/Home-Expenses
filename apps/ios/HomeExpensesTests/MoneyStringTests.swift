import XCTest
@testable import HomeExpenses

final class MoneyStringTests: XCTestCase {
    private struct Wrapper: Codable {
        let amount: MoneyString
    }

    func testDecodesAWireString() throws {
        let json = Data(#"{"amount":"45.00"}"#.utf8)
        let wrapper = try JSONDecoder().decode(Wrapper.self, from: json)
        XCTAssertEqual(wrapper.amount.value, Decimal(string: "45.00"))
    }

    func testRejectsAJSONNumber() {
        let json = Data(#"{"amount":45.00}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(Wrapper.self, from: json))
    }

    // Plain string interpolation on a whole-number Decimal produced "45", not "45.00" — the API's
    // moneySchema rejects anything without exactly two decimal places.
    func testEncodesAWholeNumberWithTwoDecimalPlaces() throws {
        let wrapper = try JSONDecoder().decode(Wrapper.self, from: Data(#"{"amount":"45"}"#.utf8))
        let data = try JSONEncoder().encode(wrapper)
        let json = try XCTUnwrap(String(data: data, encoding: .utf8))
        XCTAssertTrue(json.contains(#""45.00""#), "expected \"45.00\" in \(json)")
    }

    func testRoundTripsThroughDecodeAndEncode() throws {
        let wrapper = try JSONDecoder().decode(Wrapper.self, from: Data(#"{"amount":"1234.50"}"#.utf8))
        let reencoded = try JSONEncoder().encode(wrapper)
        let reencodedString = try XCTUnwrap(String(data: reencoded, encoding: .utf8))
        XCTAssertTrue(reencodedString.contains(#""1234.50""#))
    }

    // `Decimal(string:)` alone reads as much of a number as it can and silently ignores the rest —
    // these all parsed as *something* (a wrong, truncated something) before `wireMoneyPattern` was
    // added. `wireString(_:)` is the entry point the on-device extraction pipeline uses for
    // client-produced money, so this is the regression the review that added the pattern was about.
    func testWireStringRejectsGarbageInsteadOfSilentlyTruncating() {
        for garbage in ["1,234.56", "45,50", "12abc", "1.2.3", "1e3", "", "-"] {
            XCTAssertNil(MoneyString(wireString: garbage), "expected nil for \"\(garbage)\"")
        }
    }

    func testWireStringAcceptsAWholeNumber() {
        XCTAssertEqual(MoneyString(wireString: "45")?.value, Decimal(string: "45"))
    }

    func testWireStringAcceptsTwoDecimalPlaces() {
        XCTAssertEqual(MoneyString(wireString: "45.50")?.value, Decimal(string: "45.50"))
    }
}
