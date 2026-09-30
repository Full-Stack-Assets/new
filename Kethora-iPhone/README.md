# Kethora for iPhone

Native SwiftUI source for iOS 18+, with a checked-in Xcode project and app icon. This is a development client, not an App Store release.

On a Mac with Xcode 16 or newer:

1. At the repository root run `npm ci`, `npm run build`, then `npm start`.
2. Open `Kethora.xcodeproj`, select the Kethora scheme and an iPhone simulator, and run. Debug defaults to the Mac's `http://localhost:8787/v1/`.
3. Run `swift test --package-path apps/ios` from the repository root for the portable data-model tests.

For a simulator build without signing:

```
xcodebuild -project apps/ios/Kethora.xcodeproj -scheme Kethora -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

A physical iPhone cannot use the Mac's localhost API. Shipping requires a device-accessible HTTPS backend with production authentication, a real bundle identifier and Apple signing team. Replace `KETHORA_API_URL` in `Kethora/Info.plist` when that backend is available. NVIDIA credentials belong on the server; model processing also requires explicit consent.

Validated here: Swift 6 syntax parsing and portable model decoding tests. Xcode/iOS SDK compilation, simulator interactions, VoiceOver, physical-device testing and distribution signing remain unrun. The included macOS CI workflow provides an SDK build check when uploaded to a GitHub repository; it has not run here.
