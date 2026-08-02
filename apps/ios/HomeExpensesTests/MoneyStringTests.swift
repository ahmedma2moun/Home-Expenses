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
}
