import Foundation

/// Reads build-time config from the xcconfig-driven Info.plist (PROJECT_SPEC.md §10, §14).
/// No secrets live here — the Anthropic key stays server-side.
enum AppConfig {
    /// Falls back here if `API_BASE_URL` is somehow missing or malformed — a build-config bug
    /// (a dropped xcconfig substitution), never something a user did. `assertionFailure` catches
    /// it immediately in development; a shipped build degrades to hitting production instead of
    /// crashing on every launch, which was this property's previous behavior via `fatalError`.
    private static let productionFallbackURLString = "https://home-expenses-theta.vercel.app"

    static var apiBaseURL: URL {
        let configured = (Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String)
            .flatMap(URL.init(string:))
        if let configured {
            return configured
        }
        assertionFailure("API_BASE_URL is missing or invalid — set it in the active xcconfig.")
        return URL(string: productionFallbackURLString) ?? URL(fileURLWithPath: "/")
    }
}
