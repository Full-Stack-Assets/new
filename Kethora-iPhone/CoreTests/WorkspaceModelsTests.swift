import XCTest
@testable import KethoraCore
final class WorkspaceModelsTests: XCTestCase {
    func testServerSnapshotDecodesInNativeModels() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "bootstrap", withExtension: "json", subdirectory: "Fixtures"))
        let snapshot = try JSONDecoder().decode(Snapshot.self, from: Data(contentsOf: url))
        XCTAssertEqual(snapshot.settings.name, "Kethora")
        XCTAssertEqual(snapshot.tasks.first?.state, "partial")
        XCTAssertEqual(snapshot.tasks.first?.artifact_id, snapshot.artifacts.first?.id)
        XCTAssertEqual(snapshot.messages.last?.role, "assistant")
        XCTAssertEqual(snapshot.goals.first?.milestones?.count, 2)
        XCTAssertFalse(snapshot.settings.model_consent)
    }
    func testPendingCommandSurvivesEncodingWithoutChangingIdentity() throws {
        let pending = PendingSubmission(id: "immutable-command", text: "Create a brief", thread: "main-thread", mode: "local", sources: ["source-id"], apiRoot: "http://localhost:8787/v1/")
        XCTAssertEqual(try JSONDecoder().decode(PendingSubmission.self, from: JSONEncoder().encode(pending)), pending)
        XCTAssertNotEqual(pending, PendingSubmission(id: pending.id, text: pending.text, thread: pending.thread, mode: pending.mode, sources: pending.sources, apiRoot: "https://another.invalid/v1/"))
    }
    func testHistoricalVersionKeepsItsOwnHashAndStaleStatus() throws {
        let version = try JSONDecoder().decode(SavedVersion.self, from: Data(#"{"version":1,"content":"Old draft","stale":true,"hash":"historical-hash"}"#.utf8))
        XCTAssertEqual(version.version, 1)
        XCTAssertEqual(version.hash, "historical-hash")
        XCTAssertEqual(version.stale, true)
    }
}
