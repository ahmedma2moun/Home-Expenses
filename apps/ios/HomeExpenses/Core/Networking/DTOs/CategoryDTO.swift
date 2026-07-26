import Foundation

/// Mirrors `GET /api/v1/categories` (lib/services/categories.ts) — already filtered to active rows.
struct CategoryDTO: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let emoji: String
    let sortOrder: Int
}
