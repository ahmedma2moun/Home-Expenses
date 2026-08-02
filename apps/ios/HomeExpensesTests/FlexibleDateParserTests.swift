import XCTest
@testable import HomeExpenses

final class FlexibleDateParserTests: XCTestCase {
    func testParsesAStrictISO8601StringWithOffset() {
        XCTAssertNotNil(FlexibleDateParser.parse("2026-07-14T18:32:00+02:00"))
    }

    // PROJECT_SPEC.md §7.2's own example ("2026-07-14T18:32:00") has no offset — the extraction
    // model doesn't always return one.
    func testParsesAnOffsetLessTimestamp() {
        XCTAssertNotNil(FlexibleDateParser.parse("2026-07-14T18:32:00"))
    }

    func testReturnsNilForGarbage() {
        XCTAssertNil(FlexibleDateParser.parse("not a date"))
    }
}
