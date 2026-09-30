import SwiftUI
import UniformTypeIdentifiers

private let peach = Color(red: 0.91, green: 0.63, blue: 0.53)
private let sage = Color(red: 0.69, green: 0.76, blue: 0.61)

enum Surface: String, CaseIterable, Identifiable {
    case tasks = "Chat", feed = "Feed", goals = "Goals", library = "Library", settings = "Settings"
    var id: String { rawValue }
    var symbol: String { switch self { case .tasks: "bubble.left"; case .feed: "rectangle.stack"; case .goals: "scope"; case .library: "square.grid.2x2"; case .settings: "gearshape" } }
}

struct ContentView: View {
    @StateObject private var account = AccountData()
    @State private var selection: Surface = .tasks
    @AppStorage("kethora-ios-draft") private var draft = ""
    @State private var showChats = false
    @State private var importing = false
    @State private var addingGoal = false
    @State private var selectedTask: SavedItem?
    @State private var selectedArtifact: SavedItem?
    @State private var selectedFile: SavedItem?
    @State private var libraryTab = "Artifacts"
    @State private var ideas = false
    @State private var feedInstructions = false
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        NavigationStack {
            Group {
                if account.snapshot == nil {
                    VStack(spacing: 20) {
                        Text("k").font(.system(size: 70, design: .serif)).foregroundStyle(peach)
                        if account.loading { ProgressView("Opening your workspace") }
                        else { Text(account.error ?? "Your personal agent, Kethora").multilineTextAlignment(.center).foregroundStyle(.secondary); Button("Open local workspace") { Task { await account.connect() } }.buttonStyle(.borderedProminent); TextField("API URL", text: $account.apiRoot).textInputAutocapitalization(.never).autocorrectionDisabled().textFieldStyle(.roundedBorder) }
                    }.padding(30)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 22) {
                            if let error = account.error { HStack { Text(error).font(.caption); Spacer(); Button("Retry") { Task { await account.refresh() } } }.padding().background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12)) }
                            switch selection {
                            case .tasks: chat
                            case .feed: feed
                            case .goals: goals
                            case .library: library
                            case .settings: SettingsView(account: account)
                            }
                        }.padding(22)
                    }.refreshable { await account.refresh() }
                }
            }
            .background(Color(uiColor: .systemBackground))
            .navigationTitle(selection == .tasks ? (account.snapshot?.settings.name ?? "Kethora") : selection.rawValue)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Conversations", systemImage: "line.3.horizontal") { showChats = true } }
                ToolbarItem(placement: .topBarTrailing) { Label("Local", systemImage: "circle.fill").font(.caption2).foregroundStyle(sage) }
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 15) {
                    if selection == .tasks, account.snapshot != nil { composer }
                    HStack(spacing: 12) {
                        ForEach(Surface.allCases) { surface in
                            Button { selection = surface } label: {
                                Image(systemName: surface.symbol).font(.system(size: 20)).padding(12).background(selection == surface ? sage.opacity(0.2) : .clear, in: Capsule())
                            }.foregroundStyle(selection == surface ? sage : .secondary).accessibilityLabel(surface.rawValue).accessibilityAddTraits(selection == surface ? .isSelected : [])
                        }
                    }.padding(5).background(.regularMaterial, in: Capsule())
                }.padding(.horizontal, 20).padding(.bottom, 8).background(Color(uiColor: .systemBackground).opacity(0.98))
            }
            .task { await account.connect(); while !Task.isCancelled { try? await Task.sleep(for: .seconds(3)); if !Task.isCancelled && scenePhase == .active && account.snapshot != nil { await account.refresh() } } }
            .onChange(of: scenePhase) { _, value in if value == .active { Task { await account.refresh() } } }
            .sheet(isPresented: $showChats) { ConversationView(account: account) }
            .sheet(isPresented: $addingGoal) { NewGoalView(account: account) }
            .sheet(item: $selectedTask) { TaskDetailView(account: account, taskID: $0.id) }
            .sheet(item: $selectedArtifact) { ArtifactView(account: account, artifactID: $0.id) }
            .sheet(item: $selectedFile) { MemoryFileView(account: account, fileID: $0.id) }
            .sheet(isPresented: $feedInstructions) { FeedInstructionsView(account: account) }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.text, .commaSeparatedText], allowsMultipleSelection: true) { result in
                Task { switch result { case .success(let urls): if urls.count + account.sourceIDs.count > 10 { account.error = "At most ten sources may be attached." } else { for url in urls { await account.importSource(url) } }; case .failure(let error): account.error = error.localizedDescription } }
            }
            .preferredColorScheme(account.snapshot?.settings.appearance == "light" ? .light : account.snapshot?.settings.appearance == "system" ? nil : .dark)
            .tint(sage)
        }
    }
    @ViewBuilder private var chat: some View {
        let messages = account.snapshot?.messages.filter { $0.thread_id == account.threadID } ?? []
        if messages.isEmpty {
            VStack(spacing: 19) {
                ZStack {
                    Circle().fill(RadialGradient(colors: [peach, Color.brown, Color(red: 0.13, green: 0.18, blue: 0.12)], center: .topLeading, startRadius: 0, endRadius: 95)).frame(width: 88, height: 88)
                    Ellipse().stroke(peach.opacity(0.4), lineWidth: 0.7).frame(width: 133, height: 58).rotationEffect(.degrees(-25))
                }.frame(height: 130)
                Text("YOUR PERSONAL AGENT").font(.system(size: 10, weight: .medium)).tracking(2).foregroundStyle(.secondary)
                Text("A little less busy.\nA lot more possible.").font(.system(size: 35, weight: .regular)).tracking(-1.8).multilineTextAlignment(.center)
                Text("A place for your ideas, your everyday to-dos, and the things you’ve been meaning to do.").font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                starter("Make room for big ideas", detail: "Turn a thought into a clear plan.", symbol: "sparkle", prompt: "Help me turn my idea into a practical plan with milestones.")
                starter("Find the signal", detail: "Bring your notes into focus.", symbol: "doc.text", prompt: "Create a concise brief from the files I attach, and show what remains uncertain.")
                Button { addingGoal = true } label: { card { Label("Move something forward", systemImage: "scope").frame(maxWidth: .infinity, alignment: .leading) } }
            }.padding(.vertical, 20)
        } else {
            ForEach(messages) { message in
                VStack(alignment: .leading, spacing: 12) {
                    Text(message.role == "assistant" ? account.snapshot?.settings.name ?? "Kethora" : "You").font(.caption).foregroundStyle(message.role == "assistant" ? peach : sage)
                    Text(message.content ?? "").font(.subheadline).textSelection(.enabled)
                    if let taskID = message.task_id, message.role == "assistant", let task = account.snapshot?.tasks.first(where: { $0.id == taskID }) {
                        Button { selectedTask = task } label: { card { VStack(alignment: .leading, spacing: 9) { Text(task.title ?? "Task").font(.subheadline); status(task.state ?? "queued") } } }.foregroundStyle(.primary)
                    }
                    if let artifactID = message.artifact_id, let artifact = account.snapshot?.artifacts.first(where: { $0.id == artifactID }) { Button("Open saved draft", systemImage: "doc.text") { selectedArtifact = artifact }.buttonStyle(.bordered) }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
            }
        }
    }
    private func starter(_ title: String, detail: String, symbol: String, prompt: String) -> some View {
        Button { draft = prompt } label: { card { HStack(spacing: 13) { Image(systemName: symbol).foregroundStyle(peach); VStack(alignment: .leading, spacing: 5) { Text(title).font(.subheadline); Text(detail).font(.caption).foregroundStyle(.secondary) }; Spacer() } } }.foregroundStyle(.primary)
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !account.sourceIDs.isEmpty { Text("\(account.sourceIDs.count) source file(s) attached").font(.caption2).foregroundStyle(sage); Button("Clear attachments") { account.sourceIDs = [] }.font(.caption2) }
            TextField("Ask Kethora to get something done…", text: $draft, axis: .vertical).lineLimit(1...5).font(.subheadline)
            HStack {
                Button("Attach a source", systemImage: "plus") { importing = true }.labelStyle(.iconOnly)
                if account.snapshot?.model.configured == true && account.snapshot?.settings.model_consent == true {
                    Toggle("NVIDIA", isOn: $account.nvidiaMode).font(.caption).toggleStyle(.switch).fixedSize()
                } else { Text("Local preview").font(.caption2).foregroundStyle(.secondary) }
                Spacer()
                Button { Task { if await account.send(draft) { draft = "" } } } label: { Image(systemName: "arrow.up").padding(8).background(sage, in: RoundedRectangle(cornerRadius: 8)).foregroundStyle(.black) }.accessibilityLabel("Send message").disabled(account.sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            Text("Kethora is an AI assistant. Preview results are drafts.").font(.system(size: 9)).foregroundStyle(.secondary)
        }.padding(15).background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).stroke(sage.opacity(0.35)))
    }
    @ViewBuilder private var feed: some View {
        HStack { Text(ideas ? "A spark for what’s next." : "A little perspective.").font(.title2); Spacer(); Button(ideas ? "Feed" : "Ideas") { ideas.toggle() } }
        if ideas {
            ForEach(account.snapshot?.goals ?? []) { goal in card { VStack(alignment: .leading, spacing: 13) { Label("Based on your saved goal", systemImage: "lightbulb").font(.caption).foregroundStyle(peach); Text(goal.title ?? "A next step").font(.headline); Text("Turn this goal into a practical next-step plan. No task starts until you choose.").font(.subheadline).foregroundStyle(.secondary); Button("Explore this idea") { draft = "Create a next-step plan for my goal: \(goal.title ?? "")"; selection = .tasks } } } }
            starter("Give that idea some structure", detail: "A starter suggestion, not inferred personal context.", symbol: "lightbulb", prompt: "Help me structure my idea into a practical plan.")
        } else {
            Button("Feed instructions", systemImage: "slider.horizontal.3") { feedInstructions = true }
            if account.snapshot?.feed.isEmpty != false { ContentUnavailableView("Your story starts here", systemImage: "rectangle.stack", description: Text("Saved task updates appear here with links to their drafts. No background news generation is enabled.")) }
            ForEach(account.snapshot?.feed ?? []) { item in card { VStack(alignment: .leading, spacing: 15) { Text(item.title ?? "Update").font(.title3); Text(item.summary ?? "").font(.subheadline).foregroundStyle(.secondary); Text("Unverified draft · Saved task update").font(.caption2).foregroundStyle(peach); HStack { Button(item.reaction == "like" ? "Liked" : "Like", systemImage: "heart") { Task { _ = await account.mutate("feed/\(item.id)", method: "PATCH", payload: ["revision": item.revision, "reaction": item.reaction == "like" ? NSNull() : "like" as Any]) } }; Button("Discuss") { Task { if await account.createThread(title: "Discuss: \(item.title ?? "Draft")".prefixString(100), contextID: item.id) { draft = "What should I review in this draft?"; selection = .tasks } } }; if let id = item.artifact_id, let artifact = account.snapshot?.artifacts.first(where: { $0.id == id }) { Button("Open") { selectedArtifact = artifact } } }.font(.caption) } } }
        }
    }
    @ViewBuilder private var goals: some View {
        HStack { Text("Small steps. Bigger things.").font(.title2); Spacer(); Button("Create goal", systemImage: "plus") { addingGoal = true }.labelStyle(.iconOnly) }
        if account.snapshot?.goals.isEmpty != false { ContentUnavailableView("What matters to you?", systemImage: "scope", description: Text("Create an outcome and a few manageable milestones.")) }
        ForEach(account.snapshot?.goals ?? []) { goal in card { VStack(alignment: .leading, spacing: 12) {
            Text(goal.category ?? "Personal").font(.caption).foregroundStyle(peach)
            Text(goal.title ?? "Goal").font(.title3)
            Text(goal.description ?? "").font(.subheadline).foregroundStyle(.secondary)
            ForEach(goal.milestones ?? []) { milestone in Button { Task { _ = await account.mutate("goals/\(goal.id)", method: "PATCH", payload: ["revision": goal.revision, "milestone_id": milestone.id, "done": !milestone.done]) } } label: { Label(milestone.title, systemImage: milestone.done ? "checkmark.circle.fill" : "circle").font(.subheadline) } }
            Text("User-confirmed milestones · \(goal.status ?? "active")").font(.caption2).foregroundStyle(.secondary)
            Button(goal.status == "paused" ? "Resume" : "Pause") { Task { _ = await account.mutate("goals/\(goal.id)", method: "PATCH", payload: ["revision": goal.revision, "status": goal.status == "paused" ? "active" : "paused"]) } }.font(.caption)
        } } }
    }
    @ViewBuilder private var library: some View {
        Text("Good work, kept close.").font(.title2)
        Picker("Library section", selection: $libraryTab) { Text("Artifacts").tag("Artifacts"); Text("Sources").tag("Sources"); Text("System Files").tag("Files") }.pickerStyle(.segmented)
        if libraryTab == "Artifacts" {
            if account.snapshot?.artifacts.isEmpty != false { ContentUnavailableView("A home for your thinking", systemImage: "doc.text", description: Text("Saved task drafts appear here with version history.")) }
            ForEach(account.snapshot?.artifacts ?? []) { item in Button { selectedArtifact = item } label: { card { HStack { Image(systemName: "doc.text").foregroundStyle(sage); VStack(alignment: .leading, spacing: 6) { Text(item.title ?? "Artifact").font(.subheadline); Text("Markdown · Version \(item.version ?? 1) · \(item.status ?? "draft")").font(.caption2).foregroundStyle(.secondary) }; Spacer(); Image(systemName: "chevron.right").font(.caption) } } }.foregroundStyle(.primary) }
        } else if libraryTab == "Sources" {
            Button("Upload a source", systemImage: "plus") { importing = true }
            ForEach(account.snapshot?.sources ?? []) { source in card { HStack { Label(source.title ?? "Source", systemImage: "doc"); Spacer(); Button("Attach") { if !account.sourceIDs.contains(source.id), account.sourceIDs.count < 10 { account.sourceIDs.append(source.id) }; selection = .tasks } }.font(.subheadline) } }
        } else {
            Text("Editable context. These files never grant permissions.").font(.caption).foregroundStyle(.secondary)
            ForEach(account.snapshot?.files ?? []) { file in Button { selectedFile = file } label: { card { HStack { Label(file.title ?? "File", systemImage: "doc.text"); Spacer(); Text("r\(file.revision)").font(.caption).foregroundStyle(.secondary) } } }.foregroundStyle(.primary) }
        }
    }
}
func card<Content: View>(@ViewBuilder content: () -> Content) -> some View { content().padding(17).frame(maxWidth: .infinity, alignment: .leading).background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 13)).overlay(RoundedRectangle(cornerRadius: 13).stroke(Color.secondary.opacity(0.14))) }
func status(_ state: String) -> some View { Label(state == "partial" ? "Draft ready · unverified" : state.replacingOccurrences(of: "_", with: " "), systemImage: state == "paused" ? "pause.circle" : "info.circle").font(.caption).foregroundStyle(state == "partial" || state == "waiting" ? peach : sage) }
extension String { func prefixString(_ count: Int) -> String { String(prefix(count)) } }
