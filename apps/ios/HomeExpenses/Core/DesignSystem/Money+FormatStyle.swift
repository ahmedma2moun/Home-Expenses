import Foundation

/// Money is always `Decimal`, decoded from a wire string, formatted with `Locale`-aware
/// `FormatStyle` — never a hardcoded currency symbol (PROJECT_SPEC.md §5, §10).
extension Decimal {
    func formatted(currencyCode: String) -> String {
        formatted(.currency(code: currencyCode))
    }
}

/// Decodes a JSON string like `"45.00"` into `Decimal`. A JSON number here is a bug.
struct MoneyString: Codable, Equatable, Sendable {
    let value: Decimal

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        guard let value = Decimal(string: raw) else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected a decimal string, got \"\(raw)\"."
            )
        }
        self.value = value
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode("\(value)")
    }
}
