// swift-tools-version: 6.0
import PackageDescription
let package = Package(
    name: "KethoraCore",
    products: [.library(name: "KethoraCore", targets: ["KethoraCore"])],
    targets: [
        .target(name: "KethoraCore", path: "Kethora", exclude: ["AccountData.swift", "ContentView.swift", "DetailViews.swift", "KethoraApp.swift", "Info.plist", "Assets.xcassets"], sources: ["WorkspaceModels.swift"]),
        .testTarget(name: "KethoraCoreTests", dependencies: ["KethoraCore"], path: "CoreTests", resources: [.copy("Fixtures")])
    ]
)
