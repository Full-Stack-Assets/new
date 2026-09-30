import Foundation

struct Milestone: Decodable, Identifiable { let id: String; let title: String; let done: Bool }
struct SavedVersion: Decodable { let version: Int?; let revision: Int?; let content: String; let stale: Bool?; let hash: String? }
struct WaitState: Decodable { let reason: String; let responsible_party: String; let resume_condition: String; let since: String }
struct SavedItem: Decodable, Identifiable {
    let id: String
    let revision: Int
    let title: String?
    let created_at: String
    let updated_at: String
    let kind: String?
    let content: String?
    let role: String?
    let thread_id: String?
    let task_id: String?
    let artifact_id: String?
    let state: String?
    let status: String?
    let mode: String?
    let description: String?
    let category: String?
    let summary: String?
    let reaction: String?
    let version: Int?
    let turns_used: Int?
    let hash: String?
    let milestones: [Milestone]?
    let limitations: [String]?
    let versions: [SavedVersion]?
    let wait: WaitState?
}
struct Profile: Decodable {
    let id: String; let revision: Int; let name: String; let timezone: String
    let appearance: String; let model_consent: Bool; let notifications: Bool; let feed_instructions: String
}
struct ModelRoute: Decodable { let provider: String; let model: String; let endpoint: String; let configured: Bool }
struct ActivityEvent: Decodable, Identifiable { let id: String; let type: String; let detail: String; let created_at: String; let position: Int }
struct EventResponse: Decodable { let items: [ActivityEvent] }
struct Snapshot: Decodable {
    let settings: Profile; let model: ModelRoute; let threads: [SavedItem]; let messages: [SavedItem]
    let tasks: [SavedItem]; let artifacts: [SavedItem]; let goals: [SavedItem]; let feed: [SavedItem]
    let files: [SavedItem]; let sources: [SavedItem]; let inbox: [SavedItem]; let activity: [ActivityEvent]
}
struct APIError: LocalizedError { let message: String; var errorDescription: String? { message } }


struct PendingSubmission: Codable, Equatable {
    let id: String
    let text: String
    let thread: String
    let mode: String
    let sources: [String]
    let apiRoot: String
}
