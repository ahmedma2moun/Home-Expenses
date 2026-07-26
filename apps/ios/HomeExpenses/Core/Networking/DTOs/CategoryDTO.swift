import Foundation

/// Mirrors the `Category` model served by `GET /api/v1/categories` (PROJECT_SPEC.md §5, §6).
/// Ships in M3 — defined now so api-contract-guard has a DTO to check the Zod schema against.
struct CategoryDTO: Codable, Identifiable {
    let id: String
    let name: String
    let emoji: String
    let sortOrder: Int
    let isActive: Bool
}
