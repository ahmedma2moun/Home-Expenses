# apps/ios — HomeExpenses

SwiftUI, iOS 17+, MVVM. Source lives under `HomeExpenses/` following PROJECT_SPEC.md §2:

```
HomeExpenses/
├── App/                    # @main entry point, root tab shell
├── Features/{Capture,Review,Orders,Analytics,Settings}
├── Core/{Networking,Persistence,DesignSystem}
└── Resources/              # Info.plist, Debug/Release xcconfig
```

All files type-check cleanly against the macOS SDK (`swiftc -typecheck -swift-version 6
-strict-concurrency=complete`) — verified in CI has nothing to catch until the `.xcodeproj` exists.

## No `.xcodeproj` yet

This scaffold is source-only; there is no Xcode project file checked in yet. To open it in Xcode:

1. **Xcode:** File → New → Project → iOS App → name it `HomeExpenses`, uncheck "Include Tests"
   generation defaults you don't want, then delete the generated placeholder files and drag this
   `HomeExpenses/` folder's contents in (uncheck "Copy items if needed" since they're already here).
   Set the `Info.plist` and per-configuration `xcconfig` files under Build Settings.
2. **Or xcodegen:** `brew install xcodegen`, add a `project.yml` describing the `HomeExpenses` app
   target pointing at this source tree and the two xcconfig files, then `xcodegen generate`.

Once a project file exists, wire `ios-ci.yml` to build against it (it currently only runs
`swiftc -typecheck` as a stand-in — see `.github/workflows/ios-ci.yml`).

## Config

`Resources/Debug.xcconfig` / `Release.xcconfig` set `API_BASE_URL`, read at runtime via
`AppConfig.apiBaseURL` (`Core/Networking/AppConfig.swift`) from `Info.plist`. No secrets live in
this app — the Anthropic API key never leaves the backend (CLAUDE.md rule 5).
