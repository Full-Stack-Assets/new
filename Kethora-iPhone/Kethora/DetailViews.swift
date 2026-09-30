import SwiftUI

struct ConversationView: View {
    @ObservedObject var account: AccountData
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var title = ""
    var body: some View {
        NavigationStack {
            List {
                Section("Your conversations") {
                    ForEach((account.snapshot?.threads ?? []).filter { search.isEmpty || ($0.title ?? "").localizedCaseInsensitiveContains(search) }) { thread in
                        Button { account.threadID = thread.id; dismiss() } label: { Label(thread.title ?? "Chat", systemImage: thread.kind == "main" ? "bubble.left.fill" : "bubble.left") }
                    }
                }
                Section("Start a side chat") {
                    TextField("Conversation name", text: $title)
                    Button("Create chat") { Task { if await account.createThread(title: title) { dismiss() } } }.disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Text("Side chats share workspace preferences and permissions.").font(.caption).foregroundStyle(.secondary)
                }
            }.searchable(text: $search).navigationTitle("Conversations").toolbar { Button("Done") { dismiss() } }
        }
    }
}
struct NewGoalView: View {
    @ObservedObject var account: AccountData
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var description = ""
    @State private var milestones = ""
    @State private var category = "Productivity"
    var body: some View {
        NavigationStack {
            Form {
                Section("What would you like to achieve?") { TextField("A meaningful outcome", text: $title); TextField("Why it matters", text: $description, axis: .vertical) }
                Section("Category") { Picker("Category", selection: $category) { ForEach(["Health", "Relationships", "Career", "Interests", "Productivity", "Something else"], id: \.self) { Text($0) } } }
                Section("Milestones — one per line") { TextEditor(text: $milestones).frame(minHeight: 130) }
                if let error = account.error { Text(error).foregroundStyle(.orange).font(.caption) }
            }.navigationTitle("Make room for a goal").toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Create") { Task { if await account.mutate("goals", payload: ["title": title, "description": description, "category": category, "milestones": milestones.split(separator: "\n").map(String.init)]) { dismiss() } } }.disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
            }
        }
    }
}
struct TaskDetailView: View {
    @ObservedObject var account: AccountData
    let taskID: String
    @Environment(\.dismiss) private var dismiss
    @State private var events: [ActivityEvent] = []
    @State private var correction = ""
    @State private var artifact: SavedItem?
    private var task: SavedItem? { account.snapshot?.tasks.first { $0.id == taskID } }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let task {
                        Text(task.title ?? "Task").font(.title2)
                        status(task.state ?? "queued")
                        Text("Revision \(task.revision) · \(task.turns_used ?? 0) / 12 model calls · \(task.mode ?? "local")").font(.caption).foregroundStyle(.secondary)
                        if let wait = task.wait { card { VStack(alignment: .leading, spacing: 8) { Text("Waiting for \(wait.reason)").font(.headline); Text(wait.resume_condition); Text("Responsible: \(wait.responsible_party)").font(.caption) } } }
                        HStack {
                            if ["queued", "planning", "running", "verifying", "waiting"].contains(task.state ?? "") { Button("Pause", systemImage: "pause") { control("pause") } }
                            if ["paused", "waiting", "failed"].contains(task.state ?? "") { Button("Resume", systemImage: "play") { control("resume") } }
                            if !["partial", "completed", "cancelled", "failed", "expired"].contains(task.state ?? "") { Button("Cancel", role: .destructive) { control("cancel") } }
                        }.buttonStyle(.bordered)
                        if let id = task.artifact_id, let saved = account.snapshot?.artifacts.first(where: { $0.id == id }) { Button("Open saved draft", systemImage: "doc.text") { artifact = saved }.buttonStyle(.borderedProminent) }
                        if task.state != "cancelled" {
                            TextField("What should change?", text: $correction, axis: .vertical).textFieldStyle(.roundedBorder)
                            Button("Save correction") { Task { if await account.mutate("tasks/\(taskID)/revise", payload: ["command_id": UUID().uuidString, "revision": task.revision, "text": correction]) { correction = ""; await loadEvents() } } }.disabled(correction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            Text("Previous artifact versions stay visible and become stale.").font(.caption2).foregroundStyle(.secondary)
                        }
                        ForEach(task.limitations ?? [], id: \.self) { Text($0).font(.caption).foregroundStyle(.orange) }
                    }
                    Text("Committed activity").font(.headline)
                    ForEach(events) { event in card { VStack(alignment: .leading, spacing: 8) { Text(event.type.replacingOccurrences(of: ".", with: " · ")).font(.caption); Text(event.detail).font(.subheadline); Text("Event \(event.position) · \(event.created_at)").font(.caption2).foregroundStyle(.secondary) } } }
                    if let error = account.error { Text(error).font(.caption).foregroundStyle(.orange) }
                }.padding(22)
            }.navigationTitle("Task activity").navigationBarTitleDisplayMode(.inline).toolbar { Button("Done") { dismiss() } }.task { await loadEvents() }.refreshable { await account.refresh(); await loadEvents() }.sheet(item: $artifact) { ArtifactView(account: account, artifactID: $0.id) }
        }
    }
    private func loadEvents() async { do { let bytes = try await account.request("activity?task_id=\(taskID)"); events = try JSONDecoder().decode(EventResponse.self, from: bytes).items } catch { account.error = error.localizedDescription } }
    private func control(_ action: String) { guard let task else { return }; Task { _ = await account.mutate("tasks/\(taskID)/\(action)", payload: ["command_id": UUID().uuidString, "revision": task.revision]); await loadEvents() } }
}
struct ArtifactView: View {
    @ObservedObject var account: AccountData
    let artifactID: String
    @Environment(\.dismiss) private var dismiss
    @State private var artifact: SavedItem?
    @State private var shareURL: URL?
    @State private var pdfURL: URL?
    @State private var selectedVersion = 0
    @State private var deleteConfirmation = false
    private var shareKey: String? {
        guard let artifact, let versions = artifact.versions, versions.indices.contains(selectedVersion) else { return nil }
        return "\(artifact.id):\(versions[selectedVersion].version ?? 1)"
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let artifact {
                        Text(artifact.title ?? "Draft").font(.title2)
                        status(artifact.status ?? "unverified_draft")
                        Text("This is a draft. File existence and hash are recorded; factual claims have not been independently verified.").font(.caption).foregroundStyle(.orange)
                        if let versions = artifact.versions {
                            Picker("Version", selection: $selectedVersion) { ForEach(Array(versions.enumerated()), id: \.offset) { index, version in Text("Version \(version.version ?? 1)\(version.stale == true ? " · Stale" : "")").tag(index) } }.pickerStyle(.menu)
                            Text(versions.indices.contains(selectedVersion) ? versions[selectedVersion].content : artifact.content ?? "").font(.subheadline).textSelection(.enabled)
                        } else { Text(artifact.content ?? "").font(.subheadline).textSelection(.enabled) }
                        Text("SHA-256: \(artifact.versions?.indices.contains(selectedVersion) == true ? artifact.versions?[selectedVersion].hash ?? artifact.hash ?? "" : artifact.hash ?? "")").font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
                        if let pdfURL { ShareLink(item: pdfURL) { Label("Share or save PDF draft", systemImage: "doc.richtext") } }
                        if let shareURL { ShareLink(item: shareURL) { Label("Share or save Markdown", systemImage: "square.and.arrow.up") } }
                        Button("Delete artifact", role: .destructive) { deleteConfirmation = true }
                    } else { ProgressView("Opening saved draft") }
                    if let error = account.error { Text(error).foregroundStyle(.orange).font(.caption) }
                }.padding(22)
            }.navigationTitle("Saved draft").navigationBarTitleDisplayMode(.inline).toolbar { Button("Done") { dismiss() } }.task {
                do { let bytes = try await account.request("artifacts/\(artifactID)"); artifact = try JSONDecoder().decode(SavedItem.self, from: bytes); selectedVersion = max(0, (artifact?.versions?.count ?? 1) - 1) } catch { account.error = error.localizedDescription }
            }.task(id: shareKey) {
                shareURL = nil; pdfURL = nil
                guard let artifact, let versions = artifact.versions, versions.indices.contains(selectedVersion) else { return }
                let version = versions[selectedVersion].version ?? 1
                do {
                    let markdown = try await account.savedDownload("artifacts/\(artifactID)/download?version=\(version)", name: "kethora-draft-v\(version).md")
                    let pdf = try await account.savedDownload("artifacts/\(artifactID)/download?format=pdf&version=\(version)", name: "kethora-draft-v\(version).pdf")
                    try Task.checkCancellation()
                    shareURL = markdown; pdfURL = pdf
                } catch is CancellationError { }
                catch { if !Task.isCancelled { account.error = error.localizedDescription } }
            }.confirmationDialog("Delete this saved artifact? Downloaded copies remain outside the workspace.", isPresented: $deleteConfirmation, titleVisibility: .visible) { Button("Delete", role: .destructive) { Task { if let artifact, await account.mutate("artifacts/\(artifactID)", method: "DELETE", payload: ["revision": artifact.revision]) { dismiss() } } } }
        }
    }
}
struct MemoryFileView: View {
    @ObservedObject var account: AccountData
    let fileID: String
    @Environment(\.dismiss) private var dismiss
    @State private var editing = false
    @State private var content = ""
    @State private var title = ""
    @State private var editRevision = 0
    @State private var deleting = false
    private var file: SavedItem? { account.snapshot?.files.first { $0.id == fileID } }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let file {
                        card { VStack(alignment: .leading, spacing: 8) { Text("About this file").font(.headline); Text(file.description ?? "").font(.caption); Text("This description is not part of the saved contents. Editing preferences never grants permissions.").font(.caption2).foregroundStyle(.secondary) } }
                        if editing { TextField("File name", text: $title).textFieldStyle(.roundedBorder); TextEditor(text: $content).font(.system(.subheadline, design: .monospaced)).frame(minHeight: 350); Button("Save revision") { Task { if await account.mutate("files/\(fileID)", method: "PATCH", payload: ["revision": editRevision, "title": title, "content": content]) { editing = false } } }; Button("Cancel editing") { editing = false } }
                        else { Text(file.content ?? "").font(.subheadline).textSelection(.enabled); Text("Revision \(file.revision)").font(.caption).foregroundStyle(.secondary); Button("Edit file", systemImage: "pencil") { content = file.content ?? ""; title = file.title ?? ""; editRevision = file.revision; editing = true }; Button("Delete file", role: .destructive) { deleting = true } }
                    }
                    if let error = account.error { Text(error).font(.caption).foregroundStyle(.orange) }
                }.padding(22)
            }.navigationTitle(file?.title ?? "System file").navigationBarTitleDisplayMode(.inline).toolbar { Button("Done") { dismiss() } }.confirmationDialog("Delete this memory file? Future model calls will not use it.", isPresented: $deleting, titleVisibility: .visible) { Button("Delete", role: .destructive) { Task { if let file, await account.mutate("files/\(fileID)", method: "DELETE", payload: ["revision": file.revision]) { dismiss() } } } }
        }
    }
}
struct FeedInstructionsView: View {
    @ObservedObject var account: AccountData
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var revision = 0
    var body: some View {
        NavigationStack {
            Form { Section("Instructions for future editions") { TextEditor(text: $text).frame(minHeight: 200); Text("Existing editions stay unchanged. Background editorial generation is not enabled.").font(.caption).foregroundStyle(.secondary) }; if let error = account.error { Text(error).foregroundStyle(.orange) } }.navigationTitle("Feed instructions").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { if await account.mutate("settings", method: "PATCH", payload: ["revision": revision, "feed_instructions": text]) { dismiss() } } } } }.onAppear { text = account.snapshot?.settings.feed_instructions ?? ""; revision = account.snapshot?.settings.revision ?? 0 }
        }
    }
}
struct SettingsView: View {
    @ObservedObject var account: AccountData
    @State private var name = ""
    @State private var timezone = ""
    @State private var exportURL: URL?
    @State private var resetting = false
    @State private var resetText = ""
    @State private var receipt: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Your assistant. Your rules.").font(.title2)
            if let profile = account.snapshot?.settings {
                card { VStack(alignment: .leading, spacing: 14) { Text("Profile").font(.headline); TextField("Assistant name", text: $name).textFieldStyle(.roundedBorder); TextField("IANA time zone", text: $timezone).textFieldStyle(.roundedBorder); Button("Save profile") { Task { _ = await account.mutate("settings", method: "PATCH", payload: ["revision": profile.revision, "name": name, "timezone": timezone]) } }; Picker("Appearance", selection: Binding(get: { profile.appearance }, set: { value in Task { _ = await account.mutate("settings", method: "PATCH", payload: ["revision": profile.revision, "appearance": value]) } })) { Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark") }.pickerStyle(.segmented) } }
                card { VStack(alignment: .leading, spacing: 13) { Text("NVIDIA processing").font(.headline); Text(account.snapshot?.model.configured == true ? account.snapshot?.model.model ?? "" : "Set NVIDIA_API_KEY and NVIDIA_MODEL on the server.").font(.caption).foregroundStyle(.secondary); Toggle("Allow NVIDIA processing", isOn: Binding(get: { profile.model_consent }, set: { value in Task { _ = await account.mutate("settings", method: "PATCH", payload: ["revision": profile.revision, "model_consent": value]) } })).disabled(account.snapshot?.model.configured != true); Text("Your request, source text, and memory are sent to NVIDIA only for tasks you select. Drafts remain unverified. Production processor terms and evaluations are pending.").font(.caption).foregroundStyle(.secondary); Text("12 model calls per task · 2 active tasks · Cost unmeasured").font(.caption2) } }
                card { VStack(alignment: .leading, spacing: 12) { Text("Connections & permissions").font(.headline); ForEach(["Google Calendar", "Microsoft Outlook", "CalDAV", "Web browser"], id: \.self) { HStack { Text($0); Spacer(); Text("Unavailable").foregroundStyle(.secondary) }.font(.caption) }; Text("No external write is enabled. Production authentication, protected credentials, and provider capability tests are required.").font(.caption).foregroundStyle(.secondary) } }
                card { VStack(alignment: .leading, spacing: 13) { Text("Notifications & data").font(.headline); Toggle("In-product notifications", isOn: Binding(get: { profile.notifications }, set: { value in Task { _ = await account.mutate("settings", method: "PATCH", payload: ["revision": profile.revision, "notifications": value]) } })); Text("Email and APNs are not configured. Kethora does not collect a model-training dataset.").font(.caption).foregroundStyle(.secondary); Button("Export workspace", systemImage: "square.and.arrow.down") { Task { do { exportURL = try await account.savedDownload("export", name: "kethora-export.json") } catch { account.error = error.localizedDescription } } }; if let exportURL { ShareLink(item: exportURL) { Text("Save or share export") } }; Button("Reset workspace", role: .destructive) { resetting = true } } }
                #if DEBUG
                card { VStack(alignment: .leading, spacing: 12) { Text("Development API").font(.headline); TextField("API root", text: $account.apiRoot).textInputAutocapitalization(.never).autocorrectionDisabled().font(.caption); Button("Connect") { UserDefaults.standard.set(account.apiRoot, forKey: "kethora-api-root"); Task { await account.connect() } }; Text("Single local workspace. This is not passkey authentication or a production release.").font(.caption2).foregroundStyle(.secondary) } }
                #endif
            }
            if let receipt { Text(receipt).font(.system(.caption2, design: .monospaced)).textSelection(.enabled) }
        }.onAppear { name = account.snapshot?.settings.name ?? "Kethora"; timezone = account.snapshot?.settings.timezone ?? "UTC" }.alert("Reset local workspace?", isPresented: $resetting) { TextField("Type RESET", text: $resetText); Button("Cancel", role: .cancel) { resetText = "" }; Button("Delete local records", role: .destructive) { Task { do { let bytes = try await account.request("reset", method: "POST", payload: ["confirmation": resetText]); receipt = String(data: bytes, encoding: .utf8); UserDefaults.standard.removeObject(forKey: "kethora-ios-draft"); UserDefaults.standard.removeObject(forKey: "kethora-pending-submission"); await account.connect() } catch { account.error = error.localizedDescription } } } } message: { Text("Downloaded copies remain outside the workspace. A receipt will state deletion limitations.") }
    }
}
