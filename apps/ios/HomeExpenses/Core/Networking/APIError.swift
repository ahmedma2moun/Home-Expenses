import Foundation

/// One field-level validation failure from the backend's `details.issues` (docs/api.md).
struct APIErrorIssue: Decodable {
    /// Dotted wire path, e.g. `items.0.lineTotal` — a DTO identifier, not user-facing copy.
    let path: String
    let message: String
}

struct APIErrorDetails: Decodable {
    let issues: [APIErrorIssue]?

    private enum CodingKeys: String, CodingKey {
        case issues
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        // `details` is typed `unknown` on the server, so a shape we don't recognise must never
        // cost us the rest of the payload — degrade to "no issues" instead of failing the decode.
        issues = (try? container.decodeIfPresent([APIErrorIssue].self, forKey: .issues)) ?? nil
    }
}

/// Mirrors the backend's `{ error: { code, message, details? } }` envelope (docs/api.md).
struct APIErrorPayload: Decodable {
    let code: String
    let message: String
    let details: APIErrorDetails?

    private enum CodingKeys: String, CodingKey {
        case code
        case message
        case details
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        code = try container.decode(String.self, forKey: .code)
        message = try container.decode(String.self, forKey: .message)
        details = (try? container.decodeIfPresent(APIErrorDetails.self, forKey: .details)) ?? nil
    }
}

enum APIError: Error {
    case transport(Error)
    case decoding(Error)
    case server(status: Int, payload: APIErrorPayload?)
}

extension Error {
    /// A request the user themselves ended — switching tabs or months cancels the `Task` driving
    /// it. `URLSession` reports that as an ordinary transport failure, and showing "Network error:
    /// cancelled" for something they just did reads as a bug.
    var isTaskCancellation: Bool {
        if self is CancellationError {
            return true
        }
        if let apiError = self as? APIError, case .transport(let underlying) = apiError {
            return (underlying as? URLError)?.code == .cancelled
        }
        return (self as? URLError)?.code == .cancelled
    }
}

extension APIError: LocalizedError {
    /// A receipt can fail on many items at once; listing them all would push the screen's own
    /// controls out of view, so show the first few and count the rest.
    private static let maxShownIssues = 3

    var errorDescription: String? {
        switch self {
        case .transport(let error):
            return "Network error: \(error.localizedDescription)"
        case .decoding:
            return "The server sent an unexpected response."
        case .server(_, let payload):
            // A bare "Request failed validation." leaves the user with nothing to act on, and the
            // backend already names the offending fields. Callers holding the structured
            // `details.issues` can format something richer (item names, inline field highlights);
            // this is the readable fallback for the ones that just show `errorDescription`.
            if let issues = payload?.details?.issues, !issues.isEmpty {
                return Self.summarize(issues)
            }
            return payload?.message ?? "Something went wrong."
        }
    }

    private static func summarize(_ issues: [APIErrorIssue]) -> String {
        var lines = issues.prefix(maxShownIssues).map { describe($0) }
        let hidden = issues.count - lines.count
        if hidden > 0 {
            lines.append("…and \(hidden) more.")
        }
        return lines.joined(separator: "\n")
    }

    private static func describe(_ issue: APIErrorIssue) -> String {
        guard let label = fieldLabel(for: issue.path) else {
            return issue.message
        }
        return "\(label): \(issue.message)"
    }

    /// `items.0.lineTotal` → `Line total`. Array indices carry no meaning for the reader, and a
    /// root-level failure has an empty path — both fall back to the bare message, never a
    /// dangling colon.
    private static func fieldLabel(for path: String) -> String? {
        let segments = path.split(separator: ".")
        guard let field = segments.last(where: { !$0.allSatisfy(\.isNumber) }) else {
            return nil
        }

        var spaced = ""
        for character in field {
            if character.isUppercase, !spaced.isEmpty {
                spaced.append(" ")
            }
            spaced.append(character)
        }
        return spaced.prefix(1).uppercased() + spaced.dropFirst().lowercased()
    }
}
