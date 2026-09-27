import Foundation

/// Money is always `Decimal`, decoded from a wire string, formatted with `Locale`-aware
/// `FormatStyle` — never a hardcoded currency symbol (PROJECT_SPEC.md §5, §10).
extension Decimal {
    func formatted(currencyCode: String) -> String {
        formatted(.currency(code: currencyCode))
    }

    /// The wire format the API requires: exactly two decimals, no grouping separator, and no
    /// locale in sight — `"1.234,50"` would be rejected as money by the backend.
    var wireString: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        formatter.usesGroupingSeparator = false
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.string(from: self as NSDecimalNumber) ?? "0.00"
    }
}

/// An optional leading `-`, at least one digit, and *at most* two decimal digits if a decimal point
/// is present at all — deliberately more lenient than the backend's own `MONEY_RE` (which requires
/// exactly two decimals): decoding a bare integer like `"45"` must still work (`encode` normalizes
/// it to `"45.00"` on the way back out; see the whole-number test in MoneyStringTests). What this
/// pattern exists to block is `Decimal(string:)`'s own leniency — it reads as much of a number as
/// it can and silently ignores the rest, so `"1,234.56"` parses as `1`, `"12abc"` as `12`, `"1.2.3"`
/// as `1.2`. Anchored on the whole string so none of that garbage can sneak through.
private let wireMoneyPattern = #"^-?\d+(\.\d{1,2})?$"#

/// Decodes a JSON string like `"45.00"` into `Decimal`. A JSON number here is a bug.
struct MoneyString: Codable, Equatable, Sendable {
    let value: Decimal

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        guard let value = Self.parseStrictWireString(raw) else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected a decimal string like \"45.00\", got \"\(raw)\"."
            )
        }
        self.value = value
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        // Plain string interpolation on a whole-number Decimal emits "45", not "45.00" — the API's
        // moneySchema rejects that as malformed money, so this must go through the same
        // exactly-two-decimals formatter `decode` implicitly relies on being on the wire already.
        try container.encode(value.wireString)
    }

    /// Parses a wire-format money string produced client-side — e.g. by the on-device extraction
    /// pipeline (`OnDeviceReceiptExtractor`) — through the same validation `init(from:)` applies to
    /// a server response (`wireMoneyPattern`). `nil` for anything outside that shape: the on-device
    /// model's own output must never be trusted as money any more than the server's is (CLAUDE.md
    /// rule 1 — never a float, always validated `Decimal`), and "trusted" here means
    /// rejected-if-malformed, not silently reinterpreted into whatever `Decimal(string:)` could
    /// salvage from it.
    init?(wireString raw: String) {
        guard let value = Self.parseStrictWireString(raw) else { return nil }
        self.value = value
    }

    private static func parseStrictWireString(_ raw: String) -> Decimal? {
        guard raw.range(of: wireMoneyPattern, options: .regularExpression) != nil else { return nil }
        return Decimal(string: raw, locale: Locale(identifier: "en_US_POSIX"))
    }
}
