import Foundation

/// Reads build-time config from the xcconfig-driven Info.plist (PROJECT_SPEC.md §10, §14).
/// No secrets live here — the Anthropic key stays server-side.
enum AppConfig {
    static var apiBaseURL: URL {
        guard
            let raw = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String,
            let url = URL(string: raw)
        else {
            fatalError("API_BASE_URL is missing or invalid — set it in the active xcconfig.")
        }
        return url
    }
}
