import Foundation
import SwiftUI

@MainActor final class AccountData: ObservableObject {
    @Published var snapshot: Snapshot?
    @Published var error: String?
    @Published var loading = false
    @Published var sending = false
    @Published var threadID = ""
    @Published var sourceIDs: [String] = []
    @Published var nvidiaMode = false
    @Published var apiRoot: String = {
        #if DEBUG
        return UserDefaults.standard.string(forKey: "kethora-api-root") ?? "http://localhost:8787/v1/"
        #else
        return Bundle.main.object(forInfoDictionaryKey: "KETHORA_API_URL") as? String ?? ""
        #endif
    }()
    private var pendingCommand: PendingSubmission? = {
        guard let bytes = UserDefaults.standard.data(forKey: "kethora-pending-submission") else { return nil }
        return try? JSONDecoder().decode(PendingSubmission.self, from: bytes)
    }()
    private var reloadGeneration = 0
    private var restoredSubmission = false
    private let session = URLSession(configuration: .default)

    func request(_ path: String, method: String = "GET", payload: [String: Any]? = nil) async throws -> Data {
        guard let root = URL(string: apiRoot), let host = root.host, host != "api.kethora.invalid" else { throw APIError(message: "Configure the account API in Settings.") }
        #if DEBUG
        guard root.scheme == "https" || (root.scheme == "http" && ["localhost", "127.0.0.1"].contains(host)) else { throw APIError(message: "HTTP development access is restricted to localhost. Use HTTPS elsewhere.") }
        #else
        guard root.scheme == "https" else { throw APIError(message: "A trusted HTTPS API is required.") }
        #endif
        guard let url = URL(string: path, relativeTo: root) else { throw APIError(message: "Invalid API route.") }
        var request = URLRequest(url: url, timeoutInterval: 55)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("trusted-ui", forHTTPHeaderField: "X-Kethora-Client")
        if let payload { request.httpBody = try JSONSerialization.data(withJSONObject: payload) }
        let (bytes, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let body = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any]
            throw APIError(message: body?["message"] as? String ?? "Your workspace could not be loaded.")
        }
        return bytes
    }
    func connect() async {
        loading = true; defer { loading = false }
        do { _ = try await request("session", method: "POST", payload: [:]); try await reload(); error = nil }
        catch { self.error = error.localizedDescription }
    }
    func reload() async throws {
        reloadGeneration += 1
        let generation = reloadGeneration
        let bytes = try await request("bootstrap")
        let snapshot = try JSONDecoder().decode(Snapshot.self, from: bytes)
        guard generation == reloadGeneration else { return }
        self.snapshot = snapshot
        if !restoredSubmission, let pending = pendingCommand, pending.apiRoot == apiRoot {
            restoredSubmission = true
            if snapshot.threads.contains(where: { $0.id == pending.thread }) {
                threadID = pending.thread
                sourceIDs = pending.sources
                nvidiaMode = pending.mode == "nvidia"
            }
        }
        if !snapshot.threads.contains(where: { $0.id == threadID }) { threadID = snapshot.threads.first(where: { $0.kind == "main" })?.id ?? snapshot.threads.first?.id ?? "" }
        if !snapshot.settings.model_consent { nvidiaMode = false }
        error = nil
    }
    func refresh() async { do { try await reload() } catch { self.error = error.localizedDescription } }
    func mutate(_ path: String, method: String = "POST", payload: [String: Any]) async -> Bool {
        do { _ = try await request(path, method: method, payload: payload) }
        catch { self.error = error.localizedDescription; return false }
        // A durable server acknowledgment remains success even if refresh fails.
        do { try await reload() }
        catch { self.error = "Changes were saved, but refresh failed. " + error.localizedDescription }
        return true
    }
    func send(_ text: String) async -> Bool {
        guard !sending, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        sending = true; defer { sending = false }
        let mode = nvidiaMode ? "nvidia" : "local"
        if pendingCommand?.text != text || pendingCommand?.thread != threadID || pendingCommand?.mode != mode || pendingCommand?.sources != sourceIDs || pendingCommand?.apiRoot != apiRoot {
            pendingCommand = PendingSubmission(id: UUID().uuidString, text: text, thread: threadID, mode: mode, sources: sourceIDs, apiRoot: apiRoot)
            if let bytes = try? JSONEncoder().encode(pendingCommand) { UserDefaults.standard.set(bytes, forKey: "kethora-pending-submission") }
        }
        guard let pending = pendingCommand else { return false }
        let saved = await mutate("commands", payload: ["command_id": pending.id, "text": text, "thread_id": threadID, "mode": mode, "source_ids": sourceIDs])
        if saved { pendingCommand = nil; UserDefaults.standard.removeObject(forKey: "kethora-pending-submission"); sourceIDs = [] }
        return saved
    }
    func createThread(title: String, contextID: String? = nil) async -> Bool {
        do {
            var payload: [String: Any] = ["title": title]
            if let contextID { payload["context_id"] = contextID }
            let bytes = try await request("threads", method: "POST", payload: payload)
            let item = try JSONDecoder().decode(SavedItem.self, from: bytes)
            threadID = item.id
            do { try await reload() }
            catch { self.error = "Conversation was saved, but refresh failed. " + error.localizedDescription }
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
    func importSource(_ url: URL) async {
        guard sourceIDs.count < 10 else { error = "At most ten sources may be attached."; return }
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let values = try url.resourceValues(forKeys: [.fileSizeKey])
            guard (values.fileSize ?? 0) <= 1_500_000 else { throw APIError(message: "Source files must be under 1.5 MB.") }
            let bytes = try Data(contentsOf: url)
            guard bytes.count <= 1_500_000, let text = String(data: bytes, encoding: .utf8) else { throw APIError(message: "Choose a UTF-8 text, Markdown, or CSV file under 1.5 MB.") }
            let result = try await request("sources", method: "POST", payload: ["title": url.lastPathComponent, "content": text])
            let source = try JSONDecoder().decode(SavedItem.self, from: result)
            if sourceIDs.count < 10 { sourceIDs.append(source.id) }
            try await reload()
        } catch { self.error = error.localizedDescription }
    }
    func savedDownload(_ path: String, name: String) async throws -> URL {
        let bytes = try await request(path)
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Kethora", isDirectory: true).appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let leaf = URL(fileURLWithPath: name).lastPathComponent
        let url = folder.appendingPathComponent(leaf)
        try bytes.write(to: url, options: [.atomic, .completeFileProtection])
        return url
    }
}
