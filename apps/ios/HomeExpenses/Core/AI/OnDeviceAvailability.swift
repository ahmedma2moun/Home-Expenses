import FoundationModels

/// Whether this device/OS/settings combination can run `OnDeviceReceiptExtractor` right now.
/// Deliberately more specific than a hardware check — eligible-but-Apple-Intelligence-off and
/// eligible-but-still-downloading are both "unavailable" with a reason the Capture screen can show
/// under the dimmed option, not silently identical to "unsupported iPhone."
enum OnDeviceAvailability: Equatable {
    case available
    case unavailable(reason: String)

    var isAvailable: Bool {
        if case .available = self { return true }
        return false
    }

    /// Deployment target is iOS 17 (project.yml), but the extractor attaches the receipt photos to
    /// the prompt, and the on-device model only accepts image input from iOS 27 — iOS 26 has the
    /// model but text-only, so it counts as unavailable here too. Safe to call from anywhere in the
    /// app regardless of OS version; it just reports unavailable below 27.
    static func current() -> OnDeviceAvailability {
        guard #available(iOS 27.0, *) else {
            return .unavailable(reason: "Requires iOS 27 or later.")
        }
        return currentOnSupportedOS()
    }

    @available(iOS 27.0, *)
    private static func currentOnSupportedOS() -> OnDeviceAvailability {
        switch SystemLanguageModel.default.availability {
        case .available:
            return .available
        case .unavailable(let reason):
            switch reason {
            case .deviceNotEligible:
                return .unavailable(reason: "Not supported on this iPhone.")
            case .appleIntelligenceNotEnabled:
                return .unavailable(reason: "Turn on Apple Intelligence in Settings to use this.")
            case .modelNotReady:
                return .unavailable(reason: "The on-device model is still downloading.")
            @unknown default:
                return .unavailable(reason: "On-device extraction isn't available right now.")
            }
        }
    }
}
