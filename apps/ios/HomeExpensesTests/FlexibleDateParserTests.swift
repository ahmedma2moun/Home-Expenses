import XCTest
@testable import HomeExpenses

final class FlexibleDateParserTests: XCTestCase {
    func testParsesAStrictISO8601StringWithOffset() {
        XCTAssertNotNil(FlexibleDateParser.parse("2026-07-14T18:32:00+02:00"))
    }

    // The shape every caller actually feeds this: `Date.toISOString()` off the backend, which is
    // always UTC ("Z") with fractional seconds.
    func testParsesAFractionalSecondsUTCTimestamp() {
        XCTAssertNotNil(FlexibleDateParser.parse("2026-07-14T18:32:00.412Z"))
    }

    func testReturnsNilForGarbage() {
        XCTAssertNil(FlexibleDateParser.parse("not a date"))
    }
}
