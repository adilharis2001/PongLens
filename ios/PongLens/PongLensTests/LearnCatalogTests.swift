import XCTest
@testable import PongLens

final class LearnCatalogTests: XCTestCase {
    private func loadStore() throws -> LearnCatalogStore {
        let resourceURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("PongLens/Resources/learn-catalog.json")
        return try LearnCatalogStore(data: Data(contentsOf: resourceURL))
    }

    func testCatalogContainsEveryIOSChapterForEachAudience() throws {
        let store = try loadStore()

        XCTAssertEqual(store.chapters(for: .player).count, 9)
        XCTAssertEqual(store.chapters(for: .coach).count, 8)
    }

    func testCoachSearchExcludesPaidReviews() throws {
        let store = try loadStore()

        XCTAssertTrue(store.search("paid review", audience: .coach).isEmpty)
    }

    func testChapterNumbersAreDerivedFromVisibleSourceOrder() throws {
        let store = try loadStore()

        XCTAssertEqual(
            store.numberedChapters(for: .coach).map(\.number),
            Array(1...8)
        )
    }

    func testRelatedGuidesRemainInsideTheSelectedAudience() throws {
        let store = try loadStore()
        let guide = try XCTUnwrap(
            store.guides(for: .coach).first { $0.slug == "review-student-match" }
        )

        let related = store.related(for: guide, audience: .coach)

        XCTAssertFalse(related.isEmpty)
        XCTAssertTrue(related.allSatisfy { $0.audience == .coach })
    }

    func testSearchIncludesSectionTipsAndBullets() throws {
        let store = try loadStore()

        XCTAssertEqual(
            store.search("processing choices lock", audience: .player).map(\.slug),
            ["upload-a-video"]
        )
        XCTAssertEqual(
            store.search("connected duplicate", audience: .coach).map(\.slug),
            ["add-connect-student"]
        )
    }
}
