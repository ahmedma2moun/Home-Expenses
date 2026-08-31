import Foundation

/// A money field on a PATCH/PUT request that can be explicitly cleared back to "unset" — a plain
/// `String?` and `encodeIfPresent` can only distinguish "send" from "omit the key," never "send
/// `null`," so `actualPaid` (`OrderUpdateRequestSchema`) and a budget's `protein` amount
/// (`BudgetUpdateRequestSchema`) — both `moneySchema.nullable().optional()` server-side, where
/// `null` clears and omitting leaves untouched — need this instead.
///
/// Wrap it in an `Optional` on the request struct: `nil` omits the key (leave untouched),
/// `.cleared` encodes `null`, `.value(_)` encodes the amount.
enum ClearableMoney: Encodable, Equatable {
    case cleared
    case value(String)

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .cleared:
            try container.encodeNil()
        case .value(let amount):
            try container.encode(amount)
        }
    }
}
